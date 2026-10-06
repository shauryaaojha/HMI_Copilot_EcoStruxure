/**
 * Compound File Binary (OLE structured storage), read-only.
 *
 * A Vijeo Designer project backup (.vdz) is a ZIP holding one compound file,
 * `<project>.SwxCF`, and the project lives in that file's streams. This reads
 * the container as specified in [MS-CFB] (Microsoft Open Specifications):
 * a 512-byte header, a FAT of sector chains reached through the DIFAT, a
 * directory of 128-byte entries forming a tree, and a mini stream for streams
 * under the 4096-byte cutoff.
 *
 * The bytes are untrusted, so every chain is bounded by the sector count (a
 * cyclic FAT stops instead of spinning), every offset is checked, and the
 * total read is capped. A malformed container is an IngestError, never a hang
 * or an out-of-range read.
 */

import { IngestError } from "./errors";

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END_OF_CHAIN = 0xfffffffe;
const FREE = 0xffffffff;
const NO_STREAM = 0xffffffff;

export const isCfb = (b: Uint8Array) => b.length >= 512 && SIGNATURE.every((x, i) => b[i] === x);

export interface CfbEntry {
  /** Full path with "/" between storages, e.g. "Target 1/Base/Panel18/GraphicalObject". */
  path: string;
  type: "storage" | "stream";
  size: number;
}

export interface CompoundFile {
  entries: CfbEntry[];
  /** A stream's bytes by path, or undefined. */
  read(path: string): Uint8Array | undefined;
}

const damaged = (why: string) =>
  new IngestError("damaged", `The compound file inside this archive is damaged: ${why}.`, "Make a fresh backup from Vijeo Designer (File > Backup project) and try again.");

