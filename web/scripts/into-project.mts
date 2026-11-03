/**
 * Moves the screens of one project into another, for a panel whose editor is
 * older than the one that made them.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/into-project.mts <from.eote> [into.eote] [out.eote] [--replace] [--only Name,Name]
 *
 * The receiving project is opened, not rebuilt: its Project.dat (and so the
 * editor version that opens it), PLC connection, symbol tags, scripts and
 * screens stay byte for byte. The screens of <from> are added beside them and
 * every binding is rewired to the receiving project's tag of the same name, by
 * its full symbol name. Bindings to tags it does not have are dropped and listed.
 *
 * With --replace the receiving project's own screens and contents go, so the
 * result is <from>'s screens on <into>'s version, PLC connection and tags. The
 * screens keep the screen numbers <from> gave them (1 is the start screen).
 * --only takes just the named screens of <from>. Either way the generated
 * navigation strips are rebuilt for the screens the result has, and each part
 * is written as the receiving project's own object where it has one (its
 * push button, entry, display, toggle; lib/ote/exemplars.ts).
 */

import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { packageProject, type PackageInput } from "../src/lib/ote/packager.js";
import { readProject } from "../src/lib/ote/reader.js";
import { preflight } from "../src/lib/ote/preflight.js";
import { refreshNavigation } from "../src/lib/ote/layout.js";
import { harvest, nativise, partsOf } from "../src/lib/ote/exemplars.js";

const root = path.join(process.cwd(), "..");
const REPLACE = process.argv.includes("--replace");
const onlyAt = process.argv.indexOf("--only");
const ONLY = onlyAt > 0 ? new Set(process.argv[onlyAt + 1].split(",")) : undefined;
const [FROM, INTO_ARG, OUT_ARG] = process.argv.slice(2).filter((a, i, all) => a !== "--replace" && a !== "--only" && all[i - 1] !== "--only");
if (!FROM) throw new Error("usage: into-project.mts <from.eote> [into.eote] [out.eote] [--replace]");
const INTO = INTO_ARG ?? path.join(root, "samples", "hmi-panel-1", "auto-manual.eote");
const OUT = OUT_ARG ?? path.join(root, "demo_project", path.basename(FROM, ".eote") + "_4.1.eote");

const from = await readProject(new Uint8Array(await fs.readFile(FROM)), path.basename(FROM));
const into = await readProject(new Uint8Array(await fs.readFile(INTO)), path.basename(INTO));

const tags = new Set(into.variables.map((v) => v.Name));
const taken = new Set(REPLACE ? [] : into.screens.map((s) => s.Name));
const ids = new Set(into.screens.map((s) => s.UniqueId.toLowerCase()));

const added = from.screens.filter((s) => s.Type !== "Content" && (!ONLY || ONLY.has(s.Name))).filter((s) => {
  if (ids.has(s.UniqueId.toLowerCase())) throw new Error(`screen id ${s.UniqueId} is in both projects`);
  return true;
}).map((s) => {
  let name = s.Name;
  for (let i = 2; taken.has(name); i++) name = `${s.Name}_${i}`;
  taken.add(name);
  return name === s.Name ? s : { ...s, Name: name };
});
const addedIds = new Set(added.map((s) => s.UniqueId));

const wires = from.wires.filter((w) => addedIds.has(w.screenId));
const kept = wires.filter((w) => tags.has(w.tag));
const dropped = wires.filter((w) => !tags.has(w.tag));
const alarms = from.alarms.filter((a) => tags.has(a.trigger));

const target = { model: into.target.model, width: into.target.width, height: into.target.height };
const input: PackageInput = {
  name: into.name,
  target,
  screens: refreshNavigation(REPLACE ? added : [...into.screens, ...added], target).screens,
  variables: into.variables,
  alarms: [...into.alarms, ...alarms],
  wires: REPLACE ? kept : [...into.wires, ...kept],
};
const problems = preflight(input);
if (problems.length) throw new Error(problems.map((p) => `${p.where}: ${p.problem}`).join("\n"));

// The bindings the reader carried rather than modelled go with the screens
// they were on; the ones on no screen (scan rates, scripts) stay.
let preserved = into.preserved;
if (REPLACE) {
  const ours = new Set([...addedIds].map((id) => id.toLowerCase()));
  const targets = preserved.extra.targets.filter((t) => !t.ScreenId || ours.has(t.ScreenId.toLowerCase()));
  const live = new Set(targets.map((t) => t.ReferenceId));
  const rows = preserved.extra.bindings.filter((b) => live.has(b.Target));
  const used = new Set(rows.flatMap((b) => String(b.Sources).split(",").map(Number)));
  preserved = { ...preserved, extra: { targets, bindings: rows, sources: preserved.extra.sources.filter((x) => used.has(x.ReferenceId)) } };
}
const native = nativise(input, harvest(into.preserved, into.variables), partsOf(into.preserved));
let bytes = await packageProject(native.input, undefined, preserved);

