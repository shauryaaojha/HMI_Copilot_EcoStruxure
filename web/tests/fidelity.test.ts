/**
 * Nothing in a real project is lost by editing it or moving its screens.
 *
 * Every .eote under samples/ (kept locally, never in git) is held to zero, and so are the product's own
 * Start Page templates where OTE is installed. A project dropped into
 * samples/ is tested from then on. Before this, the corpus lost more than
 * 7,500 fields this way, among them every Switch's ClickTrigger.Destination
 * (the bit a button writes) on any edit. lib/ote/fidelity.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { editLoss, fidelity } from "@/lib/ote/fidelity";
import { packageProject } from "@/lib/ote/packager";
import { numericDisplay, screenOf } from "@/lib/ote/parts";
import { readProject } from "@/lib/ote/reader";

const SAMPLES = path.join(__dirname, "..", "..", "samples");
const TEMPLATES = "C:/Program Files/Schneider Electric/EcoStruxure Operator Terminal Expert 4.4/Buildtime/BuildtimeData/ProjectTemplates";

const find = (dir: string): string[] =>
  !fs.existsSync(dir)
    ? []
    : fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? find(path.join(dir, e.name)) : e.name.toLowerCase().endsWith(".eote") ? [path.join(dir, e.name)] : [],
      );

const projects = [...find(SAMPLES), ...find(TEMPLATES).filter((f) => !/Blank\.eote$/i.test(f))];

// Real projects are not in git (each carries its PLC connection), so a fresh
// clone has none and this suite is skipped there.
describe.skipIf(projects.length === 0)("a real project survives us", () => {
  for (const file of projects) {
    it(`${path.basename(file)}: nothing lost edited in place or moved`, async () => {
      const f = await fidelity(new Uint8Array(fs.readFileSync(file)), path.basename(file));
      expect(f.modelled).toBeGreaterThan(0);
      expect(f.inPlace).toEqual({});
      expect(f.moved).toEqual({});
    }, 60_000);
  }
});

describe("the import check", () => {
  it("names what an edit would lose, by type and field", async () => {
    const part = numericDisplay("Volts", { left: 20, top: 20, width: 90, height: 24 }, 1);
    const target = { model: "HMIST6600", width: 1280, height: 800 };
    const bytes = await packageProject({ name: "P", target, screens: [screenOf("S", [part], target)], variables: [], alarms: [], wires: [] });
    const read = await readProject(bytes, "p.eote");
    expect(await editLoss(bytes, read)).toEqual({});

    // A reader that dropped a nested field (the writer restores top-level
    // ones from the file): the check is what says so.
    const [display] = read.screens[0].Children[0].Children as unknown as { Font: Record<string, unknown> }[];
    const [key] = Object.keys(display.Font);
    delete display.Font[key];
    const lost = Object.keys(await editLoss(bytes, read));
    expect(lost.length).toBeGreaterThan(0);
    for (const k of lost) expect(k.startsWith(`NumericDisplay.Font.${key}`)).toBe(true);
  });
});
