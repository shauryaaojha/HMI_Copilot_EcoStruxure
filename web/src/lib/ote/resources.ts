/**
 * Pictures inside a project: `Resources\<sha1>.png` plus `Resources.dat`.
 *
 * `Resources.dat` is a JSON object keyed by resource: a picture's key is the
 * SHA-1 of its bytes, a font's is its id, and each value has one entry per
 * use - `{Type: 0, Value: <sha1>, DisplayValue: <original path>}` for a
 * picture (the product's Demo 1.eote: 82 pictures, every one keyed that way).
 *
 * `addPictures` puts in what a ClipArt or Image part needs and the archive
 * lacks, and nothing else: a key that is already there is not recounted, so a
 * project nobody added a picture to keeps its Resources.dat byte-identical.
 */

import type { Part, Screen } from "./schema";

export interface PictureSource {
  bytes: Uint8Array;
  path: string;
}

const pictureOf = (part: Part): string | undefined => {
  if (part.Type !== "ClipArt" && part.Type !== "Image") return undefined;
  const v = part.ImagePath?.Value;
  return typeof v === "string" && /^[0-9a-f]{40}$/i.test(v) ? v.toLowerCase() : undefined;
};

/** Every picture the screens use, with its number of uses. */
export function picturesUsed(screens: Screen[]): Map<string, number> {
  const uses = new Map<string, number>();
  for (const s of screens) for (const p of s.Children[0].Children) {
    const sha = pictureOf(p);
    if (sha) uses.set(sha, (uses.get(sha) ?? 0) + 1);
  }
  return uses;
}

/**
 * Add the missing picture entries. `name(entry)` maps a forward-slash entry
 * name to the archive's own spelling; `lookup(sha)` finds the bytes, from the
 * product's clipart library. Returns the pictures that could not be found,
 * for the caller to report.
 */
export function addPictures(
  entries: Map<string, Uint8Array>,
  screens: Screen[],
  lookup: (sha: string) => PictureSource | undefined,
  name: (entry: string) => string = (e) => e.replace(/\//g, "\\"),
): string[] {
  const uses = picturesUsed(screens);
  if (uses.size === 0) return [];
  const datName = name("Resources.dat");
  const raw = entries.get(datName);
  let dat: Record<string, unknown[]> = {};
  try {
    dat = raw ? (JSON.parse(new TextDecoder().decode(raw).replace(/^﻿/, "")) as Record<string, unknown[]>) : {};
  } catch {
    dat = {};
  }
  const missing: string[] = [];
  let changed = false;
  for (const [sha, count] of uses) {
    const file = name(`Resources/${sha}.png`);
    const have = entries.has(file) || [...entries.keys()].some((k) => k.toLowerCase() === file.toLowerCase());
    if (have && dat[sha]) continue;
    const found = lookup(sha);
    if (!have) {
      if (!found) {
        missing.push(sha);
        continue;
      }
      entries.set(file, found.bytes);
    }
    if (!dat[sha]) {
      const display = found?.path ?? `${sha}.png`;
      dat[sha] = Array.from({ length: count }, () => ({ Type: 0, Value: sha, DisplayValue: display }));
      changed = true;
    }
  }
  if (changed) entries.set(datName, new TextEncoder().encode(JSON.stringify(dat, null, 2)));
  return missing;
}
