/**
 * Survey a directory of `.vxdz` files and report what is actually in them.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/mine-vxdz.mts <dir>
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/mine-vxdz.mts <dir> --json out.json
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/mine-vxdz.mts <dir> --type Grid
 *
 * A `.vxdz` is the same family as an `.eote`: a ZIP of JSON `.dat` and SQLite
 * `.db`, backslash entry separators, `_metadata` with null encryption. What it
 * is *not* is one format. This corpus holds two generations, and the script
 * reports which one each file is because the difference decides everything
 * downstream:
 *
 *   - **struct** (AppVersion 3.1.100 - 3.3.120). Screens live at
 *     `Contents\panelN.dat` and `Screens\panelN.dat`; an object is a
 *     `{Type, Name, Properties[], Children[]}` node and every property is a
 *     `{Name, FullName, Type, Value}` record. Nothing in `lib/ote` can read it.
 *   - **typed** (AppVersion 3.4.1 and later). Screens live at
 *     `Screens\<guid>\Screen.dat`, exactly where ours do, and an object is a
 *     part with typed fields - `Location: {Left, Top}`, `Fill: {Color:{Value}}`.
 *     This is the shape `lib/ote/schema.ts` already models.
 *
 * docs/VXDZ_FINDINGS.md is written from this script's output.
 *
 * Read-only by construction: it opens archives outside the repository and
 * writes nothing except to stdout and, with --json, to a path you name. The
 * corpus is Schneider's and never enters this repository - docs/TASK_VXDZ.md §4.
 *
 * Three things are reported, because three different questions get asked of a
 * format nobody here has read before:
 *
 *   - which object types exist, how often, and in which files, so "is this
 *     worth modelling?" has a number behind it rather than an impression;
 *   - which properties each type carries and on what fraction of instances,
 *     because a property on 3 of 2309 objects is optional and one on all of
 *     them is structural, and that difference is the whole of a schema;
 *   - what each file targets, since a screen that assumes 480x272 says nothing
 *     about one drawn for 1024x768.
 */

import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

/* ---------------------------------------------------------------- shapes */

/**
 * One property as 3.1 writes it. `Value` is `unknown` deliberately: it is a
 * scalar for `Int`/`String`/`Bool`/`Enum` and a nested property array for
 * `Struct`, and pretending otherwise would be the first invented fact.
 */
interface Prop {
  Name?: string;
  FullName?: string;
  Type?: string;
  Value?: unknown;
  Bindable?: number;
}

/** A node in the `GraphicalObjects` tree. */
interface Node {
  Type?: string;
  Name?: string;
  Properties?: Prop[];
  Children?: Node[];
}

interface TypeStat {
  count: number;
  files: Set<string>;
  /** property FullName -> how many instances of this type carried it */
  props: Map<string, number>;
  /** property FullName -> the `Type` tag seen on it, for the schema table */
  propTypes: Map<string, Set<string>>;
  /** property FullName -> one real value, for the findings document */
  sample: Map<string, unknown>;
  /** the first instance seen whole, as a capture candidate */
  example?: { file: string; entry: string; node: Node };
}

/** Which of the two layouts a file is in. See the header. */
type Layout = "struct" | "typed";

interface FileStat {
  file: string;
  layout: Layout;
  brand: string | null;
  appVersion: string;
  versionModified: string;
  colorSet: number | null;
  width: number | null;
  height: number | null;
  /** the hex baseboard id the struct layout writes; not a friendly model name */
  modelName: string | null;
  targetName: string | null;
  entries: string[];
  screens: number;
  contents: number;
  objects: number;
}

/* ---------------------------------------------------------------- walking */

const isNode = (v: unknown): v is Node =>
  typeof v === "object" && v !== null && typeof (v as Node).Type === "string";

/**
 * Flatten a property array to `FullName -> Value`, descending into `Struct`.
 *
 * `FullName` is already the dotted path 3.1 itself uses
 * (`NavigationSwitch.IconPathInfo.IconPath`), so the flattening agrees with the
 * file's own naming rather than inventing a convention. Where a nested struct
 * omits it, the parent path is prepended so nothing collapses onto a bare name.
 */
