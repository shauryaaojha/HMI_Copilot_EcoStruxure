/**
 * S3-09: tidyLayout, and the digest's "Overlaps on it" line, cannot see an overlap inside a card.
 *
 * lib/ote/tidy.ts unitsOf folds every part held inside a Rectangle card into that card's unit,
 * and overlapsOn compares units only, so two parts of one faceplate that cover each other are
 * never an overlap. In the tracked sample demo_project/HMICopilot_Bars.eote, screen PumpStation1,
 * the tank symbol Sym_TNK101 (940,92 52x52) covers the level indicator Ind_TNK101LEVEL_2
 * (696,128 296x56) by 52x16 px. tidyLayout reports done and the model is told "Overlaps on it: none".
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readProject } from "@/lib/ote/reader";
import { overlapsOn } from "@/lib/ote/tidy";

const FILE = path.resolve(import.meta.dirname, "../../../demo_project/HMICopilot_Bars.eote");

describe("S3-09 overlaps inside a faceplate are found", () => {
  it("overlapsOn reports Sym_TNK101 over Ind_TNK101LEVEL_2 on PumpStation1", async () => {
    const read = await readProject(new Uint8Array(readFileSync(FILE)), FILE);
    const screen = read.screens.find((s) => s.Name === "PumpStation1")!;
    const parts = screen.Children[0].Children;
    const sym = parts.find((p) => p.Name === "Sym_TNK101")!;
    const ind = parts.find((p) => p.Name === "Ind_TNK101LEVEL_2")!;
    const w = Math.min(sym.Location.Left + sym.Width!, ind.Location.Left + ind.Width!) - Math.max(sym.Location.Left, ind.Location.Left);
    const h = Math.min(sym.Location.Top + sym.Height!, ind.Location.Top + ind.Height!) - Math.max(sym.Location.Top, ind.Location.Top);
    const found = overlapsOn(parts, () => undefined, read.target);
    const named = found.some((o) => [o.mover.name, o.other.name].includes("Sym_TNK101"));
    expect(named, `the symbol covers the indicator by ${w}x${h} px (${w * h} px²) and overlapsOn found ${found.length} overlaps on the screen, none of them this one`).toBe(true);
  });
});
