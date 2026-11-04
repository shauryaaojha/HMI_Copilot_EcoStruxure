/**
 * S3: build the screen the alignment prompts are run against, from a TRACKED sample.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/audit/s3-scenario.mts ../demo_project/HMICopilot_Bars.eote <out.eote>
 *
 * Takes the sample's PumpStation1 (the app's own generated screen) and, through the app's own
 * ops (core/ops applyOps on a project store), adds what the three prompts need:
 *   - a START and a STOP push button (Switch), deliberately 14 px apart vertically and of
 *     different sizes, side by side under the pump cards;
 *   - two labels that overlap each other. (No out-of-bounds part: moveObject clamps to the
 *     panel, so the ops cannot make one.)
 * Then packages it back into the opened file (packageProject with the file's preserved entries)
 * and reads it back. Nothing here calls a model.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { readProject } from "@/lib/ote/reader";
import { packageProject } from "@/lib/ote/packager";
import { applyOps, type Op } from "@/core/ops";
import { createProjectStore } from "@/store/project";
import type { Wire } from "@/lib/ote/bindings";

const [src, out] = process.argv.slice(2);
const read = await readProject(new Uint8Array(readFileSync(src)), src);
const screen = read.screens.find((s) => s.Name === "PumpStation1");
if (!screen) throw new Error("PumpStation1 not in the sample");

const store = createProjectStore();
store.getState().hydrate({
  name: read.name, target: read.target, screens: structuredClone(read.screens), activeScreenId: screen.UniqueId,
  variables: structuredClone(read.variables), alarms: structuredClone(read.alarms),
  bindings: read.wires.map((w) => ({ tag: w.tag, targetId: w.part.UniqueId, targetName: w.part.Name, property: w.property })),
} as never);

const ops: Op[] = [
  { op: "addObject", type: "Switch", name: "Btn_Start", text: "START", note: "start button" },
  { op: "addObject", type: "Switch", name: "Btn_Stop", text: "STOP", note: "stop button" },
  { op: "addObject", type: "TextBox", name: "Lbl_Mode", text: "Mode: AUTO", note: "label" },
  { op: "addObject", type: "TextBox", name: "Lbl_Duty", text: "Duty pump: PMP101", note: "label" },
  { op: "moveObject", target: "Btn_Start", left: 24, top: 262, note: "place" },
  { op: "resizeObject", target: "Btn_Start", width: 120, height: 44, note: "size" },
  { op: "moveObject", target: "Btn_Stop", left: 168, top: 276, note: "place, 14 px lower" },
  { op: "resizeObject", target: "Btn_Stop", width: 104, height: 36, note: "size" },
  { op: "moveObject", target: "Lbl_Mode", left: 360, top: 270, note: "place" },
  { op: "resizeObject", target: "Lbl_Mode", width: 200, height: 20, note: "size" },
  { op: "moveObject", target: "Lbl_Duty", left: 420, top: 278, note: "place, overlapping Lbl_Mode" },
  { op: "resizeObject", target: "Lbl_Duty", width: 200, height: 20, note: "size" },
];
const outcome = applyOps(ops, store);
if (outcome.rejected.length) throw new Error(`scenario ops rejected: ${JSON.stringify(outcome.rejected)}`);

const s = store.getState();
const byId = new Map(s.screens.flatMap((sc) => sc.Children[0].Children.map((p) => [p.UniqueId, { part: p, screenId: sc.UniqueId }] as const)));
const wires: Wire[] = s.bindings.flatMap((b) => {
  const f = byId.get(b.targetId);
  return f ? [{ part: f.part, tag: b.tag, property: b.property, screenId: f.screenId }] : [];
});
const bytes = await packageProject({ ...read, screens: s.screens, variables: s.variables, alarms: s.alarms, wires }, undefined, read.preserved);
const back = await readProject(bytes, out);
const ps = back.screens.find((x) => x.Name === "PumpStation1")!;
const names = ps.Children[0].Children.map((p) => p.Name);
for (const n of ["Btn_Start", "Btn_Stop", "Lbl_Mode", "Lbl_Duty"]) if (!names.includes(n)) throw new Error(`${n} did not survive the round trip`);
writeFileSync(out, bytes);
console.log(`wrote ${out}: ${bytes.length} bytes, PumpStation1 has ${names.length} parts`);
