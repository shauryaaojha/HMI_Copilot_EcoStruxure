/**
 * IMPORT FIDELITY (audit 2026-11, Part 2). Measured, not estimated.
 *
 * For every .eote and .co on this machine - tracked (git ls-files) and the
 * gitignored engineer projects - it:
 *   1. reads the file with the app's own reader (readProject / readStructProject / readCo);
 *   2. lists screens, part types, the panel model and the driver(s);
 *   3. draws every modelled screen with the server rasteriser (lib/critic/render.ts,
 *      the same call the agent's render_screen makes), and every part alone, to
 *      see whether it draws anything at all;
 *   4. applies one op of each kind - move, resize, set text, set colour, add a
 *      part, delete a part - through core/ops (dryRun + commit, as useChat does),
 *      on a store hydrated exactly as StartPane.openProject hydrates it;
 *   5. exports through the export route's own steps (packageInputOf, preflight,
 *      unsupportedParts, the OTE backend's write, selfCheck), reads the result
 *      again and diffs it against what the store says the project now is: what
 *      should have changed changed, and nothing else did (other parts, carried
 *      objects, other entries, Bindings.dat rows).
 *
 * Client data rule: the output names files, part TYPES, panel MODELS, driver
 * products, counts and percentages. Error texts are scrubbed of every part,
 * screen and tag name the file holds before they are recorded.
 *
 *   cd web && MONGODB_URI= npx tsx --tsconfig scripts/tsconfig.json scripts/audit/fidelity.mts [--out <file.json>] [--renders <dir>]
 *
 * Writes the full results as JSON to --out (default: $AUDIT_OUT_DIR, else
 * <os tmpdir>/hmi-copilot-audit, never the repository) and prints the summary JSON.
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import { layoutOf, readProject, type ReadProject } from "../../src/lib/ote/reader";
import { readStructProject } from "../../src/lib/ote/struct";
import { openDatabase } from "../../src/lib/ote/packager";
import { preflight, selfCheck } from "../../src/lib/ote/preflight";
import { readCo, writeCo, coProperties, setCoValues, checkCo, type CompoundObject as Co, type CoNode } from "../../src/lib/ote/co";
import { coLooks } from "../../src/lib/ote/co-look";
import { OTE } from "../../src/lib/backend/ote";
import { unsupportedParts } from "../../src/lib/backend/types";
import { packageInputOf } from "../../src/lib/collab/package";
import { createProjectStore } from "../../src/store/project";
import { DEFAULT_STANDARDS } from "../../src/store/types";
import { applyOps, commit, dryRun, handleOf, type Op } from "../../src/core/ops";
import { RED } from "../../src/lib/ote/palette";
import type { Part, Screen } from "../../src/lib/ote/schema";
import { screenToPng, screenToSvg } from "../../src/lib/critic/render";

type Json = Record<string, unknown>;
const here = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(here, "..", "..");
const ROOT = resolve(WEB, "..");
// Outside the repository on purpose: renders of the engineer projects must never be committed.
const SCRATCH = process.env.AUDIT_OUT_DIR ?? join(tmpdir(), "hmi-copilot-audit");
mkdirSync(SCRATCH, { recursive: true });
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const OUT = arg("--out") ?? join(SCRATCH, "fidelity-results.json");
const RENDERS = arg("--renders") ?? join(SCRATCH, "renders");
const NO_PNG = process.argv.includes("--no-png");

/* ------------------------------------------------------------------ corpus */

const slash = (s: string) => s.split("\\").join("/");
function corpus(): { path: string; tracked: boolean }[] {
  const tracked = execSync("git ls-files -- \"*.eote\" \"*.co\" \"*.vxdz\"", { cwd: ROOT, encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean)
    .map((p) => ({ path: join(ROOT, p), tracked: true }));
  const ignored: { path: string; tracked: boolean }[] = [];
  const walk = (dir: string, deep: boolean) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) {
        if (deep) walk(p, true);
      } else if (/\.(eote|vxdz|co)$/i.test(e) && !/_backup_\d+\.eote$/i.test(e)) ignored.push({ path: p, tracked: false });
    }
  };
  walk(join(ROOT, "demo_project"), false);
  walk(join(ROOT, "samples"), true);
  for (const e of readdirSync(ROOT)) if (/\.(eote|vxdz)$/i.test(e)) ignored.push({ path: join(ROOT, e), tracked: false });
  const seen = new Set(tracked.map((t) => resolve(t.path).toLowerCase()));
  return [...tracked, ...ignored.filter((f) => !seen.has(resolve(f.path).toLowerCase()))];
}

/* ------------------------------------------------------------------ scrubbing */

/** Replaces every name the file holds (parts, screens, tags) so no client string is recorded. */
function scrubber(names: Iterable<string>) {
  const list = [...new Set([...names].filter((n) => n && n.length >= 2))].sort((a, b) => b.length - a.length);
  return (text: string) => {
    let out = text;
    for (const n of list) if (out.includes(n)) out = out.split(n).join("<name>");
    // Quoted strings and GUIDs carry nothing the summary needs.
    return out.replace(/"[^"]{1,80}"/g, '"<text>"').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>").slice(0, 240);
  };
}

/* ------------------------------------------------------------------ raw trees */

/** JSON with keys sorted: key order is not a change. */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Json)[k]])) : x));
/** Leaf paths where two values differ, arrays by position: the field names only, never values. */
function diffPaths(a: unknown, b: unknown, at = "", out: string[] = []): string[] {
  if (out.length >= 6) return out;
  if (canon(a) === canon(b)) return out;
  const oa = a && typeof a === "object", ob = b && typeof b === "object";
  if (!oa || !ob) {
    out.push(`${at || "(root)"}${a === undefined ? "+" : b === undefined ? "-" : "~"}`);
    return out;
  }
  for (const k of new Set([...Object.keys(a as Json), ...Object.keys(b as Json)])) diffPaths((a as Json)[k], (b as Json)[k], at ? `${at}.${k}` : k, out);
  return out;
}
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const CONTAINERS = new Set(["Grid", "Canvas", "ViewBox", "StackPanel", "WrapPanel", "DockPanel", "ScrollCanvas", "ZoomCanvas", "Group", "Border"]);

