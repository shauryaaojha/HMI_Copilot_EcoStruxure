/**
 * Writes a generated project with live bars and a unit detail screen.
 *
 *   npm run build:bars
 *
 * The open test for docs/PLAN_PHASE5.md: the transfer pump station, generated
 * the way the browser generates it - the same event stream, folded into a
 * project the same way useGeneration folds it - and packaged on the skeleton.
 * Open demo_project/HMICopilot_Bars.eote in OTE 4.4 and check what
 * OPEN_TEST.md lists under "Bars": that the indicator Rectangles carry Fill
 * Level, that their Vertical/Horizontal Fill is bound through the
 * HMIC_Scale_* converters, and that each converter reads 0..max -> 0..100.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { runPipeline } from "../src/lib/ai/pipeline.js";
import { packageProject, panelOf, type PackageInput } from "../src/lib/ote/packager.js";
import { screenOf } from "../src/lib/ote/parts.js";
import { loadSkeleton } from "../src/lib/ote/skeleton.js";
import { parseTags } from "../src/lib/tags/parse.js";
import type { Alarm, Part } from "../src/lib/ote/schema.js";
import type { Wire } from "../src/lib/ote/bindings.js";

const SAMPLE = path.join(process.cwd(), "..", "samples", "transfer-pump-station", "tags.csv");
const OUT = path.join(process.cwd(), "..", "demo_project", "HMICopilot_Bars.eote");

const skeleton = await loadSkeleton();
const panel = (await panelOf(skeleton)) ?? { model: "HMIST6500AWADI", width: 1024, height: 600 };
const { variables } = parseTags(await fs.readFile(SAMPLE), "tags.csv");

const partsBy = new Map<string, Part[]>();
const bindings: { tag: string; target: string; property: string; converter?: { min: number; max: number } }[] = [];
const alarms: Alarm[] = [];
for await (const e of runPipeline({ intent: "transfer pump station, with a faceplate for PMP_101", variables, panel })) {
  if (e.type === "object") (partsBy.get(e.screenName ?? "Screen") ?? partsBy.set(e.screenName ?? "Screen", []).get(e.screenName ?? "Screen")!).push(e.part);
  if (e.type === "binding") bindings.push(e);
  if (e.type === "alarm") alarms.push(e.alarm);
  if (e.type === "error") throw new Error(e.message);
}

const screens = [...partsBy].map(([name, parts]) => screenOf(name, parts, panel));
const owner = new Map(screens.flatMap((s) => s.Children[0].Children.map((p) => [p.Name, { part: p, screenId: s.UniqueId }] as const)));
const wires: Wire[] = bindings.flatMap((b) => {
  const found = owner.get(b.target);
  return found ? [{ part: found.part, tag: b.tag, property: b.property, screenId: found.screenId, ...(b.converter ? { converter: b.converter } : {}) }] : [];
});

const input: PackageInput = { name: "TransferPumpStation", target: panel, screens, variables, alarms, wires };
await fs.writeFile(OUT, await packageProject(input, skeleton));

const bars = wires.filter((w) => w.converter).length;
console.log(`${OUT}\n  ${screens.length} screens on ${panel.model} ${panel.width}x${panel.height}, ${wires.length} bindings, ${bars} through a Scale converter, ${alarms.length} alarms`);