function flatten(props: Prop[] | undefined, prefix = "", out = new Map<string, Prop>()): Map<string, Prop> {
  if (!Array.isArray(props)) return out;
  for (const p of props) {
    if (!p || typeof p !== "object") continue;
    const name = p.FullName ?? (prefix ? `${prefix}.${p.Name ?? "?"}` : p.Name ?? "?");
    out.set(name, p);
    if (p.Type === "Struct" && Array.isArray(p.Value)) {
      flatten(p.Value as Prop[], name, out);
    }
  }
  return out;
}

/** Walk a `GraphicalObjects` tree, yielding every node including the root. */
function* walk(node: unknown): Generator<Node> {
  if (!isNode(node)) return;
  yield node;
  for (const child of node.Children ?? []) yield* walk(child);
}

/* ---------------------------------------------------------------- mining */

/** Counted separately, because a type name shared across layouts is not
 *  evidence that the shape behind it is shared - that is the thing to check. */
const types = { struct: new Map<string, TypeStat>(), typed: new Map<string, TypeStat>() };
const files: FileStat[] = [];
const errors: { file: string; entry: string; error: string }[] = [];

function stats(layout: Layout, type: string): TypeStat {
  const table = types[layout];
  let stat = table.get(type);
  if (!stat) {
    stat = { count: 0, files: new Set(), props: new Map(), propTypes: new Map(), sample: new Map() };
    table.set(type, stat);
  }
  return stat;
}

/** A struct-layout node: properties come out of `Properties[]`. */
function record(type: string, node: Node, file: string, entry: string) {
  const stat = stats("struct", type);
  stat.count += 1;
  stat.files.add(file);
  if (!stat.example) stat.example = { file, entry, node };

  for (const [name, prop] of flatten(node.Properties)) {
    stat.props.set(name, (stat.props.get(name) ?? 0) + 1);
    if (prop.Type) {
      const seen = stat.propTypes.get(name) ?? new Set<string>();
      seen.add(prop.Type);
      stat.propTypes.set(name, seen);
    }
    // Keep one non-empty value per property. A struct's own value is its
    // children, which are recorded separately, so it is skipped here.
    if (!stat.sample.has(name) && prop.Type !== "Struct" && prop.Value !== undefined && prop.Value !== "") {
      stat.sample.set(name, prop.Value);
    }
  }
}

/**
 * A typed-layout node: the object's own keys are the properties.
 *
 * `Children` is excluded because it is the tree, not a property of the object,
 * and `Type` because it is the key this is filed under. Nested objects are
 * flattened to dotted paths so the two layouts' reports read the same way:
 * `Fill.Color.Value` here is the counterpart of `Fill.Color.Value` there.
 */
function recordTyped(node: Record<string, unknown>, file: string, entry: string) {
  const type = String(node.Type);
  const stat = stats("typed", type);
  stat.count += 1;
  stat.files.add(file);
  if (!stat.example) stat.example = { file, entry, node: node as Node };

  const visit = (value: unknown, prefix: string) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      stat.props.set(prefix, (stat.props.get(prefix) ?? 0) + 1);
      stat.propTypes.set(prefix, new Set(["Array"]));
      return;
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        visit(v, prefix ? `${prefix}.${k}` : k);
      }
      return;
    }
    stat.props.set(prefix, (stat.props.get(prefix) ?? 0) + 1);
    const kinds = stat.propTypes.get(prefix) ?? new Set<string>();
    kinds.add(typeof value === "number" ? (Number.isInteger(value) ? "Int" : "Double") : typeof value === "boolean" ? "Bool" : "String");
    stat.propTypes.set(prefix, kinds);
    if (!stat.sample.has(prefix) && value !== "") stat.sample.set(prefix, value);
  };

  for (const [key, value] of Object.entries(node)) {
    if (key === "Children" || key === "Type") continue;
    visit(value, key);
  }
}

/** Walk a typed-layout tree, yielding every node that names a Type. */
function* walkTyped(node: unknown): Generator<Record<string, unknown>> {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  if (typeof n.Type === "string") yield n;
  for (const child of (n.Children as unknown[]) ?? []) yield* walkTyped(child);
}

