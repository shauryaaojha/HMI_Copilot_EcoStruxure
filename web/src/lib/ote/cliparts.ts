/**
 * The product's clipart library: 200 PNG pictures of real equipment - pumps,
 * tanks, motors, valves, boilers, blowers, flow meters - shipped under
 * `Buildtime\PropertyDefinitions\ScreenDesign\GraphicObjects\04-Cliparts`.
 *
 * A ClipArt part names its picture by the SHA-1 of the PNG bytes
 * (`ImagePath.Value`), and the bytes travel in the project as
 * `Resources\<sha1>.png`, with one `Resources.dat` entry per use:
 * `{Type: 0, Value: <sha1>, DisplayValue: <original path>}` (read from the
 * product's own Demo 1.eote: 82 PNG resources, every one keyed that way).
 *
 * Like the 475 vector symbols, these are Schneider's files: read from the
 * engineer's own installation at run time, never copied into this repository.
 * Where there is no installation (a hosted instance) the library is empty and
 * says so; nothing pretends to have pictures it cannot write.
 */

import { createHash } from "node:crypto";

export const CLIPART_DIR =
  "C:/Program Files/Schneider Electric/EcoStruxure Operator Terminal Expert 4.4/Buildtime/PropertyDefinitions/ScreenDesign/GraphicObjects/04-Cliparts";

export interface Clipart {
  /** "Pumps/CentrifugalPump2" */
  id: string;
  group: string;
  name: string;
  sha1: string;
  width: number;
  height: number;
  /** Where the product keeps it, which is what DisplayValue records. */
  path: string;
}

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

export const sha1 = (bytes: Uint8Array) => createHash("sha1").update(bytes).digest("hex");

let cached: Promise<{ list: Clipart[]; bytes: Map<string, Uint8Array> }> | null = null;

/** Every clipart on this machine, with its bytes keyed by SHA-1. Empty without an installation. */
export function cliparts(dir = CLIPART_DIR): Promise<{ list: Clipart[]; bytes: Map<string, Uint8Array> }> {
  if (dir === CLIPART_DIR && cached) return cached;
  const load = (async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const list: Clipart[] = [];
    const bytes = new Map<string, Uint8Array>();
    const groups = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const g of groups) {
      if (!g.isDirectory()) continue;
      for (const f of await fs.readdir(path.join(dir, g.name)).catch(() => [] as string[])) {
        if (!/\.png$/i.test(f)) continue;
        const full = path.join(dir, g.name, f);
        const data = new Uint8Array(await fs.readFile(full));
        const size = pngSize(data);
        if (!size) continue;
        const hash = sha1(data);
        bytes.set(hash, data);
        list.push({ id: `${g.name}/${f.replace(/\.png$/i, "")}`, group: g.name, name: f.replace(/\.png$/i, ""), sha1: hash, ...size, path: full.replace(/\//g, "\\") });
      }
    }
    list.sort((a, b) => a.id.localeCompare(b.id));
    return { list, bytes };
  })();
  if (dir === CLIPART_DIR) cached = load;
  return load;
}

/** The best clipart for an equipment kind or a free-text hint, by group and name words. */
export function clipartFor(list: Clipart[], hint: string): Clipart | null {
  const words = hint.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  let best: { c: Clipart; score: number } | null = null;
  for (const c of list) {
    const hay = `${c.group} ${c.name}`.toLowerCase();
    const score = words.reduce((s, w) => s + (hay.includes(w) ? (c.group.toLowerCase().includes(w) ? 2 : 3) : 0), 0);
    if (score > 0 && (!best || score > best.score || (score === best.score && c.name.length < best.c.name.length))) best = { c, score };
  }
  return best?.c ?? null;
}
