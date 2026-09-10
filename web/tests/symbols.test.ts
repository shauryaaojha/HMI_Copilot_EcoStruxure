/**
 * Phase 2b: the shipped graphic object library.
 *
 * A Path part is written from Commands and Points; the canvas draws from the
 * derived `d`. Both live in the same record, so the risk is that they drift -
 * an index whose `d` no longer matches its Commands would render one symbol and
 * export another, which is exactly the failure the one rule exists to prevent.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { boundsOf, toPathData, type GraphicObject } from "@/lib/ote/graphics";
import { pathPart, screenOf } from "@/lib/ote/parts";
import { packageProject } from "@/lib/ote/packager";
import { loadSkeleton } from "@/lib/ote/skeleton";
import { Screen } from "@/lib/ote/schema";
import { placeholderSymbols } from "@/fixtures";
import JSZip from "jszip";

const INDEX = path.join(__dirname, "..", "src", "lib", "ote", "graphics-index.json");
const hasIndex = fs.existsSync(INDEX);
const hasSkeleton = fs.existsSync(path.join(__dirname, "..", "skeleton", "manifest.json"));

function loadIndex(): GraphicObject[] {
  return JSON.parse(fs.readFileSync(INDEX, "utf8")).symbols as GraphicObject[];
}

describe("placeholder symbols", () => {
  it("are shaped exactly like a real index entry", () => {
    for (const symbol of placeholderSymbols) {
      expect(symbol.Commands, symbol.name).toBeTruthy();
      expect(symbol.Points, symbol.name).toBeTruthy();
    }
  });

  it("have a `d` that their own Commands and Points reproduce", () => {
    // Otherwise the fixture teaches the UI a contract the real index breaks.
    for (const symbol of placeholderSymbols) {
      expect(toPathData(symbol), symbol.name).toBe(symbol.d);
    }
  });
});

describe.skipIf(!hasIndex)("the shipped library", () => {
  it("carries Commands and Points on every symbol", () => {
    const symbols = loadIndex();
    expect(symbols.length).toBeGreaterThan(400);
    for (const symbol of symbols) {
      expect(symbol.Commands, symbol.name).toBeTruthy();
      expect(symbol.Points, symbol.name).toBeTruthy();
    }
  });

  it("never lets the drawn path drift from the written one", () => {
    for (const symbol of loadIndex()) {
      expect(toPathData(symbol), symbol.name).toBe(symbol.d);
      expect(boundsOf(symbol), symbol.name).toEqual({
        width: symbol.width,
        height: symbol.height,
      });
    }
  });

  it("includes the equipment categories inference targets", () => {
    const categories = new Set(loadIndex().map((s) => s.category));
    for (const wanted of ["Pumps", "Tanks", "Valves", "Fans"]) {
      expect(
        [...categories].some((c) => c.endsWith(wanted)),
        wanted,
      ).toBe(true);
    }
  });
});

describe.skipIf(!hasSkeleton)("a Path part survives packaging", () => {
  const symbol = hasIndex
    ? (loadIndex().find((s) => s.name === "Pump01") ?? placeholderSymbols[0])
    : placeholderSymbols[0];

  it("round-trips through the packager with its geometry intact", async () => {
    const part = pathPart(
      "Sym_Pump1",
      symbol,
      { left: 60, top: 120, width: 180, height: 120 },
    );
    const screen = screenOf("SymbolTest", [part], { width: 1024, height: 600 });

    const bytes = await packageProject(
      {
        name: "SymbolTest",
        target: { model: "HMIST6500AWADI", width: 1024, height: 600 },
        screens: [screen],
        variables: [],
        alarms: [],
        wires: [],
      },
      await loadSkeleton(),
    );

    const zip = await JSZip.loadAsync(bytes);
    const entry = Object.keys(zip.files).find((n) => n.endsWith("Screen.dat"))!;
    const parsed = Screen.parse(JSON.parse(await zip.file(entry)!.async("string")));

    const written = parsed.Children[0].Children[0];
    expect(written.Type).toBe("Path");
    if (written.Type !== "Path") throw new Error("unreachable");

    // The bytes the product will read must be the library's, unaltered.
    expect(written.Commands).toBe(symbol.Commands);
    expect(written.Points).toBe(symbol.Points);
    // And they must still draw the same shape on the canvas.
    expect(toPathData(written)).toBe(symbol.d);
  }, 60_000);
});

/**
 * The library is fetched, and until it arrives there is nothing to show.
 *
 * The Library used to show two symbols, then 474, and which one you saw
 * depended on when you looked. Two causes, both structural rather than
 * behavioural, so neither is reachable from here without a DOM - what is
 * reachable is the shape that allowed them:
 *
 *   - two copies of the fetching hook, one per view, so a fix to one left the
 *     other showing placeholders;
 *   - memo dependency arrays that omitted `symbols`, so the category list was
 *     computed once from the placeholders and the grid only recomputed when you
 *     typed. The index arriving changed nothing until you touched a control.
 *
 * `react-hooks/exhaustive-deps` is the real guard for the second and this
 * project has no ESLint config wired up, so this asserts the first: one
 * implementation, which is what stops the two views drifting again.
 */
describe("one symbol library, not one per view", () => {
  const read = (name: string) =>
    fs.readFileSync(
      path.join(process.cwd(), "src", "components", "library", name),
      "utf8",
    );

  it("has exactly one place that fetches the index", () => {
    const files = ["useSymbols.ts", "LibraryPanel.tsx", "LibraryScreen.tsx"];
    const fetchers = files.filter((f) => read(f).includes('fetch("/api/symbols")'));
    expect(fetchers).toEqual(["useSymbols.ts"]);
  });

  it("has both views reading through that hook", () => {
    for (const view of ["LibraryPanel.tsx", "LibraryScreen.tsx"]) {
      expect(read(view)).toMatch(/useSymbols\(\)/);
    }
  });

  it("tells its callers whether it is still loading", () => {
    // "Fetching" and "there is no index on this machine" both used to fall back
    // to the placeholders, which is why the count appeared to change on its own.
    const hook = read("useSymbols.ts");
    for (const state of ["loading", "indexed", "unavailable"]) {
      expect(hook).toContain(`"${state}"`);
    }
    for (const view of ["LibraryPanel.tsx", "LibraryScreen.tsx"]) {
      expect(read(view), `${view} ignores the loading state`).toContain('"loading"');
    }
  });
});