export function readCfb(bytes: Uint8Array, maxStreamBytes = 256 * 1024 * 1024): CompoundFile {
  if (!isCfb(bytes)) throw damaged("it does not start with the compound-file signature");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sectorShift = v.getUint16(0x1e, true);
  const miniShift = v.getUint16(0x20, true);
  if (sectorShift !== 9 && sectorShift !== 12) throw damaged(`sector size 2^${sectorShift} is not 512 or 4096`);
  if (miniShift !== 6) throw damaged(`mini sector size 2^${miniShift} is not 64`);
  const sectorSize = 1 << sectorShift;
  const sectorCount = Math.floor((bytes.length - sectorSize) / sectorSize);
  const fatSectors = v.getUint32(0x2c, true);
  const firstDir = v.getUint32(0x30, true);
  const cutoff = v.getUint32(0x38, true) || 4096;
  const firstMiniFat = v.getUint32(0x3c, true);
  const miniFatSectors = v.getUint32(0x40, true);
  let difatSector = v.getUint32(0x44, true);
  const difatCount = v.getUint32(0x48, true);
  if (fatSectors > sectorCount + 1) throw damaged("the FAT is larger than the file");

  const offsetOf = (sector: number) => {
    const at = (sector + 1) * sectorSize;
    if (sector >= sectorCount + 1 || at + sectorSize > bytes.length) throw damaged(`sector ${sector} is outside the file`);
    return at;
  };

  // --- DIFAT -> FAT sector numbers -------------------------------------------
  const fatList: number[] = [];
  for (let i = 0; i < 109 && fatList.length < fatSectors; i++) {
    const s = v.getUint32(0x4c + i * 4, true);
    if (s !== FREE) fatList.push(s);
  }
  for (let n = 0; n < difatCount && fatList.length < fatSectors; n++) {
    if (difatSector === END_OF_CHAIN || difatSector === FREE) break;
    const at = offsetOf(difatSector);
    const per = sectorSize / 4 - 1;
    for (let i = 0; i < per && fatList.length < fatSectors; i++) {
      const s = v.getUint32(at + i * 4, true);
      if (s !== FREE) fatList.push(s);
    }
    difatSector = v.getUint32(at + per * 4, true);
  }

  // --- FAT -------------------------------------------------------------------
  const perSector = sectorSize / 4;
  const fat = new Uint32Array(fatList.length * perSector);
  fatList.forEach((s, i) => {
    const at = offsetOf(s);
    for (let j = 0; j < perSector; j++) fat[i * perSector + j] = v.getUint32(at + j * 4, true);
  });

  /** A chain's sector numbers, refusing cycles and runs off the end. */
  const chain = (start: number, table: Uint32Array, limit: number): number[] => {
    const out: number[] = [];
    let s = start;
    while (s !== END_OF_CHAIN && s !== FREE) {
      if (s >= table.length || out.length > limit) throw damaged("a sector chain loops or runs off the table");
      out.push(s);
      s = table[s];
    }
    return out;
  };

  const readChain = (start: number, size: number): Uint8Array => {
    if (size > maxStreamBytes) throw new IngestError("too-large", `A stream inside the compound file declares ${size} bytes.`);
    const out = new Uint8Array(size);
    let at = 0;
    for (const s of chain(start, fat, sectorCount)) {
      if (at >= size) break;
      const from = offsetOf(s);
      const n = Math.min(sectorSize, size - at);
      out.set(bytes.subarray(from, from + n), at);
      at += n;
    }
    if (at < size) throw damaged("a stream is shorter than its directory entry says");
    return out;
  };

  // --- directory --------------------------------------------------------------
  const dirSectors = chain(firstDir, fat, sectorCount);
  const dir = new Uint8Array(dirSectors.length * sectorSize);
  dirSectors.forEach((s, i) => dir.set(bytes.subarray(offsetOf(s), offsetOf(s) + sectorSize), i * sectorSize));
  const dv = new DataView(dir.buffer);
  const count = dir.length / 128;
  interface Raw { name: string; type: number; left: number; right: number; child: number; start: number; size: number }
  const raw: Raw[] = [];
  for (let i = 0; i < count; i++) {
    const o = i * 128;
    const nameLen = Math.min(64, dv.getUint16(o + 0x40, true));
    const name = new TextDecoder("utf-16le").decode(dir.subarray(o, o + Math.max(0, nameLen - 2)));
    const lo = dv.getUint32(o + 0x78, true);
    const hi = sectorShift === 9 ? 0 : dv.getUint32(o + 0x7c, true);
    raw.push({
      name,
      type: dir[o + 0x42],
      left: dv.getUint32(o + 0x44, true),
      right: dv.getUint32(o + 0x48, true),
      child: dv.getUint32(o + 0x4c, true),
      start: dv.getUint32(o + 0x74, true),
      size: hi ? Number.MAX_SAFE_INTEGER : lo,
    });
  }
  const root = raw[0];
  if (!root || root.type !== 5) throw damaged("the directory has no root entry");

  // --- mini stream --------------------------------------------------------------
  let miniFat = new Uint32Array(0);
  let miniStream: Uint8Array = new Uint8Array(0);
  if (miniFatSectors > 0 && firstMiniFat !== END_OF_CHAIN) {
    const sectors = chain(firstMiniFat, fat, sectorCount);
    miniFat = new Uint32Array(sectors.length * perSector);
    sectors.forEach((s, i) => {
      const at = offsetOf(s);
      for (let j = 0; j < perSector; j++) miniFat[i * perSector + j] = v.getUint32(at + j * 4, true);
    });
    if (root.size > 0) miniStream = readChain(root.start, root.size);
  }
  const readMini = (start: number, size: number): Uint8Array => {
    const out = new Uint8Array(size);
    let at = 0;
    for (const s of chain(start, miniFat, miniStream.length / 64)) {
      if (at >= size) break;
      const from = s * 64;
      if (from >= miniStream.length) throw damaged("a mini sector is outside the mini stream");
      const n = Math.min(64, size - at);
      out.set(miniStream.subarray(from, from + n), at);
      at += n;
    }
    if (at < size) throw damaged("a small stream is shorter than its directory entry says");
    return out;
  };

  // --- walk the tree ------------------------------------------------------------
  const entries: CfbEntry[] = [];
  const byPath = new Map<string, Raw>();
  const visited = new Set<number>();
  const walk = (id: number, prefix: string, depth: number) => {
    if (id === NO_STREAM || id >= raw.length) return;
    // A visited entry is a loop; depth is bounded by the entry count, since a
    // storage's children may legitimately form one long sibling chain.
    if (visited.has(id) || depth > raw.length) throw damaged("the directory tree loops");
    visited.add(id);
    const e = raw[id];
    walk(e.left, prefix, depth + 1);
    if (e.type === 1 || e.type === 2) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      entries.push({ path, type: e.type === 1 ? "storage" : "stream", size: e.type === 2 ? e.size : 0 });
      byPath.set(path, e);
      if (e.type === 1) walk(e.child, path, depth + 1);
    }
    walk(e.right, prefix, depth + 1);
  };
  walk(root.child, "", 0);

  return {
    entries,
    read(path) {
      const e = byPath.get(path);
      if (!e || e.type !== 2) return undefined;
      return e.size < cutoff ? readMini(e.start, e.size) : readChain(e.start, e.size);
    },
  };
}
