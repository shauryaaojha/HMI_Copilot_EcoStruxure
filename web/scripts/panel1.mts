/**
 * Generates screens from the tags of a real project and writes them back into
 * that project, for downloading to the panel it was made for.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/panel1.mts [in.eote] [out.eote] ["intent"]
 *
 * Defaults to samples/hmi-panel-1 (HMIST6600 + M251 + ATV340). The project is
 * opened, not rebuilt: the PLC connection, the symbol tags, the scripts and the
 * screens the engineer drew stay byte for byte; the new screens are added
 * beside them and bind to the PLC symbols by their full names.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { runPipeline } from "../src/lib/ai/pipeline.js";
import { packageProject, type PackageInput } from "../src/lib/ote/packager.js";
import { screenOf } from "../src/lib/ote/parts.js";
import { readProject } from "../src/lib/ote/reader.js";
import { preflight } from "../src/lib/ote/preflight.js";
import type { Part } from "../src/lib/ote/schema.js";
import type { Wire } from "../src/lib/ote/bindings.js";

const root = path.join(process.cwd(), "..");
const IN = process.argv[2] ?? path.join(root, "samples", "hmi-panel-1", "auto-manual.eote");
const OUT = process.argv[3] ?? path.join(root, "demo_project", "HMICopilot_Panel1.eote");
const INTENT =
  process.argv[4] ??
  "Motor drive screens for an ATV340 drive run by an M251 PLC: drive overview with frequency, current, voltage, power, torque, thermal state, run and fault status, and start, stop, reset and auto/manual commands.";

const read = await readProject(new Uint8Array(await fs.readFile(IN)), path.basename(IN));

// The process tags only: PLC housekeeping (compiler and runtime versions, I/O
// configuration, timer internals, bit/word helpers) is not something an
// operator looks at, and the scratch Var1..Var5 feed the web server script.
const refs = read.preserved.variableRefs ?? {};
const housekeeping = /\.(Constants|IoConfig_Globals)\./;
const variables = read.variables.filter((v) => {
  if (v.Name.includes(".") || v.Name.includes("[")) return false;
  if (/^(Var\d+|BIT_AS_WORD_\d+|WORD_AS_BIT_\d+)$/.test(v.Name)) return false;
  return !housekeeping.test(refs[v.Name]?.fullName ?? "");
});

const panel = { model: read.target.model, width: read.target.width, height: read.target.height };
// Content panels are embedded in screens, never navigated to.
const existing = read.screens.filter((s) => s.Type !== "Content").map((s) => ({ name: s.Name, level: 1 as const, include: [] }));

const partsBy = new Map<string, Part[]>();
const bindings: { tag: string; target: string; property: string; converter?: { min: number; max: number } }[] = [];
let alarms = 0;
for await (const e of runPipeline({ intent: INTENT, variables, panel, existing })) {
  if (e.type === "object") {
    const name = e.screenName ?? "Screen";
    (partsBy.get(name) ?? partsBy.set(name, []).get(name)!).push(e.part);
  }
  if (e.type === "binding") bindings.push(e);
  // The project has no alarm group yet; alarms are a second test, not this one.
  if (e.type === "alarm") alarms++;
  if (e.type === "log") console.log("  ·", e.message);
  if (e.type === "error") throw new Error(e.message);
}

const added = [...partsBy].map(([name, parts]) => screenOf(name, parts, panel));
const owner = new Map(added.flatMap((s) => s.Children[0].Children.map((p) => [p.Name + "@" + s.UniqueId, { part: p, screenId: s.UniqueId }] as const)));
const wires: Wire[] = bindings.flatMap((b) => {
  const found = [...owner.entries()].find(([k]) => k.startsWith(b.target + "@"))?.[1];
  return found ? [{ part: found.part, tag: b.tag, property: b.property, screenId: found.screenId, ...(b.converter ? { converter: b.converter } : {}) }] : [];
});

const input: PackageInput = {
  name: read.name,
  target: panel,
  screens: [...read.screens, ...added],
  variables: read.variables,
  alarms: read.alarms,
  wires: [...read.wires, ...wires],
};
const problems = preflight(input);
if (problems.length) throw new Error(problems.map((p) => `${p.where}: ${p.problem}`).join("\n"));

const bytes = await packageProject(input, undefined, read.preserved);
await fs.writeFile(OUT, bytes);

// Read the export back: every new binding must name a PLC symbol by its full name.
const back = await readProject(bytes, path.basename(OUT));
console.log(`\n${OUT}  ${bytes.length.toLocaleString()} bytes`);
console.log(`  ${variables.length} of ${read.variables.length} tags offered; ${added.length} screens added on ${panel.model} ${panel.width}x${panel.height}`);
for (const s of added) {
  const ws = wires.filter((w) => w.screenId === s.UniqueId);
  console.log(`  ${s.Name}: ${s.Children[0].Children.length} objects, ${ws.length} bindings`);
  for (const w of ws) console.log(`      ${w.part.Name}.${w.property} <- ${refs[w.tag]?.fullName ?? w.tag}`);
}
console.log(`  ${alarms} alarms proposed, not written (no alarm group in this project yet)`);
console.log(`  read back: ${back.screens.length} screens, ${back.wires.length} modelled bindings, warnings: ${back.warnings.join(" | ") || "none"}`);