if (REPLACE) {
  // Everything under Screens\ and Contents\ that is not one of <from>'s screens
  // goes (the packager keeps a folder and a screen it could not model). The
  // screens are numbered 1..n in their order, so the first is screen 1, and
  // every screen-change touch is renumbered with them.
  const out = await JSZip.loadAsync(bytes);
  const norm = (n: string) => n.replace(/\\/g, "/");
  const json = async (f: JSZip.JSZipObject) => JSON.parse((await f.async("string")).replace(/^﻿/, ""));
  const ours = added.map((s) => s.UniqueId.toLowerCase());
  const renumber = new Map<number, number>();
  for (const f of Object.values(out.files)) {
    const [area, id, file] = norm(f.name).split("/");
    if (!file) continue;
    if (area === "Contents" || (area === "Screens" && !ours.includes(id.toLowerCase()))) out.remove(f.name);
    else if (area === "Screens" && file === "Metadata.dat") {
      const meta = await json(f);
      const number = ours.indexOf(id.toLowerCase()) + 1;
      renumber.set(meta.Id, number);
      out.file(f.name, JSON.stringify({ ...meta, Id: number, Order: number - 1 }, null, 2), { createFolders: false });
    }
  }
  for (const f of Object.values(out.files)) {
    const [area, , file] = norm(f.name).split("/");
    if (area !== "Screens" || file !== "Screen.dat") continue;
    const screen = JSON.stringify(await json(f), (key, value) =>
      key === "ClickTrigger" && value?.OperationType === 4 && renumber.has(value.Screen) ? { ...value, Screen: renumber.get(value.Screen) } : value,
    2);
    out.file(f.name, screen, { createFolders: false });
  }
  const entry = (n: string) => Object.values(out.files).find((f) => norm(f.name) === n)?.name;
  out.file(entry("Screens/Hierarchy.dat")!, JSON.stringify(ours.map((id) => ({ ObjectId: id, Children: [] })), null, 2), { createFolders: false });
  const contents = entry("Contents/Hierarchy.dat");
  if (contents) out.file(contents, "[]", { createFolders: false });
  bytes = await out.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
await fs.writeFile(OUT, bytes);

// Read it back: the receiving project's version and PLC connection must be untouched.
const back = await readProject(bytes, path.basename(OUT));
const zip = async (b: Uint8Array) => JSZip.loadAsync(b);
const [a, b] = [await zip(new Uint8Array(await fs.readFile(INTO))), await zip(bytes)];
const same = async (n: string) => (await a.file(n)!.async("base64")) === (await b.file(n)!.async("base64"));
const version = JSON.parse((await b.file("Project.dat")!.async("string")).replace(/^\uFEFF/, ""));
const refs = into.preserved.variableRefs ?? {};

console.log(`${OUT}  ${bytes.length.toLocaleString()} bytes`);
console.log(`  Project.dat VersionModified ${version.VersionModified ?? "?"}, created ${version.VersionCreated ?? "?"}`);
for (const n of ["DriverConfig.db", "Variables.db", "Target.dat", "GlobalScripts.dat"]) console.log(`  ${n} unchanged: ${await same(n)}`);
for (const s of added) console.log(`  + ${s.Name}: ${kept.filter((w) => w.screenId === s.UniqueId).length} bindings`);
for (const w of native.input.wires.filter((w) => addedIds.has(w.screenId ?? "")).slice(0, 8)) console.log(`      ${w.part.Name}.${w.property} <- ${refs[w.tag]?.fullName ?? w.tag}`);
console.log(`  dropped ${dropped.length} bindings to tags the project lacks: ${[...new Set(dropped.map((w) => w.tag))].join(", ") || "none"}`);
console.log(`  alarms: ${alarms.length} of ${from.alarms.length} kept`);
console.log(`  written as the project's own objects: ${native.written.length}`);
for (const w of native.written) console.log(`      ${w.part} -> ${w.as} (like ${w.like})`);
if (native.dropped.length) console.log(`  wires the project's objects cannot take: ${native.dropped.map((d) => `${d.part}.${d.property}`).join(", ")}`);
console.log(`  read back: ${back.screens.length} screens, ${back.wires.length} bindings, warnings: ${back.warnings.join(" | ") || "none"}`);
