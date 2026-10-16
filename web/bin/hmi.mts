/**
 * hmi - EcoStruxure Operator Terminal Expert projects from the command line.
 *
 *   npm run hmi -- <command> [args]
 *
 *   inspect  <file>                    what a project holds, as OTE would list it
 *   validate <file>                    preflight + rules + semantics, every problem at once
 *   convert  <old.vxdz> [-o out.eote]  a 3.1-3.3 project into a new 4.4 one
 *   library  [symbols|cliparts|cos]    what the installed product ships
 *   co       inspect|check|set|rename|build   compound objects (.co), docs/CO_FORMAT.md
 *   bench    <file|dir>                open and simulate in the licensed OTE (Windows)
 *   generate --tags <file> "<goal>" [-o out.eote]   tags + a sentence → a project
 *   agent    --tags <file> "<goal>" [-o out.eote] [--bench] [--rounds n]
 *                                      build, check, repair, prove (docs/AGENTIC_PLAN.md)
 *
 * The product has no command line of its own; this is ours, over the same
 * library code the web app runs, so an engineer or another agent can work
 * with projects without a browser. --json on any command prints the result as
 * JSON instead of a table.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import JSZip from "jszip";
import { layoutOf, readProject } from "../src/lib/ote/reader";
import { readStructProject } from "../src/lib/ote/struct";
import { packageProject, type PackageInput } from "../src/lib/ote/packager";
import { preflight } from "../src/lib/ote/preflight";
import { validateProject } from "../src/lib/validation/rules";
import { parseTagsFile } from "../src/lib/tags/parse";
import { loadSkeleton } from "../src/lib/ote/skeleton";
import { panelOf } from "../src/lib/ote/packager";
import { buildFromTags } from "../src/lib/agent/build";
import { runAgent, type BenchResult } from "../src/lib/agent/loop";
import { mkdtempSync } from "node:fs";
import { checkCo, coWiring, readCo, readCoPackage, renameCo, setCoValues, summarizeCo, writeCo } from "../src/lib/ote/co";
import { buildCo, type CoSpec } from "../src/lib/ote/co-build";
import { tmpdir } from "node:os";

const INSTALL = "C:/Program Files/Schneider Electric/EcoStruxure Operator Terminal Expert 4.4/Buildtime";

/* The model keys and provider, from web/.env.local when present, as the dev
   server reads them. A variable already set in the shell wins. Never printed. */
{
  const env = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../.env.local");
  if (existsSync(env)) {
    for (const line of readFileSync(env, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
const argv = process.argv.slice(2);
const json = argv.includes("--json");
const args = argv.filter((a) => a !== "--json");
const [command, ...rest] = args;

const out = (value: unknown, table: () => void) => (json ? console.log(JSON.stringify(value, null, 2)) : table());
const die = (message: string): never => {
  console.error(`hmi: ${message}`);
  process.exit(1);
};

async function open(file: string) {
  if (!existsSync(file)) die(`${file}: no such file`);
  const bytes = new Uint8Array(readFileSync(file));
  const layout = await layoutOf(bytes);
  const read = layout === "struct" ? await readStructProject(bytes, basename(file)) : await readProject(bytes, basename(file));
  return { bytes, layout, read };
}

const inputOf = (read: Awaited<ReturnType<typeof open>>["read"]): PackageInput => ({
  name: read.name,
  target: read.target,
  screens: read.screens,
  variables: read.variables,
  alarms: read.alarms,
  wires: read.wires,
});

async function inspect(file: string) {
  const { layout, read } = await open(file);
  const screens = read.screens.map((s) => ({
    name: s.Name,
    type: s.Type,
    objects: s.Children[0].Children.length,
    carried: (read.foreign[s.UniqueId] ?? []).length,
    kinds: Object.entries(
      s.Children[0].Children.reduce<Record<string, number>>((m, p) => ((m[p.Type] = (m[p.Type] ?? 0) + 1), m), {}),
    )
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}×${n}`)
      .join(" "),
  }));
  const summary = {
    file,
    layout,
    target: read.target,
    screens: screens.filter((s) => s.type === "Screen").length,
    contentScreens: screens.filter((s) => s.type === "Content").length,
    variables: read.variables.length,
    alarms: read.alarms.length,
    bindings: read.wires.length,
    carried: read.carried,
    warnings: read.warnings,
    screenList: screens,
  };
  out(summary, () => {
    console.log(`${basename(file)}  ${layout} layout  ${read.target.model} ${read.target.width}x${read.target.height}`);
    console.log(`${summary.screens} screens, ${summary.contentScreens} content screens, ${summary.variables} variables, ${summary.alarms} alarms, ${summary.bindings} bindings`);
    for (const s of screens) console.log(`  ${s.type === "Content" ? "content" : "screen "}  ${s.name.padEnd(28)} ${String(s.objects).padStart(4)} obj ${s.carried ? `(+${s.carried} carried)` : ""}  ${s.kinds}`);
    for (const w of read.warnings) console.log(`  ! ${w}`);
  });
}

async function validate(file: string) {
  const { read } = await open(file);
  const input = inputOf(read);
  const pre = preflight(input).map((p) => ({ severity: "error", rule: "preflight", message: `${p.where}: ${p.problem}` }));
  const rules = validateProject(input, read.target).map((f) => ({ severity: f.severity, rule: f.rule, message: f.message }));
  const all = [...pre, ...rules];
  out(all, () => {
    const errors = all.filter((f) => f.severity === "error").length;
    for (const f of all) console.log(`  ${f.severity.padEnd(7)} ${f.rule.padEnd(12)} ${f.message}`);
    console.log(`${basename(file)}: ${errors} error${errors === 1 ? "" : "s"}, ${all.length - errors} other finding${all.length - errors === 1 ? "" : "s"}`);
  });
  if (all.some((f) => f.severity === "error")) process.exitCode = 2;
}

async function convert(file: string, target?: string) {
  const { layout, read } = await open(file);
  if (layout !== "struct") die(`${file} is already in the modern layout; open it directly`);
  const bytes = await packageProject(inputOf(read));
  const dest = target ?? join(dirname(file), `${read.name}.eote`);
  writeFileSync(dest, bytes);
  out({ from: file, to: dest, screens: read.screens.length, variables: read.variables.length, warnings: read.warnings }, () => {
    console.log(`${basename(file)} -> ${dest}: ${read.screens.length} screens, ${read.variables.length} variables`);
    for (const w of read.warnings) console.log(`  ! ${w}`);
  });
}

async function library(kind?: string) {
  if (!existsSync(INSTALL)) die("EcoStruxure Operator Terminal Expert 4.4 is not installed here");
  const G = `${INSTALL}/PropertyDefinitions/ScreenDesign/GraphicObjects`;
  const groups = (dir: string, ext: RegExp) =>
    readdirSync(dir)
      .filter((d) => statSync(join(dir, d)).isDirectory())
      .map((d) => ({ group: d, items: readdirSync(join(dir, d)).filter((f) => ext.test(f)).map((f) => f.replace(ext, "")) }));
  const result: Record<string, unknown> = {};
  if (!kind || kind === "symbols") result.symbols = groups(`${G}/03-Icons`, /\.path$/i);
  if (!kind || kind === "cliparts") result.cliparts = groups(`${G}/04-Cliparts`, /\.png$/i);
  if (!kind || kind === "cos") {
    const pkg = await JSZip.loadAsync(readFileSync(`${INSTALL}/TemplateCOs/COs.pkg`));
    const cos: { name: string; properties: string[] }[] = [];
    for (const name of Object.keys(pkg.files).filter((n) => n.endsWith(".co"))) {
      const co = await JSZip.loadAsync(await pkg.file(name)!.async("uint8array"));
      const entry = (n: string) => Object.keys(co.files).find((k) => k.replace(/\\/g, "/") === n);
      const def = JSON.parse((await co.file(entry("CompoundObject.objdef")!)!.async("string")).replace(/^\uFEFF/, ""));
      const propsEntry = entry("Properties.propDef");
      const props = propsEntry ? JSON.parse((await co.file(propsEntry)!.async("string")).replace(/^\uFEFF/, "")) : [];
      cos.push({ name: def.Name, properties: props.map((p: { PropertyName: string }) => p.PropertyName) });
    }
    result.compoundObjects = cos.sort((a, b) => a.name.localeCompare(b.name));
  }
  out(result, () => {
    for (const [k, v] of Object.entries(result)) {
      const list = v as { group?: string; items?: string[]; name?: string; properties?: string[] }[];
      const total = list.reduce((n, g) => n + (g.items?.length ?? 1), 0);
      console.log(`${k}: ${total}`);
      for (const g of list) console.log(g.items ? `  ${(g.group ?? "").padEnd(18)} ${g.items.length}` : `  ${g.name!.padEnd(18)} ${g.properties!.join(", ")}`);
    }
  });
}

function bench(target: string) {
  if (process.platform !== "win32") die("bench drives the Windows editor; run it on the machine with OTE installed");
  const script = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../scripts/ote-bench-all.ps1");
  const r = spawnSync("powershell", ["-ExecutionPolicy", "Bypass", "-File", script, "-Paths", resolve(target)], { stdio: "inherit" });
  process.exitCode = r.status ?? 1;
}

/** "--tags x.csv" and "-o out" out of the arguments; the rest is the goal. */
function goalArgs(list: string[]) {
  const take = (flag: string) => {
    const i = list.indexOf(flag);
    if (i < 0) return undefined;
    const v = list[i + 1];
    list.splice(i, 2);
    return v;
  };
  const flagOn = (flag: string) => {
    const i = list.indexOf(flag);
    if (i < 0) return false;
    list.splice(i, 1);
    return true;
  };
  const tags = take("--tags") ?? die("needs --tags <file>");
  const o = take("-o");
  const rounds = take("--rounds");
  const bench = flagOn("--bench");
  const goal = list.join(" ").trim() || "an overview of the plant";
  return { tags, o, rounds: rounds ? Number(rounds) : undefined, bench, goal };
}

async function setup(tagsFile: string) {
  if (!existsSync(tagsFile)) die(`${tagsFile}: no such file`);
  const parsed = await parseTagsFile(new Uint8Array(readFileSync(tagsFile)), basename(tagsFile));
  const skeleton = await loadSkeleton().catch(() => die("no project skeleton: run npm run setup:skeleton on a machine with OTE installed"));
  const panel = (await panelOf(skeleton)) ?? { model: "HMIST6500AWADI", width: 1024, height: 600 };
  const name = basename(tagsFile).replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_]+/g, "_") || "Project";
  return { parsed, panel, name };
}

async function generate(list: string[]) {
  const a = goalArgs(list);
  const { parsed, panel, name } = await setup(a.tags);
  const built = await buildFromTags({ name, intent: a.goal, variables: parsed.variables, panel, structure: parsed.structure });
  const bytes = await packageProject(built.input);
  const dest = a.o ?? `${name}.eote`;
  writeFileSync(dest, bytes);
  out({ to: dest, screens: built.input.screens.length, variables: built.input.variables.length, bindings: built.input.wires.length, alarms: built.input.alarms.length }, () =>
    console.log(`${dest}: ${built.input.screens.length} screens, ${built.input.variables.length} tags, ${built.input.wires.length} bindings, ${built.input.alarms.length} alarms`),
  );
}

/** Run the bench on bytes: write them to a temp file and drive the editor. */
function benchBytes(bytes: Uint8Array, name: string): Promise<BenchResult | null> {
  if (process.platform !== "win32") return Promise.resolve(null);
  const dir = mkdtempSync(join(tmpdir(), "hmi-bench-"));
  const file = join(dir, `${name}.eote`);
  writeFileSync(file, bytes);
  const script = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../scripts/ote-bench.ps1");
  const r = spawnSync("powershell", ["-ExecutionPolicy", "Bypass", "-File", script, "-Project", file, "-Out", join(dir, "shots"), "-Wait", "240"], { encoding: "utf8" });
  try {
    return Promise.resolve(JSON.parse(r.stdout) as BenchResult);
  } catch {
    return Promise.resolve(null);
  }
}

async function agent(list: string[]) {
  const a = goalArgs(list);
  const { parsed, panel, name } = await setup(a.tags);
  const steps: unknown[] = [];
  for await (const step of runAgent({ goal: a.goal, name, variables: parsed.variables, panel, rounds: a.rounds, bench: a.bench ? (b) => benchBytes(b, name) : undefined })) {
    if (step.kind === "done") {
      const dest = a.o ?? `${name}.eote`;
      writeFileSync(dest, step.bytes);
      out({ to: dest, steps, report: step.report }, () => {
        console.log(`  done   ${step.message}`);
        console.log(`  wrote  ${dest}`);
        for (const f of step.report.findings.filter((x) => x.severity !== "info").slice(0, 15)) console.log(`         ${f.severity} ${f.rule}: ${f.message}`);
      });
    } else {
      steps.push({ kind: step.kind, message: step.message });
      if (!json) console.log(`  ${step.kind.padEnd(6)} ${step.message}`);
    }
  }
}

/* hmi co: compound objects (lib/ote/co.ts). */
async function co(sub: string | undefined, params: string[]) {
  const o = params.indexOf("-o");
  const output = o >= 0 ? params[o + 1] : undefined;
  const positional = o >= 0 ? params.filter((_, i) => i !== o && i !== o + 1) : params;
  const load = async (file: string) => {
    if (!existsSync(file)) die(`${file}: no such file`);
    return readCo(new Uint8Array(readFileSync(file)));
  };
  const save = async (doc: Awaited<ReturnType<typeof readCo>>, file: string | undefined) => {
    if (!file) die("give the output file with -o out.co");
    writeFileSync(file!, await writeCo(doc));
    console.log(`wrote ${file}`);
  };
  switch (sub) {
    case "inspect": {
      const file = positional[0] ?? die("co inspect needs a .co or .pkg");
      const docs = file.toLowerCase().endsWith(".pkg") ? (await readCoPackage(new Uint8Array(readFileSync(file)))).objects : [await load(file)];
      const result = docs.map((d) => ({ ...summarizeCo(d), wiring: coWiring(d), problems: checkCo(d) }));
      out(result, () => {
        for (const r of result) {
          console.log(`${r.name}  ${r.version} ${r.brand}  ${r.layout}${r.size ? `  ${r.size.width ?? "-"}x${r.size.height ?? "-"}` : ""}  id ${r.id}`);
          console.log(`  parts   ${Object.entries(r.parts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
          console.log(`  props`);
          for (const p of r.properties.filter((p) => !p.group)) {
            const range = p.min !== undefined || p.max !== undefined ? ` [${p.min ?? ""}..${p.max ?? ""}]` : "";
            console.log(`    ${p.path.padEnd(26)} ${p.type.padEnd(12)}${range.padEnd(10)} ${p.value !== undefined ? `= ${JSON.stringify(p.value)}` : ""}${p.label ? `  "${p.label}"` : ""}`);
          }
          const drives = r.wiring.filter((w) => !w.source.startsWith("$"));
          console.log(`  wiring  ${r.wiring.length} bindings${drives.length < r.wiring.length ? ` (${r.wiring.length - drives.length} from local variables)` : ""}`);
          for (const w of drives.slice(0, 24)) console.log(`    ${w.source.padEnd(26)} -> ${w.target}.${w.targetProperty}${w.converter ? `  via ${w.converter}` : ""}`);
          if (drives.length > 24) console.log(`    ... ${drives.length - 24} more`);
          console.log(r.problems.length ? ["  problems", ...r.problems.map((p) => `    ${p}`)].join("\n") : "  consistent");
        }
      });
      break;
    }
    case "check": {
      const target = positional[0] ?? die("co check needs a .co or a directory");
      const files = statSync(target).isDirectory() ? readdirSync(target).filter((f) => f.toLowerCase().endsWith(".co")).map((f) => join(target, f)) : [target];
      let bad = 0;
      for (const f of files) {
        const d = await load(f);
        const back = await readCo(await writeCo(d));
        const changed = [...d.entries].filter(([n, b]) => Buffer.compare(Buffer.from(b), Buffer.from(back.entries.get(n) ?? new Uint8Array())) !== 0).map(([n]) => n);
        const problems = [...checkCo(d), ...changed.map((n) => `${n} did not survive a write unchanged`)];
        if (problems.length) bad++;
        console.log([`${problems.length ? "FAIL" : "ok  "} ${basename(f)}`, ...problems.map((p) => `     ${p}`)].join("\n"));
      }
      console.log(`${files.length - bad}/${files.length} consistent`);
      if (bad) process.exitCode = 2;
      break;
    }
    case "set": {
      const d = await load(positional[0] ?? die("co set needs a .co"));
      const values: Record<string, unknown> = {};
      for (const pair of positional.slice(1)) {
        const eq = pair.indexOf("=");
        if (eq < 1) die(`${pair}: expected Property=value`);
        const raw = pair.slice(eq + 1);
        let value: unknown = raw;
        try { value = JSON.parse(raw); } catch { /* plain text */ }
        values[pair.slice(0, eq)] = value;
      }
      try { setCoValues(d, values); } catch (e) { die((e as Error).message); }
      await save(d, output);
      break;
    }
    case "rename": {
      const d = await load(positional[0] ?? die("co rename needs a .co"));
      try { renameCo(d, positional[1] ?? die("co rename needs the new name")); } catch (e) { die((e as Error).message); }
      await save(d, output);
      break;
    }
    case "build": {
      const specFile = positional[0] ?? die("co build needs a spec .json");
      const spec = JSON.parse(readFileSync(specFile, "utf8")) as CoSpec;
      if (!output) die("give the output file with -o out.co");
      try { writeFileSync(output!, await buildCo(spec)); } catch (e) { die((e as Error).message); }
      console.log(`wrote ${output}`);
      break;
    }
    default:
      die("co inspect <file.co|.pkg> | check <file|dir> | set <in.co> Prop=value... -o out.co | rename <in.co> <Name> -o out.co | build <spec.json> -o out.co");
  }
}

const usage = `hmi <command>
  inspect  <file>                    what a project holds
  validate <file>                    every problem at once (exit 2 on errors)
  convert  <old.vxdz> [-o out.eote]  3.1-3.3 project into a new 4.4 one
  library  [symbols|cliparts|cos]    what the installed product ships
  co       inspect|check|set|rename|build   compound objects (.co)
  bench    <file|dir>                open and simulate in the licensed OTE
  generate --tags <file> "<goal>" [-o out.eote]
  agent    --tags <file> "<goal>" [-o out.eote] [--bench] [--rounds n]
  --json                             machine-readable output`;

switch (command) {
  case "inspect":
    await inspect(rest[0] ?? die("inspect needs a file"));
    break;
  case "validate":
    await validate(rest[0] ?? die("validate needs a file"));
    break;
  case "convert": {
    const o = rest.indexOf("-o");
    await convert(rest[0] ?? die("convert needs a file"), o >= 0 ? rest[o + 1] : undefined);
    break;
  }
  case "library":
    await library(rest[0]);
    break;
  case "co":
    await co(rest[0], rest.slice(1));
    break;
  case "bench":
    bench(rest[0] ?? die("bench needs a file or directory"));
    break;
  case "generate":
    await generate(rest);
    break;
  case "agent":
    await agent(rest);
    break;
  default:
    console.log(usage);
    if (command && command !== "help" && command !== "--help") process.exitCode = 1;
}