/** Every object with a UniqueId and Type below each screen root, by id, with its raw JSON. */
async function rawObjects(zip: JSZip): Promise<Map<string, { type: string; raw: Json; area: string; screen: string; screenType: string }>> {
  const found = new Map<string, { type: string; raw: Json; area: string; screen: string; screenType: string }>();
  for (const f of Object.values(zip.files)) {
    const m = slash(f.name).match(/^(Screens|Contents)\/([^/]+)\/Screen\.dat$/i);
    if (!m) continue;
    let doc: Json;
    try {
      doc = JSON.parse((await f.async("string")).replace(/^\uFEFF/, "")) as Json;
    } catch {
      continue;
    }
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!isObj(node)) return;
      if (typeof node.UniqueId === "string" && typeof node.Type === "string") {
        found.set(node.UniqueId.toLowerCase(), { type: node.Type, raw: node, area: m[1], screen: m[2].toLowerCase(), screenType: String(doc.Type) });
      }
      if (Array.isArray(node.Children)) walk(node.Children);
    };
    for (const root of (doc.Children as unknown[]) ?? []) {
      if (isObj(root) && Array.isArray(root.Children)) walk(root.Children);
    }
  }
  return found;
}

/** A part type as the summary names it: a Compound Object instance by its kind, not its definition. */
const typeOf = (t: string) => (t.startsWith("CompoundObject.") ? "CompoundObject" : t);

async function entryMap(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const m = new Map<string, Uint8Array>();
  for (const [n, f] of Object.entries(zip.files)) if (!f.dir) m.set(n, await f.async("uint8array"));
  return { zip, entries: m };
}

async function drivers(entries: Map<string, Uint8Array>): Promise<string[]> {
  const name = [...entries.keys()].find((n) => /(^|[\\/])DriverConfig\.db$/i.test(n));
  if (!name) return [];
  const db = await openDatabase(entries.get(name)!);
  try {
    const rows = db.exec('SELECT "DisplayName", "InternalName" FROM Drivers')[0]?.values ?? [];
    // Driver products only: the manufacturer and the driver's internal product name.
    return rows.map((r) => `${r[0]} / ${r[1]}`);
  } catch {
    return ["(DriverConfig.db unreadable)"];
  } finally {
    db.close();
  }
}

async function variableTypes(entries: Map<string, Uint8Array>): Promise<Record<string, number>> {
  const name = [...entries.keys()].find((n) => /^Variables\.db$/i.test(n));
  if (!name) return {};
  const db = await openDatabase(entries.get(name)!);
  try {
    const rows = db.exec('SELECT "DataType", COUNT(*) FROM Variables GROUP BY "DataType"')[0]?.values ?? [];
    return Object.fromEntries(rows.map((r) => [String(r[0]), Number(r[1])]));
  } catch {
    return {};
  } finally {
    db.close();
  }
}

/* ------------------------------------------------------------------ store */

/** The import route's answer, through JSON, hydrated as StartPane.openProject does. */
function storeFrom(read: ReadProject, source: string) {
  const data = JSON.parse(
    JSON.stringify({
      name: read.name,
      target: read.target,
      screens: read.screens,
      foreign: read.foreign,
      variables: read.variables,
      alarms: read.alarms,
      bindings: read.wires.map((w) => ({
        tag: w.tag,
        targetId: w.part.UniqueId,
        targetName: w.part.Name,
        property: w.property,
        ...(w.converter ? { converter: w.converter } : {}),
      })),
    }),
  );
  const store = createProjectStore();
  store.getState().hydrate({
    id: "fidelity",
    name: data.name,
    target: data.target,
    screens: data.screens,
    activeScreenId: data.screens[0]?.UniqueId,
    variables: data.variables,
    alarms: data.alarms,
    bindings: data.bindings,
    objectMeta: {},
    screenPlacement: {},
    standards: DEFAULT_STANDARDS,
    versions: [],
    chat: [],
    source,
    sourceId: source,
    layout: "typed",
    foreign: data.foreign ?? {},
  } as never);
  return store;
}

/* ------------------------------------------------------------------ drawing */

