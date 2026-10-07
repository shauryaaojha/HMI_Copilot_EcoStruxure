/**
 * A ZIP's table of contents, read without inflating anything.
 *
 * Every project format this tool opens - .eote, .vxdz, .co, .xlsx - is a ZIP,
 * and every reader used to hand the bytes straight to JSZip and inflate every
 * entry. A 40 KB file can declare gigabytes of content, and OTE's own .vxdz
 * parser has been the subject of public advisories for exactly this family of
 * crafted-archive problem (ZDI, Pwn2Own Miami 2020). Operator Terminal Expert
 * 4.4 itself now warns before opening "unusually large files" and caps variable
 * imports at 100 MB (featureguide, What's New and Exporting and Importing
 * Variables). This is the same posture, applied before a byte is inflated.
 *
 * So the central directory is read directly: it is at the end of the file, it
 * lists every entry with its compressed and uncompressed size and its flags,
 * and reading it costs nothing. The limits below are checked against what the
 * archive *declares*; JSZip then inflates only archives that passed.
 *
 * Deliberately small: no ZIP64 extra-field parsing, because no project this
 * tool has seen needs it and an archive that does is far over the limits
 * anyway - it is refused as too large rather than half-understood.
 */

import { IngestError } from "./errors";

export interface ZipEntry {
  /** Exactly as stored: OTE writes backslash separators and this keeps them. */
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  /** 0 stored, 8 deflate; anything else JSZip will refuse. */
  method: number;
  encrypted: boolean;
  dir: boolean;
}

export interface ZipLimits {
  /** The archive itself. */
  maxBytes: number;
  maxEntries: number;
  /** Sum of every entry's declared uncompressed size. */
  maxTotalUncompressed: number;
  /** Any single entry. */
  maxEntryUncompressed: number;
  /**
   * Uncompressed over compressed, for entries over 16 MB. Deflate tops out
   * near 1032:1, and an empty SQLite page file legitimately compresses several
   * hundred to one, so this only catches entries built to be inflated - the
   * absolute limits above are the real protection.
   */
  maxRatio: number;
}

/**
 * Generous for any real HMI project and far below what hurts a laptop. The
 * largest file in the 95-project template corpus is a few MB; a 1,248-tag plant
 * with sixty screens is tens of MB uncompressed. 100 MB in matches the cap OTE
 * applies to its own variable imports.
 */
export const DEFAULT_LIMITS: ZipLimits = {
  maxBytes: 100 * 1024 * 1024,
  maxEntries: 20_000,
  maxTotalUncompressed: 512 * 1024 * 1024,
  maxEntryUncompressed: 256 * 1024 * 1024,
  maxRatio: 1000,
};

const SIG_EOCD = 0x06054b50;
const SIG_CDH = 0x02014b50;

export const isZip = (b: Uint8Array) =>
  b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05) && (b[3] === 0x04 || b[3] === 0x06);

/** The central directory, or an IngestError saying why it cannot be read. */
export function listZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record is 22 bytes plus a comment of up to
  // 65,535; search backwards for its signature within that window.
  const floor = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= floor; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new IngestError(
      "zip-corrupt",
      "The file starts like a ZIP archive but its table of contents is missing, so it is truncated or damaged.",
      "If it was copied or downloaded, copy it again; a project file that was still being written when it was copied looks like this.",
    );
  }
  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new IngestError(
      "too-large",
      "This archive uses the ZIP64 extension, which only archives far larger than any HMI project need.",
      "Check that this is the project file and not a backup of a whole drive.",
    );
  }
  if (cdOffset + cdSize > eocd) {
    throw new IngestError("zip-corrupt", "The archive's table of contents points outside the file, so the file is damaged.");
  }

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  const decoder = new TextDecoder("utf-8");
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== SIG_CDH) {
      throw new IngestError("zip-corrupt", `The archive's table of contents is damaged at entry ${n + 1} of ${count}.`);
    }
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const uncompressedSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      method,
      encrypted: (flags & 1) === 1,
      dir: /[\\/]$/.test(name),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Throw unless the archive is safe to inflate. Returns the entry list so the
 * caller can sniff the format from names without a second pass.
 */
export function guardZip(bytes: Uint8Array, limits: ZipLimits = DEFAULT_LIMITS): ZipEntry[] {
  const mb = (n: number) => `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)} MB`;
  if (bytes.length > limits.maxBytes) {
    throw new IngestError(
      "too-large",
      `This file is ${mb(bytes.length)}; the limit is ${mb(limits.maxBytes)}.`,
      "Operator Terminal Expert applies the same 100 MB ceiling to its own imports. Check that this is the project and not an archive of several.",
    );
  }
  const entries = listZip(bytes);
  if (entries.length > limits.maxEntries) {
    throw new IngestError("zip-bomb", `This archive lists ${entries.length.toLocaleString()} entries; a project has hundreds at most.`);
  }
  if (entries.some((e) => e.encrypted)) {
    throw new IngestError(
      "encrypted",
      "Entries in this archive are password-protected, so they cannot be read.",
      "Open the project in Operator Terminal Expert, remove the protection, save, and import the saved file.",
    );
  }
  let total = 0;
  for (const e of entries) {
    if (e.method !== 0 && e.method !== 8) {
      throw new IngestError("unsupported-format", `Entry ${e.name} uses ZIP compression method ${e.method}, which project files never use.`);
    }
    if (e.uncompressedSize > limits.maxEntryUncompressed) {
      throw new IngestError("zip-bomb", `Entry ${e.name} declares ${mb(e.uncompressedSize)} uncompressed, over the ${mb(limits.maxEntryUncompressed)} limit for one entry.`);
    }
    if (e.uncompressedSize > 16 * 1024 * 1024 && e.compressedSize > 0 && e.uncompressedSize / e.compressedSize >= limits.maxRatio) {
      throw new IngestError(
        "zip-bomb",
        `Entry ${e.name} would inflate ${Math.round(e.uncompressedSize / e.compressedSize)}x, which no project content does.`,
        "This archive looks crafted to exhaust memory and was not opened.",
      );
    }
    total += e.uncompressedSize;
  }
  if (total > limits.maxTotalUncompressed) {
    throw new IngestError("zip-bomb", `This archive would inflate to ${mb(total)}, over the ${mb(limits.maxTotalUncompressed)} limit.`);
  }
  return entries;
}