/** Read one property out of a 3.1 `Properties[]` by dotted path. */
function prop(props: Prop[] | undefined, fullName: string): unknown {
  return flatten(props).get(fullName)?.Value;
}

async function mine(file: string) {
  const bytes = await fs.readFile(file);
  const zip = await JSZip.loadAsync(bytes);
  const name = path.basename(file);

  // JSZip normalises the backslash separators the product writes, so an entry
  // is matched on either. The same quirk is handled in lib/ote/packager.ts.
  const entries = Object.keys(zip.files).filter((e) => !zip.files[e].dir);
  const read = async (entry: string): Promise<unknown> => {
    const f = zip.files[entry];
    if (!f) return undefined;
    const text = await f.async("string");
    return text.trim() ? JSON.parse(text) : undefined;
  };

  // The layout announces itself in the entry names: a guid-per-screen folder
  // is the modern one, `Contents\panelN.dat` the older. Decided on the entries
  // rather than on AppVersion, so a file is classified by what it contains.
  const layout: Layout = entries.some((e) => /Screens[\\/][0-9a-f-]{36}[\\/]Screen\.dat$/i.test(e))
    ? "typed"
    : "struct";

  const stat: FileStat = {
    file: name,
    layout,
    brand: null,
    appVersion: "?",
    versionModified: "?",
    colorSet: null,
    width: null,
    height: null,
    modelName: null,
    targetName: null,
    entries,
    screens: 0,
    contents: 0,
    objects: 0,
  };

  try {
    const project = (await read("Project.dat")) as Record<string, unknown> | undefined;
    if (project) {
      stat.appVersion = String(project.AppVersion ?? "?");
      stat.versionModified = String(project.VersionModified ?? "?");
      stat.brand = (project.Brand as string | undefined) ?? null;
      if (layout === "struct") {
        // Presentation and Target are arrays of single-key objects here.
        const find = <T,>(list: unknown, key: string): T | undefined => {
          if (!Array.isArray(list)) return undefined;
          for (const item of list) {
            if (item && typeof item === "object" && key in item) return (item as Record<string, T>)[key];
          }
          return undefined;
        };
        stat.colorSet = find<{ Id?: number }>(project.Presentation, "ColorSet")?.Id ?? null;
        const resolution = find<{ Width?: number; Height?: number }>(project.Target, "Resolution");
        stat.width = resolution?.Width ?? null;
        stat.height = resolution?.Height ?? null;
      } else {
        // The modern Project.dat is flat, and carries no resolution at all -
        // that moved to Target.dat. Recorded as null rather than guessed.
        stat.colorSet = typeof project.ColorSet === "number" ? project.ColorSet : null;
      }
    }
  } catch (error) {
    errors.push({ file: name, entry: "Project.dat", error: String(error) });
  }

  try {
    const target = (await read("Target.dat")) as Record<string, unknown> | undefined;
    if (target && layout === "struct") {
      const props = target.Properties as Prop[] | undefined;
      stat.modelName = (prop(props, "Preferences.ModelName") as string | undefined) ?? null;
      stat.targetName = (prop(props, "Preferences.TargetName") as string | undefined) ?? null;
    } else if (target) {
      // The modern Target.dat names the panel properly - HMIST6500, not a
      // baseboard id - and writes the resolution as "1024 x 600".
      const info = target.TargetInfo as Record<string, string> | undefined;
      const prefs = target.Preferences as Record<string, string> | undefined;
      stat.modelName = info?.RuntimeModel ?? prefs?.ModelName ?? null;
      stat.targetName = prefs?.TargetName ?? null;
      const size = /(\d+)\s*x\s*(\d+)/.exec(info?.Resolution ?? "");
      if (size) {
        stat.width = Number(size[1]);
        stat.height = Number(size[2]);
      }
    }
  } catch (error) {
    errors.push({ file: name, entry: "Target.dat", error: String(error) });
  }

  // Every .dat that carries objects, wherever it lives. Walked by entry rather
  // than by a guessed path because the two layouts put screens in different
  // places, and a survey that looked only where it expected to would have
  // reported ten files as empty - which is exactly what the first run did.
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith(".dat")) continue;
    if (entry.toLowerCase().includes(".binding.")) continue;
    let doc: unknown;
    try {
      doc = await read(entry);
    } catch (error) {
      errors.push({ file: name, entry, error: String(error) });
      continue;
    }
    if (!doc || typeof doc !== "object") continue;

    const kind = (doc as { Type?: string }).Type;

    if (layout === "struct") {
      const root = (doc as { GraphicalObjects?: unknown }).GraphicalObjects;
      if (!root) continue;
      if (kind === "Screen") stat.screens += 1;
      if (kind === "Content") stat.contents += 1;
      // The container itself is an object with properties worth counting.
      if (isNode(doc)) record(String(kind), doc as Node, name, entry);
      for (const node of walk(root)) {
        if (!node.Type) continue;
        record(node.Type, node, name, entry);
        stat.objects += 1;
      }
    } else {
      // Only the screen documents carry a part tree; Resources.dat and the
      // rest have a Type but no Children, and counting them as screens would
      // inflate the number this report exists to give.
      if (!/Screen\.dat$/i.test(entry)) continue;
      if (/^Screens[\\/]/i.test(entry)) stat.screens += 1;
      else if (/^Contents[\\/]/i.test(entry)) stat.contents += 1;
      for (const node of walkTyped(doc)) {
        recordTyped(node, name, entry);
        stat.objects += 1;
      }
    }
  }

  files.push(stat);
}