const EMPTY_CACHE = new Map<string, string>();
async function partSvg(screen: Screen, part: Part | null, read: ReadProject): Promise<string> {
  const s = { ...screen, Children: [{ ...screen.Children[0], Children: part ? [part] : [] }] } as Screen;
  return screenToSvg(s, [], { contents: read.screens, contentForeign: read.foreign as never, panel: read.target });
}
/** Whether a part alone draws anything: its SVG differs from the screen with no part. */
async function draws(screen: Screen, part: Part, read: ReadProject): Promise<{ ok: boolean; svg?: string; error?: string }> {
  try {
    const key = screen.UniqueId;
    if (!EMPTY_CACHE.has(key)) EMPTY_CACHE.set(key, await partSvg(screen, null, read));
    const svg = await partSvg(screen, part, read);
    return { ok: svg !== EMPTY_CACHE.get(key), svg };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/* ------------------------------------------------------------------ bindings */

interface Graph { Sources: Json[]; Targets: Json[]; Bindings: Json[] }
async function graphOf(entries: Map<string, Uint8Array>): Promise<Graph> {
  const name = [...entries.keys()].find((n) => /^Bindings\.dat$/i.test(n));
  if (!name) return { Sources: [], Targets: [], Bindings: [] };
  const g = JSON.parse(new TextDecoder().decode(entries.get(name)!).replace(/^\uFEFF/, "")) as Graph;
  return { Sources: g.Sources ?? [], Targets: g.Targets ?? [], Bindings: g.Bindings ?? [] };
}
/** Each binding as one comparable line: everything but the reference numbers. */
function bindingLines(g: Graph): { line: string; targetId: string; objectType: number }[] {
  const src = new Map(g.Sources.map((s) => [Number(s.ReferenceId), s]));
  const tgt = new Map(g.Targets.map((t) => [Number(t.ReferenceId), t]));
  return g.Bindings.map((b) => {
    const t = tgt.get(Number(b.Target)) ?? {};
    const ss = String(b.Sources ?? "")
      .split(",")
      .filter((x) => x.trim() !== "")
      .map((x) => {
        const s = src.get(Number(x)) ?? {};
        return [s.ObjectType, String(s.ObjectId ?? "").toLowerCase(), s.ParentIds ?? "", s.ObjectFullName ?? "", s.PropertyFullName ?? ""].join("~");
      })
      .join("+");
    const line = [
      t.ObjectType, t.SubType, String(t.ObjectId ?? "").toLowerCase(), String(t.ParentIds ?? "").toLowerCase(), String(t.ScreenId ?? "").toLowerCase(), t.ObjectFullName,
      b.Type, b.Mode, b.BindingText, String(b.ConverterId ?? "").toLowerCase(), b.ConverterName, b.TargetProperty, ss,
    ].join("|");
    return { line, targetId: String(t.ObjectId ?? "").toLowerCase(), objectType: Number(t.ObjectType) };
  });
}

/* ------------------------------------------------------------------ edits */

const KINDS = ["move", "resize", "setText", "setColor", "add", "delete"] as const;
type Kind = (typeof KINDS)[number];

const TEXT_FACES = new Set(["TextBox", "Lamp", "Switch", "ToggleSwitch", "N-StateLamp"]);
const STYLED_TEXT = new Set(["NumericDisplay", "StringDisplay", "DateTimeDisplay"]);
/** Types OTE gives a text an engineer can change. A CO instance counts when it exposes a Text value. */
const hasText = (p: Part, raw: Json | undefined) =>
  TEXT_FACES.has(p.Type) || STYLED_TEXT.has(p.Type) || (p.Type === "CompoundObject" && !!raw && "Text" in raw);
/** Types with no fill an engineer could colour (a stroke, a picture, a window onto another screen). */
const NO_FILL = new Set(["Line", "PolyLine", "Bezier", "Arc", "Image", "ClipArt", "ContentDisplay", "BarScale"]);

/** The types the add op can build (core/ops buildPart), each tried once per file. */
const ADDABLE = ["Rectangle", "TextBox", "Lamp", "NumericDisplay", "AlarmSummary", "Switch", "N-StateLamp", "StringDisplay", "ToggleSwitch", "BarScale", "Pipe", "DateTimeDisplay", "TrendGraph", "BlockTrend"] as const;

function opFor(kind: Kind, p: Part, raw: Json | undefined, panel: { width: number; height: number }): Op | "n/a" {
  const target = (h: string) => h;
  switch (kind) {
    case "move": {
      // Stay inside the panel, so clampToPanel does not decide the result.
      const dx = p.Location.Left + (p.Width ?? 0) + 16 <= panel.width ? 16 : -16;
      const dy = p.Location.Top + (p.Height ?? 0) + 8 <= panel.height ? 8 : -8;
      return { op: "moveObject", target: target(""), dx, dy } as Op;
    }
    case "resize":
      return { op: "resizeObject", target: "", width: Math.max(4, Math.round((p.Width ?? 40) * 0.8)), height: Math.max(4, Math.round((p.Height ?? 20) * 0.8)) } as Op;
    case "setText":
      if (!hasText(p, raw)) return "n/a";
      if (STYLED_TEXT.has(p.Type)) return { op: "setText", target: "", fontSize: 31 } as Op;
      return { op: "setText", target: "", text: "AUDIT_TXT" } as Op;
    case "setColor":
      if (NO_FILL.has(p.Type)) return "n/a";
      return { op: "setColor", target: "", color: "red", colorRole: "fill" } as Op;
    case "delete":
      return { op: "deleteObject", target: "" } as Op;
    default:
      return "n/a";
  }
}

/* ------------------------------------------------------------------ results */

interface Attempt {
  file: string;
  kind: Kind;
  type: string;
  applicable: boolean;
  applied: boolean;
  visible: boolean;
  survived: boolean;
  /** Writer round trip held, but the export route would refuse (409/422) first. */
  routeRefused?: string;
  error?: string;
}
interface TypeRow {
  instances: number;
  real: number;
  read: number;
  drew: number;
  drawErrors: number;
  attempts: Record<Kind, { applicable: number; applied: number; visible: number; survived: number }>;
}
const emptyKinds = () => Object.fromEntries(KINDS.map((k) => [k, { applicable: 0, applied: 0, visible: 0, survived: 0 }])) as TypeRow["attempts"];

const typeRows: Record<string, TypeRow> = {};
const rowFor = (t: string) => (typeRows[t] ??= { instances: 0, real: 0, read: 0, drew: 0, drawErrors: 0, attempts: emptyKinds() });
const files: Json[] = [];
const attempts: Attempt[] = [];

/* ------------------------------------------------------------------ one project */

async function eote(path: string, tracked: boolean, real: boolean, dupOf?: string) {
  const name = basename(path);
  const bytes = new Uint8Array(readFileSync(path));
  const result: Json = { file: relative(ROOT, path).split("\\").join("/"), kind: "eote", tracked, real, sha1: createHash("sha1").update(bytes).digest("hex"), ...(dupOf ? { duplicateOf: dupOf } : {}) };
  files.push(result);
  const steps: Json = {};
  result.steps = steps;

  // 1. read ---------------------------------------------------------------
  let read: ReadProject;
  let layout: string;
  try {
    layout = await layoutOf(bytes);
    read = layout === "struct" ? ((await readStructProject(bytes, name)) as unknown as ReadProject) : await readProject(bytes, name);
    steps.read = { ok: true, layout, warnings: read.warnings.length };
  } catch (e) {
    steps.read = { ok: false, error: (e as Error).message.slice(0, 240) };
    return;
  }
  const scrub = scrubber([
    ...read.screens.flatMap((s) => [s.Name, ...s.Children[0].Children.map((p) => p.Name)]),
    ...read.variables.map((v) => v.Name),
    ...Object.values(read.foreign).flatMap((f) => f.map((x) => x.name)),
  ]);

  // 2. inventory ------------------------------------------------------------
  const { zip, entries } = await entryMap(bytes);
  const raw = await rawObjects(zip);
  const modelled = new Map<string, { part: Part; screen: Screen }>();
  for (const s of read.screens) for (const p of s.Children[0].Children) modelled.set(p.UniqueId.toLowerCase(), { part: p, screen: s });
  const partTypes: Record<string, number> = {};
  const carriedObjects: Record<string, number> = {};
  const containers: Record<string, number> = {};
  for (const [id, o] of raw) {
    const t = typeOf(o.type);
    if (CONTAINERS.has(t)) {
      containers[t] = (containers[t] ?? 0) + 1;
      continue;
    }
    partTypes[t] = (partTypes[t] ?? 0) + 1;
    if (!dupOf) {
      const row = rowFor(t);
      row.instances++;
      if (real) row.real++;
      if (modelled.has(id)) row.read++;
    }
    if (!modelled.has(id)) carriedObjects[t] = (carriedObjects[t] ?? 0) + 1;
  }
  // Screens the reader carried whole, by their Type and root.
  const carriedScreens: Record<string, number> = {};
  for (const f of Object.values(zip.files)) {
    const m = slash(f.name).match(/^(Screens|Contents)\/([^/]+)\/Screen\.dat$/i);
    if (!m || read.preserved.screens.has(m[2])) continue;
    try {
      const doc = JSON.parse((await f.async("string")).replace(/^\uFEFF/, "")) as Json;
      const k = `${m[1]}:${doc.Type}/${String(((doc.Children as Json[]) ?? [])[0]?.Type)}`;
      carriedScreens[k] = (carriedScreens[k] ?? 0) + 1;
    } catch {
      carriedScreens[`${m[1]}:unreadable`] = (carriedScreens[`${m[1]}:unreadable`] ?? 0) + 1;
    }
  }
  const coDefinitions = new Set([...entries.keys()].map((n) => slash(n).match(/^CompoundObjects\/([^/]+)\//i)?.[1]).filter(Boolean)).size;
  steps.inventory = {
    panel: read.target.model,
    resolution: `${read.target.width}x${read.target.height}`,
    drivers: await drivers(entries),
    screens: read.screens.filter((s) => s.Type !== "Content").length,
    contentScreens: read.screens.filter((s) => s.Type === "Content").length,
    carriedScreens,
    partTypes,
    carriedObjects,
    containers,
    coDefinitions,
    variables: { modelled: read.variables.length, skippedRows: read.carried.variableRows, byDataType: await variableTypes(entries) },
    bindings: { modelledWires: read.wires.length, carriedRows: read.carried.bindingRows },
    alarms: read.alarms.length,
  };

  // 3. draw -----------------------------------------------------------------
  const drawn = { screens: read.screens.length, rendered: 0, png: 0, errors: [] as string[], partsDrawn: 0, partsBlank: 0, blankByType: {} as Record<string, number> };
  const outDir = join(RENDERS, name.replace(/[^A-Za-z0-9_.-]/g, "_"));
  if (!NO_PNG) mkdirSync(outDir, { recursive: true });
  let si = 0;
  for (const s of read.screens) {
    si++;
    try {
      if (NO_PNG) await screenToSvg(s, (read.foreign[s.UniqueId] ?? []) as never, { contents: read.screens, contentForeign: read.foreign as never, panel: read.target });
      else {
        const png = await screenToPng(s, (read.foreign[s.UniqueId] ?? []) as never, 0.5, { contents: read.screens, contentForeign: read.foreign as never, panel: read.target });
        writeFileSync(join(outDir, `screen-${String(si).padStart(2, "0")}.png`), png);
        drawn.png++;
      }
      drawn.rendered++;
    } catch (e) {
      drawn.errors.push(`screen ${si}: ${scrub((e as Error).message)}`);
    }
    for (const p of s.Children[0].Children) {
      const d = await draws(s, p, read);
      const t = typeOf(p.Type === "CompoundObject" ? "CompoundObject" : p.Type);
      if (d.ok) drawn.partsDrawn++;
      else {
        drawn.partsBlank++;
        drawn.blankByType[t] = (drawn.blankByType[t] ?? 0) + 1;
        if (d.error) drawn.errors.push(`${t}: ${scrub(d.error)}`);
      }
      if (!dupOf) {
        if (d.ok) rowFor(t).drew++;
        if (d.error) rowFor(t).drawErrors++;
      }
    }
  }
  steps.draw = drawn;

  // 4 and 5. edit, write, read again, diff ----------------------------------------
  if (layout === "struct") {
    steps.edits = { skipped: "a 3.x project is converted on open and exported as a new 4.4 project; not an in-place round trip" };
    return;
  }
  const originalGraph = await graphOf(entries);
  const originalLines = bindingLines(originalGraph);
  const edits: Json = {};
  steps.edits = edits;
  const panelOf = (s: Screen) => ({ width: s.Children[0].Width ?? read.target.width, height: s.Children[0].Height ?? read.target.height });

  // One instance of each type, on a modelled screen, chosen once per file.
  const sample = new Map<string, { part: Part; screen: Screen }>();
  for (const s of read.screens) for (const p of s.Children[0].Children) if (!sample.has(p.Type)) sample.set(p.Type, { part: p, screen: s });
  const firstMain = read.screens.find((s) => s.Type !== "Content") ?? read.screens[0];

  type OneOp = { op: Op; type: string; id?: string; applicable: boolean };
  const plan: { kind: Kind; ops: OneOp[] }[] = [];
  {
    const st = () => storeFrom(read, "fidelity-source").getState();
    const handles = st();
    for (const kind of KINDS) {
      if (kind === "add") {
        if (!firstMain) continue;
        for (const t of ADDABLE) plan.push({ kind, ops: [{ op: { op: "addObject", screen: handleOf(handles, firstMain.UniqueId), type: t as Op["type"], name: `Audit_${t.replace(/[^A-Za-z]/g, "")}`, text: t === "TrendGraph" || t === "BlockTrend" ? undefined : "AUDIT" } as Op, type: t, applicable: true }] });
        continue;
      }
      for (const [type, { part, screen }] of sample) {
        const o = opFor(kind, part, (raw.get(part.UniqueId.toLowerCase())?.raw as Json) ?? undefined, panelOf(screen));
        const t = typeOf(type);
        if (o === "n/a") {
          attempts.push({ file: name, kind, type: t, applicable: false, applied: false, visible: false, survived: false });
          continue;
        }
        plan.push({ kind, ops: [{ op: { ...o, target: handleOf(handles, part.UniqueId) }, type: t, id: part.UniqueId, applicable: true }] });
      }
    }
  }
  const details: Json[] = [];
  steps.details = details;
  // One op, one fresh store, one export: whatever breaks is that op's.
  for (const { kind, ops } of plan) {
    const store = storeFrom(read, "fidelity-source");
    const st = () => store.getState();
    const before = structuredClone(st().screens);
    const beforePart = (id: string) => before.flatMap((s) => s.Children[0].Children).find((p) => p.UniqueId === id);
    const screenOfBefore = (id: string) => before.find((s) => s.Children[0].Children.some((p) => p.UniqueId === id));
    const live = ops.filter((o) => o.applicable);
    // One op per run on the same store, as a turn of one op each (dryRun + commit, useChat's path).
    const results: { o: (typeof ops)[number]; rejected?: string; createdId?: string }[] = [];
    for (const o of live) {
      const run = dryRun([o.op], store);
      if (run.outcome.rejected.length > 0) {
        let reason = run.outcome.rejected[0].reason;
        // An add the slot resolver refused is retried at typed coordinates, the engineer's path.
        if (kind === "add" && firstMain) {
          const retry = dryRun([{ ...o.op, left: 8, top: 8 }], store);
          if (retry.outcome.rejected.length === 0) {
            commit(retry, "audit", store);
            results.push({ o, createdId: retry.outcome.created[0] ? Object.entries(st().handles).find(([, h]) => h === retry.outcome.created[0].handle)?.[0] : undefined, rejected: undefined });
            continue;
          }
          reason = `${reason} / at typed coordinates: ${retry.outcome.rejected[0].reason}`;
        }
        results.push({ o, rejected: scrub(reason) });
        continue;
      }
      commit(run, "audit", store);
      const created = run.outcome.created[0];
      results.push({ o, createdId: created ? Object.entries(st().handles).find(([, h]) => h === created.handle)?.[0] : undefined });
    }

    // Visible: the part's own drawing changed (or appeared, or went).
    const after = st().screens;
    const afterPart = (id: string) => after.flatMap((s) => s.Children[0].Children).find((p) => p.UniqueId === id);
    const visibleOf = new Map<(typeof results)[number], boolean>();
    const colourIssue = new Map<(typeof results)[number], string>();
    for (const r of results) {
      if (r.rejected) {
        visibleOf.set(r, false);
        continue;
      }
      if (kind === "delete") visibleOf.set(r, !afterPart(r.o.id!));
      else if (kind === "add") {
        const p = r.createdId ? afterPart(r.createdId) : undefined;
        const s = after.find((x) => x.Children[0].Children.some((q) => q.UniqueId === r.createdId));
        visibleOf.set(r, !!(p && s && (await draws(s, p, read)).ok));
      } else {
        const a = beforePart(r.o.id!);
        const b = afterPart(r.o.id!);
        const s = screenOfBefore(r.o.id!)!;
        if (!a || !b) {
          visibleOf.set(r, false);
          continue;
        }
        const da = await draws(s, a, read);
        const db = await draws(s, b, read);
        visibleOf.set(r, !!(da.svg && db.svg && da.svg !== db.svg));
        if (kind === "setColor") {
          const fill = (b as unknown as Json).Fill as Json | undefined;
          const c = fill?.Color as Json | undefined;
          if (!c || c.Value !== RED) colourIssue.set(r, "fill colour is not the palette red after the op");
          else if (c.ColorIndexEnabled === false) colourIssue.set(r, "palette index written into a packed-RGB colour (ColorIndexEnabled false): wrong colour");
          else if (typeof fill?.Type === "number" && fill.Type !== 1) colourIssue.set(r, `Fill is a typed paint (Type ${fill.Type}); the solid colour does not show`);
        }
      }
    }

    // 5. export through the route's own steps, then read again and diff.
    const input = packageInputOf(st() as never) as Parameters<typeof OTE.write>[0];
    const problems = preflight(input);
    const missing = unsupportedParts(input.screens, OTE);
    const route = problems.length > 0 ? `422 preflight: ${problems.length} problems (${[...new Set(problems.map((p) => scrub(`${p.where}: ${p.problem}`)))].slice(0, 3).join("; ")})` : missing.length > 0 ? `409 cannot write ${[...new Set(missing.map((m) => m.type))].join(", ")} (${missing.length} objects)` : undefined;
    let back: ReadProject | undefined;
    let outEntries: Map<string, Uint8Array> | undefined;
    let writeError: string | undefined;
    try {
      // The route reads the stored original again, with no file name.
      const fresh = await readProject(bytes);
      const out = await OTE.write(input, fresh.preserved);
      try {
        await selfCheck(out, input);
      } catch (e) {
        writeError = `self-check: ${scrub((e as Error).message)}`;
      }
      back = await readProject(out, name);
      outEntries = (await entryMap(out)).entries;
    } catch (e) {
      writeError = `write: ${scrub((e as Error).message)}`;
    }

    // What the store says the project now is, part by part.
    const expected = new Map(after.flatMap((s) => s.Children[0].Children.map((p) => [p.UniqueId.toLowerCase(), { part: p, screen: s.UniqueId }] as const)));
    const touched = new Set(results.flatMap((r) => (r.rejected ? [] : [r.o.id, r.createdId].filter(Boolean).map((x) => x!.toLowerCase()))));
    // A move takes a faceplate's members with it: whatever the store moved is expected to move.
    const beforeById = new Map(before.flatMap((s) => s.Children[0].Children.map((p) => [p.UniqueId.toLowerCase(), p] as const)));
    for (const [id, e] of expected) if (JSON.stringify(beforeById.get(id)) !== JSON.stringify(e.part)) touched.add(id);

    const collateral: Record<string, number> = {};
    const bump = (k: string) => (collateral[k] = (collateral[k] ?? 0) + 1);
    const perPartFail = new Map<string, string>();
    const strip = (p: Json) => {
      const { Look: _l, ...rest } = p;
      return rest;
    };
    const near = (a: number | undefined, b: number | undefined) => Math.abs((a ?? 0) - (b ?? 0)) < 1;
    if (back) {
      const got = new Map(back.screens.flatMap((s) => s.Children[0].Children.map((p) => [p.UniqueId.toLowerCase(), { part: p, screen: s.UniqueId }] as const)));
      for (const [id, e] of expected) {
        const g = got.get(id);
        if (!g) {
          if (touched.has(id)) perPartFail.set(id, "missing after round trip");
          else bump("modelled part lost");
          continue;
        }
        const a = e.part as unknown as Json;
        const b = g.part as unknown as Json;
        const boxOk = near(e.part.Location.Left, g.part.Location.Left) && near(e.part.Location.Top, g.part.Location.Top) && near(e.part.Width, g.part.Width) && near(e.part.Height, g.part.Height);
        const { Location: _a, Width: _b, Height: _c, ...ra } = strip(a);
        const { Location: _d, Width: _e, Height: _f, ...rb } = strip(b);
        const fieldsOk = canon(ra) === canon(rb);
        if (!boxOk || !fieldsOk) {
          const why = !boxOk ? "box differs from the editor's" : `fields differ (${diffPaths(ra, rb).join(",").replace(/\[\d+\]|\.\d+(?=\.|$|,)/g, "[]")})`;
          if (touched.has(id)) perPartFail.set(id, why);
          else {
            const area = read.preserved.screens.get(e.screen)?.area ?? "new";
            const tree = read.preserved.screens.get(e.screen)?.tree ? "laid-out" : "canvas";
            bump(`untouched modelled part changed: ${why} [${typeOf(e.part.Type)} on a ${area} ${tree} screen]`);
          }
        }
      }
      for (const id of got.keys()) if (!expected.has(id)) bump("a part appeared that the editor does not have");
      // Carried objects: every raw object the reader did not model comes back as it was.
      const backRaw = await rawObjects(await JSZip.loadAsync((await (async () => {
        const z = new JSZip();
        for (const [n, d] of outEntries!) z.file(n, d, { createFolders: false });
        return z.generateAsync({ type: "uint8array" });
      })())));
      for (const [id, o] of raw) {
        if (modelled.has(id) || CONTAINERS.has(typeOf(o.type))) continue;
        const b = backRaw.get(id);
        if (!b) bump(`carried ${typeOf(o.type)} lost`);
        else if (canon(b.raw) !== canon(o.raw)) bump(`carried ${typeOf(o.type)} changed`);
      }
      // Other entries: byte-identical unless the edit had a reason to touch them.
      const mayChange = (n: string) => /^(Project\.dat|Bindings\.dat|Converters\.db|Resources\.dat|Variables\.db|Alarm\.db)$/i.test(n) || /^(Screens|Contents)[\\/]/i.test(n) || /^Resources[\\/]/i.test(n);
      for (const [n, d] of entries) {
        const o = outEntries!.get(n);
        if (!o) {
          if (!/^(Screens|Contents)[\\/]/i.test(n)) bump(`entry lost: ${n.replace(/[0-9a-f-]{36}/gi, "<id>")}`);
        } else if (!mayChange(n) && Buffer.compare(Buffer.from(o), Buffer.from(d)) !== 0) bump(`entry changed: ${n.replace(/[0-9a-f-]{36}/gi, "<id>")}`);
      }
      // Screens nobody edited: their Screen.dat byte-identical.
      const editedScreens = new Set(after.filter((s) => before.find((b) => b.UniqueId === s.UniqueId) && JSON.stringify(before.find((b) => b.UniqueId === s.UniqueId)) !== JSON.stringify(s)).map((s) => s.UniqueId.toLowerCase()));
      for (const [n, d] of entries) {
        const m = slash(n).match(/^(Screens|Contents)\/([^/]+)\/Screen\.dat$/i);
        if (!m || editedScreens.has(m[2].toLowerCase())) continue;
        const o = outEntries!.get(n);
        if (o && Buffer.compare(Buffer.from(o), Buffer.from(d)) !== 0) bump("untouched screen rewritten");
      }
      // Bindings: every row the edit did not ask to remove is still there, unchanged.
      const deleted = new Set(results.filter((r) => kind === "delete" && !r.rejected).map((r) => r.o.id!.toLowerCase()));
      const outGraph = await graphOf(outEntries!);
      const outLines = bindingLines(outGraph);
      const have = new Map<string, number>();
      for (const l of outLines) have.set(l.line, (have.get(l.line) ?? 0) + 1);
      let lostRows = 0;
      let alteredRows = 0;
      const rewrittenCols: Record<string, number> = {};
      for (const l of originalLines) {
        if (deleted.has(l.targetId)) continue;
        const n = have.get(l.line) ?? 0;
        if (n > 0) have.set(l.line, n - 1);
        else if (outLines.some((x) => x.targetId === l.targetId && x.objectType === l.objectType)) {
          alteredRows++;
          const cols = ["T.ObjectType", "T.SubType", "T.ObjectId", "T.ParentIds", "T.ScreenId", "T.ObjectFullName", "B.Type", "B.Mode", "B.BindingText", "B.ConverterId", "B.ConverterName", "B.TargetProperty", "Sources"];
          const a = l.line.split("|");
          const best = outLines.filter((x) => x.targetId === l.targetId && x.objectType === l.objectType).map((x) => x.line.split("|")).sort((x, y) => cols.filter((_, i) => x[i] !== a[i]).length - cols.filter((_, i) => y[i] !== a[i]).length)[0];
          for (const c of cols.filter((_, i) => best[i] !== a[i])) rewrittenCols[c] = (rewrittenCols[c] ?? 0) + 1;
        }
        else lostRows++;
      }
      if (lostRows) collateral["binding rows lost"] = lostRows;
      if (alteredRows) collateral["binding rows rewritten (text, mode, type, ParentIds or ScreenId changed)"] = alteredRows;
      // Dangling: a part target that names no object in any screen or definition.
      const allIds = new Set([...backRaw.keys()]);
      const dangling = outLines.filter((l) => l.objectType === 8 && !allIds.has(l.targetId)).length;
      if (dangling) collateral["binding rows target a part that no longer exists"] = dangling;
      const bindingsRewritten = !!outEntries && Buffer.compare(Buffer.from(outEntries.get([...outEntries.keys()].find((n) => /^Bindings\.dat$/i.test(n))!) ?? new Uint8Array()), Buffer.from(entries.get([...entries.keys()].find((n) => /^Bindings\.dat$/i.test(n))!) ?? new Uint8Array())) !== 0;
      details.push({ kind, type: ops[0].type, route: route ?? "accepted", writeError, bindingsRewritten, collateral, rewrittenCols });
    } else {
      details.push({ kind, type: ops[0].type, route: route ?? "accepted", writeError, collateral });
    }

    const clean = !writeError && back && Object.keys(collateral).length === 0;
    for (const r of results) {
      const id = (kind === "add" ? r.createdId : r.o.id)?.toLowerCase();
      const fail = r.rejected ?? writeError ?? (id ? perPartFail.get(id) : undefined) ?? colourIssue.get(r);
      const survived = !r.rejected && !!clean && !!id && !perPartFail.has(id) && !colourIssue.has(r) && (kind !== "delete" || !back!.screens.some((s) => s.Children[0].Children.some((p) => p.UniqueId.toLowerCase() === id)));
      const a: Attempt = { file: name, kind, type: r.o.type, applicable: true, applied: !r.rejected, visible: !!visibleOf.get(r), survived, ...(route ? { routeRefused: route } : {}), ...(fail ? { error: fail } : {}) };
      attempts.push(a);
    }
    const k = ((edits[kind] as Json) ??= { ops: 0, applied: 0, rejected: [] as string[], routes: [] as string[] }) as { ops: number; applied: number; rejected: string[]; routes: string[] };
    k.ops += results.length;
    k.applied += results.filter((r) => !r.rejected).length;
    k.rejected.push(...results.filter((r) => r.rejected).map((r) => `${r.o.type}: ${r.rejected}`));
    if (!k.routes.includes(route ?? "accepted")) k.routes.push(route ?? "accepted");
  }
}

/* ------------------------------------------------------------------ one .co */

async function co(path: string, tracked: boolean) {
  const name = basename(path);
  const bytes = new Uint8Array(readFileSync(path));
  const result: Json = { file: relative(ROOT, path).split("\\").join("/"), kind: "co", tracked, real: false, sha1: createHash("sha1").update(bytes).digest("hex") };
  files.push(result);
  const steps: Json = {};
  result.steps = steps;
  let c: Co;
  try {
    c = await readCo(bytes);
    steps.read = { ok: true, problems: checkCo(c).length };
  } catch (e) {
    steps.read = { ok: false, error: (e as Error).message.slice(0, 200) };
    return;
  }
  const types: Record<string, number> = {};
  const walk = (n: CoNode) => {
    for (const k of n.Children ?? []) {
      types[typeOf(k.Type)] = (types[typeOf(k.Type)] ?? 0) + 1;
      walk(k);
    }
  };
  walk(c.screen);
  steps.inventory = { brand: c.objdef.AppBrand, layoutType: c.objdef.LayoutType, version: c.objdef.ModifiedAppVersion, partTypes: types, properties: coProperties(c).filter((p) => !p.group).length, bindings: c.bindings.Bindings.length };

  // 3. draw: the definition as a placed instance draws it (co-look), on one screen.
  try {
    const dir = `CompoundObjects/${c.objdef.Id}`;
    const byName = new Map([...c.entries.keys()].map((n) => [`${dir}/${slash(n)}`.toLowerCase(), n]));
    const json = (p: string) => {
      const n = byName.get(slash(p).toLowerCase());
      return n ? JSON.parse(new TextDecoder().decode(c.entries.get(n)!).replace(/^\uFEFF/, "")) : undefined;
    };
    const lookOf = coLooks(json, [...byName.keys()].map((k) => byName.get(k)!).map((n) => `${dir}/${slash(n)}`));
    const look = lookOf({ Type: `CompoundObject.${c.objdef.Name}` });
    const view = (c.screen.Children ?? [])[0] as Json | undefined;
    const w = Number(view?.Width ?? 200);
    const h = Number(view?.Height ?? 200);
    const screen = {
      Type: "Screen", UniqueId: "00000000-0000-4000-8000-000000000001", Name: "co",
      Children: [{ Type: "Canvas", UniqueId: "00000000-0000-4000-8000-000000000002", Name: "root", Width: w + 20, Height: h + 20, Children: [
        { Type: "CompoundObject", UniqueId: "00000000-0000-4000-8000-000000000003", Name: "instance", Definition: c.objdef.Name, Location: { Left: 10, Top: 10 }, Width: w, Height: h, ...(look ? { Look: look } : {}) },
      ] }],
    } as unknown as Screen;
    const empty = await screenToSvg({ ...screen, Children: [{ ...screen.Children[0], Children: [] }] } as Screen, []);
    const svg = await screenToSvg(screen, []);
    if (!NO_PNG) {
      mkdirSync(join(RENDERS, "co"), { recursive: true });
      writeFileSync(join(RENDERS, "co", `${name}.png`), await screenToPng(screen, [], 1));
    }
    steps.draw = { ok: !!look && svg !== empty, look: !!look, items: look?.items.length ?? 0 };
  } catch (e) {
    steps.draw = { ok: false, error: (e as Error).message.slice(0, 200) };
  }

  // 4. edits: core/ops has no .co path. The app's own .co edit is setCoValues (hmi co, the agent's co tools).
  const ops: Json = {};
  for (const k of KINDS) ops[k] = "n/a: core/ops edits screens of a project, not a .co definition";
  const props = coProperties(c).filter((p) => !p.group);
  const num = props.find((p) => ["Double", "Int32"].includes(p.type) && p.max === undefined && p.min === undefined) ?? props.find((p) => ["Double", "Int32"].includes(p.type));
  const str = props.find((p) => p.type === "String");
  const values: Record<string, unknown> = {};
  if (num) values[num.path] = typeof num.min === "number" ? num.min : 1;
  if (str) values[str.path] = "AUDIT";
  try {
    setCoValues(c, values);
    const out = await writeCo(c);
    const back = await readCo(out);
    const backProps = new Map(coProperties(back).map((p) => [p.path, p.value]));
    const kept = Object.entries(values).every(([k, v]) => JSON.stringify(backProps.get(k)) === JSON.stringify(v));
    const a = await JSZip.loadAsync(bytes);
    const b = await JSZip.loadAsync(out);
    const changed: string[] = [];
    for (const n of Object.keys(a.files)) {
      const x = await a.files[n].async("uint8array");
      const y = await b.files[n]?.async("uint8array");
      if (!y || Buffer.compare(Buffer.from(x), Buffer.from(y)) !== 0) changed.push(slash(n));
    }
    steps.edits = { kinds: ops, setCoValues: { values: Object.keys(values).length, survived: kept, entriesChanged: changed, problemsAfter: checkCo(back).length } };
  } catch (e) {
    steps.edits = { kinds: ops, setCoValues: { error: (e as Error).message.slice(0, 200) } };
  }
  // Untouched write: every entry byte-identical.
  try {
    const plain = await readCo(bytes);
    const out = await writeCo(plain);
    const a = await JSZip.loadAsync(bytes);
    const b = await JSZip.loadAsync(out);
    let same = 0;
    let total = 0;
    for (const n of Object.keys(a.files)) {
      total++;
      const y = await b.files[n]?.async("uint8array");
      if (y && Buffer.compare(Buffer.from(await a.files[n].async("uint8array")), Buffer.from(y)) === 0) same++;
    }
    steps.roundtrip = { entriesIdentical: same, entries: total };
  } catch (e) {
    steps.roundtrip = { error: (e as Error).message.slice(0, 200) };
  }
}

/* ------------------------------------------------------------------ run */

const list = corpus();
const firstBySha = new Map<string, string>();
const t0 = Date.now();
for (const f of list) {
  const sha = createHash("sha1").update(readFileSync(f.path)).digest("hex");
  const rel = relative(ROOT, f.path).split("\\").join("/");
  const dupOf = firstBySha.get(sha);
  if (!dupOf) firstBySha.set(sha, rel);
  // "Real" = an engineer's project: gitignored, not one this repository generated.
  const real = !f.tracked && /\.(eote|vxdz)$/i.test(f.path);
  try {
    if (/\.co$/i.test(f.path)) await co(f.path, f.tracked);
    else await eote(f.path, f.tracked, real, dupOf);
  } catch (e) {
    files.push({ file: rel, crashed: (e as Error).message.slice(0, 200) });
  }
}

/* ------------------------------------------------------------------ tables */

const pct = (n: number, d: number) => (d === 0 ? null : Math.round((1000 * n) / d) / 10);
// Per part type: attempts over files that are not duplicates of another.
const dupFiles = new Set(files.filter((f) => f.duplicateOf).map((f) => basename(String(f.file))));
for (const a of attempts) {
  if (dupFiles.has(a.file) || !a.applicable) {
    if (!dupFiles.has(a.file)) rowFor(a.type);
    continue;
  }
  const k = rowFor(a.type).attempts[a.kind];
  k.applicable++;
  if (a.applied) k.applied++;
  if (a.visible) k.visible++;
  if (a.survived) k.survived++;
}
const perType = Object.entries(typeRows)
  .sort((a, b) => b[1].instances - a[1].instances)
  .map(([type, r]) => {
    const sum = (f: "applicable" | "applied" | "visible" | "survived") => KINDS.reduce((n, k) => n + r.attempts[k][f], 0);
    return {
      type,
      instances: r.instances,
      inRealProjects: r.real,
      readPct: pct(r.read, r.instances),
      drewPct: pct(r.drew, r.read),
      editsApplicable: sum("applicable"),
      tookEditPct: pct(sum("applied"), sum("applicable")),
      visiblePct: pct(sum("visible"), sum("applicable")),
      survivedPct: pct(sum("survived"), sum("applicable")),
      byKind: Object.fromEntries(KINDS.map((k) => [k, r.attempts[k].applicable ? `${r.attempts[k].survived}/${r.attempts[k].applied}/${r.attempts[k].applicable}` : "n/a"])),
    };
  });

const perFile = files.map((f) => {
  const steps = (f.steps ?? {}) as Json;
  const inv = (steps.inventory ?? {}) as Json;
  const draw = (steps.draw ?? {}) as Json;
  const mine = attempts.filter((a) => a.file === basename(String(f.file)) && a.applicable);
  const parts = Object.values((inv.partTypes ?? {}) as Record<string, number>).reduce((n, v) => n + v, 0);
  const carried = Object.values((inv.carriedObjects ?? {}) as Record<string, number>).reduce((n, v) => n + v, 0);
  return {
    file: f.file,
    kind: f.kind,
    tracked: f.tracked,
    real: f.real,
    ...(f.duplicateOf ? { duplicateOf: f.duplicateOf } : {}),
    read: !!(steps.read as Json)?.ok,
    panel: inv.panel,
    drivers: inv.drivers,
    readPct: f.kind === "co" ? ((steps.read as Json)?.ok ? 100 : 0) : pct(parts - carried, parts),
    drewPct: f.kind === "co" ? ((draw.ok as boolean) ? 100 : 0) : pct(Number(draw.partsDrawn ?? 0), Number(draw.partsDrawn ?? 0) + Number(draw.partsBlank ?? 0)),
    screensRendered: f.kind === "co" ? undefined : `${draw.rendered ?? 0}/${draw.screens ?? 0}`,
    tookEditPct: f.kind === "co" ? null : pct(mine.filter((a) => a.applied).length, mine.length),
    survivedPct: f.kind === "co" ? (((steps.edits as Json)?.setCoValues as Json)?.survived ? 100 : 0) : pct(mine.filter((a) => a.survived).length, mine.length),
    exportRoute: f.kind === "co" ? undefined : [...new Set(Object.values((steps.edits ?? {}) as Record<string, Json>).flatMap((e) => (e.routes as string[]) ?? []))].join(" | "),
  };
});

// Overall, weighted by how often each type appears in the real (engineer) projects.
const weights = Object.fromEntries(perType.filter((r) => r.inRealProjects > 0).map((r) => [r.type, r.inRealProjects]));
const W = Object.values(weights).reduce((n, v) => n + v, 0);
const weighted = (key: "readPct" | "drewPct" | "tookEditPct" | "survivedPct") =>
  Math.round(
    (10 * perType.reduce((n, r) => n + (weights[r.type] ? (weights[r.type] / W) * ((r[key] ?? 0) as number) : 0), 0)),
  ) / 10;
const overall = {
  weightedByRealTypeFrequency: { readPct: weighted("readPct"), drewPct: weighted("drewPct"), tookEditPct: weighted("tookEditPct"), survivedPct: weighted("survivedPct"), realInstances: W },
  attempts: { applicable: attempts.filter((a) => a.applicable).length, applied: attempts.filter((a) => a.applicable && a.applied).length, survived: attempts.filter((a) => a.applicable && a.survived).length },
  routeRefusedFiles: perFile.filter((f) => f.exportRoute && f.exportRoute !== "accepted").map((f) => f.file),
  otherOpensOutput: "not verified (OTE Expert is not installed on this machine)",
};

const results = { runAt: new Date().toISOString(), commit: execSync("git rev-parse --short HEAD", { cwd: ROOT, encoding: "utf8" }).trim(), seconds: Math.round((Date.now() - t0) / 1000), overall, perFile, perType, files, attempts };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ out: OUT, overall, perFile, perType }, null, 1));
