/**
 * The shipped graphic object library, resolved for the layout.
 *
 * Server-only, and deliberately read from disk at request time rather than
 * imported. `graphics-index.json` is derived from a local EcoStruxure
 * installation - Schneider's own files - so it is gitignored and never leaves
 * the machine that produced it. A static import would put it in the bundle and
 * break the build everywhere `npm run index:graphics` has not been run, which
 * is every machine but the one that has the product installed.
 *
 * So this is a feature that switches itself on where the library exists and is
 * simply absent everywhere else. A screen laid out without it is the same
 * screen with no symbol on its faceplates - not a failure, and nothing says
 * otherwise.
 */

import type { GraphicObject } from "./graphics";

/** What a Path part needs, which is the geometry and nothing else. */
export interface SymbolGeometry {
  Commands: string;
  Points: string;
  width: number;
  height: number;
}

let index: Map<string, SymbolGeometry> | null | undefined;

/**
 * Keyed by "Category/Name" *and* by name alone, both lower-cased.
 *
 * lib/ai/infer.ts names a symbol as "Pumps/Pump01" while the index stores the
 * category as "03-Icons/Pumps", so an exact match on the full path never hits.
 * Indexing both ends means the hint can be as specific or as loose as whoever
 * wrote it felt like being.
 */
async function load(): Promise<Map<string, SymbolGeometry> | null> {
  if (index !== undefined) return index;

  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const file = path.join(process.cwd(), "src", "lib", "ote", "graphics-index.json");
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as {
      symbols?: GraphicObject[];
    };

    const symbols = Array.isArray(parsed.symbols) ? parsed.symbols : [];
    const map = new Map<string, SymbolGeometry>();

    for (const symbol of symbols) {
      // Only entries carrying the real geometry are usable: the packager writes
      // Commands and Points, not the SVG path derived from them.
      if (!symbol.Commands || !symbol.Points) continue;
      const geometry: SymbolGeometry = {
        Commands: symbol.Commands,
        Points: symbol.Points,
        width: Number(symbol.width) || 1,
        height: Number(symbol.height) || 1,
      };
      const full = `${symbol.category}/${symbol.name}`.toLowerCase();
      map.set(full, geometry);
      // "03-Icons/Pumps/Pump01" also answers to "pumps/pump01" and "pump01".
      const parts = full.split("/");
      map.set(parts.slice(-2).join("/"), geometry);
      if (!map.has(symbol.name.toLowerCase())) {
        map.set(symbol.name.toLowerCase(), geometry);
      }
    }

    index = map.size > 0 ? map : null;
  } catch {
    // No index on this machine. That is the normal case away from a machine
    // with EcoStruxure installed, and it is not an error.
    index = null;
  }

  return index;
}

/** The geometry for a hint like "Pumps/Pump01", or null where none is indexed. */
export async function symbolFor(hint: string | undefined): Promise<SymbolGeometry | null> {
  if (!hint) return null;
  const map = await load();
  if (!map) return null;

  const needle = hint.toLowerCase();
  return (
    map.get(needle) ??
    map.get(needle.split("/").slice(-2).join("/")) ??
    map.get(needle.split("/").pop() ?? "") ??
    null
  );
}

/** Resolves a whole set at once, keyed by the hint each unit carries. */
export async function symbolsFor(
  hints: (string | undefined)[],
): Promise<Map<string, SymbolGeometry>> {
  const out = new Map<string, SymbolGeometry>();
  for (const hint of hints) {
    if (!hint || out.has(hint)) continue;
    const found = await symbolFor(hint);
    if (found) out.set(hint, found);
  }
  return out;
}

/** Whether this machine has the library at all, for a line in the build log. */
export async function libraryAvailable(): Promise<boolean> {
  return (await load()) !== null;
}