/* ---------------------------------------------------------------- output */

function pct(n: number, total: number) {
  return `${((n / total) * 100).toFixed(0)}%`.padStart(4);
}

function truncate(value: unknown, max = 48) {
  const text = typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value) ?? "undefined";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function reportLayout(layout: Layout, only?: string) {
  const table = types[layout];
  if (table.size === 0) return;
  const sorted = [...table.entries()].sort((a, b) => b[1].count - a[1].count);
  const inLayout = files.filter((f) => f.layout === layout);

  console.log(
    `\n${"=".repeat(78)}\nOBJECT TYPES — ${layout.toUpperCase()} LAYOUT` +
      ` — ${table.size} distinct, ${inLayout.length} files\n${"=".repeat(78)}\n`,
  );
  console.log(`${"type".padEnd(22)}${"count".padStart(7)}${"files".padStart(7)}   first seen in`);
  console.log("-".repeat(78));
  for (const [type, stat] of sorted) {
    const first = stat.example ? `${stat.example.file} ${stat.example.entry}` : "";
    console.log(
      `${type.padEnd(22)}${String(stat.count).padStart(7)}${String(stat.files.size).padStart(7)}   ${first}`,
    );
  }

  console.log(`\n${"=".repeat(78)}\nPROPERTIES PER TYPE — ${layout.toUpperCase()} LAYOUT\n${"=".repeat(78)}`);
  console.log("\npresence is the share of instances of that type carrying the property:");
  console.log("100% is structural, anything less is optional.\n");
  for (const [type, stat] of sorted) {
    if (only && type !== only) continue;
    console.log(`\n${type}  (${stat.count} instance${stat.count === 1 ? "" : "s"}, ${stat.files.size} file${stat.files.size === 1 ? "" : "s"})`);
    console.log("-".repeat(78));
    const props = [...stat.props.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    for (const [name, seen] of props) {
      const kinds = [...(stat.propTypes.get(name) ?? [])].join("|") || "?";
      const sample = stat.sample.has(name) ? `  e.g. ${truncate(stat.sample.get(name))}` : "";
      console.log(`  ${pct(seen, stat.count)}  ${name.padEnd(42)} ${kinds.padEnd(10)}${sample}`);
    }
  }
}

function report(only?: string) {
  const struct = files.filter((f) => f.layout === "struct").length;
  const typed = files.length - struct;
  console.log(
    `\n${files.length} files: ${struct} in the struct layout (Contents\\panelN.dat),` +
      ` ${typed} in the typed layout (Screens\\<guid>\\Screen.dat).`,
  );

  reportLayout("struct", only);
  reportLayout("typed", only);

  console.log(`\n${"=".repeat(78)}\nTARGET PER FILE\n${"=".repeat(78)}\n`);
  console.log(
    `${"file".padEnd(42)}${"layout".padEnd(8)}${"app".padEnd(9)}${"resolution".padEnd(12)}` +
      `${"cs".padStart(3)}${"scr".padStart(5)}${"cnt".padStart(5)}${"objects".padStart(9)}  model`,
  );
  console.log("-".repeat(118));
  for (const f of [...files].sort((a, b) => a.layout.localeCompare(b.layout) || a.file.localeCompare(b.file))) {
    const res = f.width && f.height ? `${f.width}x${f.height}` : "?";
    console.log(
      `${f.file.slice(0, 41).padEnd(42)}${f.layout.padEnd(8)}${f.appVersion.padEnd(9)}${res.padEnd(12)}` +
        `${String(f.colorSet ?? "?").padStart(3)}${String(f.screens).padStart(5)}${String(f.contents).padStart(5)}` +
        `${String(f.objects).padStart(9)}  ${f.modelName ?? "?"}${f.targetName ? ` (${f.targetName})` : ""}`,
    );
  }

  const tally = (pick: (f: FileStat) => string) => {
    const m = new Map<string, number>();
    for (const f of files) m.set(pick(f), (m.get(pick(f)) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`).join(", ");
  };
  console.log(`\nresolutions:  ${tally((f) => (f.width && f.height ? `${f.width}x${f.height}` : "?"))}`);
  console.log(`app versions: ${tally((f) => f.appVersion)}`);
  console.log(`brands:       ${tally((f) => f.brand ?? "?")}`);
  console.log(`colour sets:  ${tally((f) => String(f.colorSet ?? "?"))}`);
  console.log(`total objects: ${files.reduce((n, f) => n + f.objects, 0)}`);

  if (errors.length) {
    console.log(`\n${"=".repeat(78)}\nUNREADABLE (${errors.length})\n${"=".repeat(78)}\n`);
    for (const e of errors) console.log(`  ${e.file}  ${e.entry}  ${e.error.slice(0, 90)}`);
  }
}

/** The machine-readable form, so the findings document quotes real numbers. */
function toJson() {
  const table = (layout: Layout) =>
    Object.fromEntries(
      [...types[layout].entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .map(([type, stat]) => [
          type,
          {
            count: stat.count,
            files: stat.files.size,
            example: stat.example ? { file: stat.example.file, entry: stat.example.entry } : null,
            properties: Object.fromEntries(
              [...stat.props.entries()]
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([name, seen]) => [
                  name,
                  {
                    seen,
                    presence: +(seen / stat.count).toFixed(4),
                    types: [...(stat.propTypes.get(name) ?? [])],
                    sample: stat.sample.get(name) ?? null,
                  },
                ]),
            ),
          },
        ]),
    );
  return {
    generated: new Date().toISOString(),
    files: files.map((f) => ({ ...f, entries: f.entries.length })),
    struct: table("struct"),
    typed: table("typed"),
  };
}

/* ---------------------------------------------------------------- main */

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const jsonAt = args.indexOf("--json");
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : undefined;
const typeAt = args.indexOf("--type");
const only = typeAt >= 0 ? args[typeAt + 1] : undefined;

if (!dir) {
  console.error("usage: mine-vxdz.mts <dir> [--type <Type>] [--json <out.json>]");
  console.error("       <dir> is a directory of .vxdz files, outside this repository");
  process.exit(2);
}

async function find(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...(await find(full)));
    else if (entry.name.toLowerCase().endsWith(".vxdz")) out.push(full);
  }
  return out;
}

const found = await find(dir);
if (found.length === 0) {
  console.error(`no .vxdz files under ${dir}`);
  process.exit(1);
}
console.error(`reading ${found.length} .vxdz files from ${dir}…`);

for (const file of found.sort()) {
  try {
    await mine(file);
  } catch (error) {
    errors.push({ file: path.basename(file), entry: "(archive)", error: String(error) });
  }
}

report(only);

if (jsonOut) {
  await fs.writeFile(jsonOut, JSON.stringify(toJson(), null, 2) + "\n");
  console.error(`\nwrote ${jsonOut}`);
}
