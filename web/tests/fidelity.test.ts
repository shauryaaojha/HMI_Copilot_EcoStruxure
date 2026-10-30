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
import { fidelity } from "@/lib/ote/fidelity";

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
