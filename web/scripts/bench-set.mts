/**
 * Write the set of projects the licensed OTE should judge: everything this
 * tool can hand an engineer, made by today's code.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/bench-set.mts <out-dir> [--corpus <dir>] [--templates <dir>]
 *
 *   gen-<sample>.eote     generated from samples/<sample>/tags.csv (no model: AI_PROVIDER=none)
 *   conv-<file>.eote      a 3.1-3.3 .vxdz converted
 *   edit-<file>.eote      an opened project with one object moved on every screen
 *
 * Then: powershell -File scripts/ote-bench-all.ps1 -Paths <out-dir>
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { runPipeline } from "../src/lib/ai/pipeline";
import { packageProject, panelOf, type PackageInput } from "../src/lib/ote/packager";
import { screenOf } from "../src/lib/ote/parts";
import { loadSkeleton } from "../src/lib/ote/skeleton";
import { parseTags } from "../src/lib/tags/parse";
import { layoutOf, readProject } from "../src/lib/ote/reader";
import { readStructProject } from "../src/lib/ote/struct";
import type { Alarm, Part } from "../src/lib/ote/schema";
import type { Wire } from "../src/lib/ote/bindings";

process.env.AI_PROVIDER = "none";
const args = process.argv.slice(2);
const out = args[0] ?? `${process.env.TEMP}/claude/bench-set`;
const opt = (flag: string) => (args.indexOf(flag) >= 0 ? args[args.indexOf(flag) + 1] : undefined);
mkdirSync(out, { recursive: true });
const safe = (s: string) => s.replace(/\.(eote|vxdz)$/i, "").replace(/[^A-Za-z0-9_]+/g, "_");

const skeleton = await loadSkeleton();
const panel = (await panelOf(skeleton)) ?? { model: "HMIST6500AWADI", width: 1024, height: 600 };

// --- generated, one per sample plant ---------------------------------------
const SAMPLES = join(process.cwd(), "..", "samples");
for (const sample of readdirSync(SAMPLES).filter((d) => statSync(join(SAMPLES, d)).isDirectory())) {
  const csv = join(SAMPLES, sample, "tags.csv");
  try {
    const { variables } = parseTags(readFileSync(csv), "tags.csv");
    const partsBy = new Map<string, Part[]>();
    const bindings: { tag: string; target: string; property: string; converter?: { min: number; max: number } }[] = [];
    const alarms: Alarm[] = [];
    for await (const e of runPipeline({ intent: sample.replace(/-/g, " "), variables, panel })) {
      if (e.type === "object") {
        const key = e.screenName ?? "Screen";
        if (!partsBy.has(key)) partsBy.set(key, []);
        partsBy.get(key)!.push(e.part);
      }
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
    const input: PackageInput = { name: safe(sample), target: panel, screens, variables, alarms, wires };
    writeFileSync(join(out, `gen-${safe(sample)}.eote`), await packageProject(input, skeleton));
    console.log(`gen-${safe(sample)}: ${screens.length} screens, ${variables.length} tags, ${wires.length} bindings, ${alarms.length} alarms`);
  } catch (e) {
    console.log(`gen-${sample}: FAILED ${e instanceof Error ? e.message : e}`);
  }
}

// --- converted and edited ----------------------------------------------------
const walk = (p: string, acc: string[] = []) => {
  if (statSync(p).isDirectory()) for (const e of readdirSync(p)) walk(join(p, e), acc);
  else if (/\.(vxdz|eote)$/i.test(p) && !/_backup_\d+\.eote$/i.test(p)) acc.push(p);
  return acc;
};
const pick = (dir: string | undefined, names: string[]) => (dir ? walk(dir).filter((f) => names.length === 0 || names.includes(basename(f))) : []);

for (const file of pick(opt("--corpus"), ["GPS_Tank01.vxdz", "Alarm_ST6400.vxdz", "LayoutTemplate.vxdz", "GPS_Gauge_Flat01.vxdz", "Switch_Cyber01.vxdz", "GPS_Selector01.vxdz"])) {
  const bytes = new Uint8Array(readFileSync(file));
  if ((await layoutOf(bytes)) !== "struct") continue;
  const read = await readStructProject(bytes, basename(file));
  const input: PackageInput = { name: read.name, target: read.target, screens: read.screens, variables: read.variables, alarms: read.alarms, wires: read.wires };
  writeFileSync(join(out, `conv-${safe(basename(file))}.eote`), await packageProject(input, skeleton));
  console.log(`conv-${safe(basename(file))}: ${read.screens.length} screens`);
}

const editable = [...pick(opt("--templates"), []), ...pick(opt("--corpus"), ["GPS_Slider01.vxdz", "HVAC_Symbol01.vxdz", "GPS_Selector04.vxdz"])];
for (const file of editable) {
  const bytes = new Uint8Array(readFileSync(file));
  if ((await layoutOf(bytes)) !== "typed") continue;
  const read = await readProject(bytes, basename(file));
  if (read.screens.length === 0) continue;
  for (const screen of read.screens) {
    const target = screen.Children[0].Children.find((p) => p.Type !== "ContentDisplay" && (p.Width ?? 0) > 0);
    if (target) target.Location = { Left: Math.round(target.Location.Left) + 5, Top: Math.round(target.Location.Top) + 5 };
  }
  const input: PackageInput = { name: read.name, target: read.target, screens: read.screens, variables: read.variables, alarms: read.alarms, wires: read.wires };
  writeFileSync(join(out, `edit-${safe(basename(file))}.eote`), await packageProject(input, undefined, read.preserved));
  console.log(`edit-${safe(basename(file))}: ${read.screens.length} screens`);
}
