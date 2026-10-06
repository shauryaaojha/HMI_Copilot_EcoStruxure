/**
 * A finished project, read for what it teaches rather than for editing.
 *
 * The reader (lib/ote/reader.ts) models what the editor can edit and carries
 * the rest. That is the right posture for opening a file and the wrong one for
 * learning from it: a Schneider template pack is mostly GroupObjects, Grids and
 * gauges the editor does not model, and those are exactly what an engineer's
 * finished work looks like. So this scanner walks *everything*, generically:
 *
 * - every node of every screen and content screen, whatever its Type, with its
 *   name, box, nesting depth and the property paths it sets;
 * - every binding, whichever layout keeps it - the graph in `Bindings.dat`
 *   (4.4, and .vxdz from 3.4.1) or inline in each property's Value (the
 *   struct layout of 3.1-3.3, docs/VXDZ_FINDINGS.md §2.5);
 * - every variable, alarm and alarm group the databases hold, read by column
 *   name rather than by a fixed query, so a table with columns we did not
 *   expect still yields what it has;
 * - and, derived from those, the conventions a generator should follow: how
 *   tags are named, which part property each kind of signal is bound to, how
 *   alarms are worded and prioritised, how screens are populated.
 *
 * What it records is structure and names, never the file: no Screen.dat, no
 * database, no image, no Schneider-owned graphic. That keeps the knowledge
 * base on the right side of the licensing line docs/PRODUCTION.md §1 draws, and
 * small enough to retrieve from on every turn.
 *
 * It never throws on content. A file that is unsafe or not a project is refused
 * by lib/ingest before this runs; anything inside it that does not parse is
 * counted under `problems` and the scan goes on.
 */

import JSZip from "jszip";
import { guardZip } from "@/lib/ingest/zip";
import { sniff } from "@/lib/ingest/sniff";
import { IngestError } from "@/lib/ingest/errors";
import { openDatabase, readPanel } from "@/lib/ote/packager";
import { OBJECT_TYPE } from "@/lib/ote/bindings";
import { inferEquipment } from "@/lib/ai/infer";
import { normaliseDataType } from "@/lib/tags/parse";
import type { Variable } from "@/lib/ote/schema";

export const KNOWLEDGE_VERSION = 1;

export interface KnownVariable {
  name: string;
  dataType: string;
  comment: string;
  address: string;
  folder?: string;
}

export interface KnownObject {
  type: string;
  name: string;
  depth: number;
  box?: { left: number; top: number; width: number; height: number };
  /** Grid-placed (struct layout): row and column instead of a point. */
  cell?: { row: number; column: number };
  /** Distinct text, for label conventions. */
  text?: string;
}

export interface KnownScreen {
  id: string;
  name: string;
  area: "Screens" | "Contents";
  rootType: string;
  objects: KnownObject[];
  /** Object count by Type, all depths. */
  types: Record<string, number>;
  bound: number;
}

export interface KnownBinding {
  /** The variable, by name. */
  tag: string;
  dataType?: string;
  /** What it drives: the object's Type and the property path. */
  objectType: string;
  objectName: string;
  property: string;
  screen?: string;
  converter?: string;
  /** "graph" for Bindings.dat, "inline" for struct-layout property values. */
  via: "graph" | "inline";
}

export interface KnownAlarm {
  group: string;
  message: string;
  trigger?: string;
  /** HiHi / Hi / Lo / LoLo, or the numeric code when it is something else. */
  level: string;
  kind: "bit" | "level" | string;
  severity?: number;
  value?: string;
}

export interface NamingStats {
  /** How tag names separate their words. */
  separators: Record<string, number>;
  /** "UPPER", "lower", "Mixed", "Camel". */
  cases: Record<string, number>;
  /** Leading word, e.g. PMP, FT. Top 40. */
  prefixes: Record<string, number>;
  /** Trailing word, e.g. RUN, PV. Top 60. */
  suffixes: Record<string, number>;
  /** Fraction of names carrying a loop or equipment number. */
  numbered: number;
  averageLength: number;
}

export interface ProjectKnowledge {
  v: typeof KNOWLEDGE_VERSION;
  /** sha256 of the file: the same project scanned twice is one record. */
  id: string;
  fileName: string;
  scannedAt: string;
  source: { product: string; layout: "typed" | "struct"; appVersion?: string; brand?: string };
  target: { model: string; width: number; height: number } | null;
  counts: {
    entries: number;
    screens: number;
    contentScreens: number;
    objects: number;
    variables: number;
    alarms: number;
    alarmGroups: number;
    bindings: number;
  };
  screens: KnownScreen[];
  /** Per object Type: how many, and how often each property path is set. */
  partTypes: Record<string, { count: number; properties: Record<string, number> }>;
  variables: KnownVariable[];
  bindings: KnownBinding[];
  alarms: KnownAlarm[];
  naming: NamingStats;
  /** Equipment the tag names imply, by the same inference generation uses. */
  equipment: { id: string; kind: string; label: string; tags: string[] }[];
  /** Database tables found, with their columns: the schema as this version wrote it. */
  tables: Record<string, Record<string, string[]>>;
  /** Things that could not be read, so nobody mistakes a gap for an absence. */
  problems: string[];
}

/* ----------------------------------------------------------------- utils */

const decode = (b: Uint8Array) => new TextDecoder("utf-8").decode(b).replace(/^﻿/, "");

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

const bump = (m: Record<string, number>, k: string, by = 1) => {
  m[k] = (m[k] ?? 0) + by;
};

const top = (m: Record<string, number>, n: number) =>
  Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n));

/** Dotted paths of the leaves an object sets, two levels deep, skipping children. */
function propertyPaths(node: Record<string, unknown>, prefix = "", depth = 0, out: string[] = []): string[] {
  for (const [k, v] of Object.entries(node)) {
    if (k === "Children" || k === "UniqueId" || k === "Type" || k === "Name") continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && depth < 2) propertyPaths(v as Record<string, unknown>, path, depth + 1, out);
    else out.push(path);
  }
  return out;
}

/* ----------------------------------------------------------- naming stats */

export function namingStats(names: string[]): NamingStats {
  const separators: Record<string, number> = {};
  const cases: Record<string, number> = {};
  const prefixes: Record<string, number> = {};
  const suffixes: Record<string, number> = {};
  let numbered = 0;
  let length = 0;
  for (const name of names) {
    length += name.length;
    if (/\d/.test(name)) numbered++;
    const sep = name.includes("_") ? "_" : name.includes(".") ? "." : name.includes("-") ? "-" : /[a-z][A-Z]/.test(name) ? "camel" : "none";
    bump(separators, sep);
    bump(cases, name === name.toUpperCase() ? "UPPER" : name === name.toLowerCase() ? "lower" : /^[A-Z][a-z]+(?:[A-Z][a-z0-9]*)+$/.test(name) ? "Camel" : "Mixed");
    const words = name.split(/[_.\-\s]+|(?<=[a-z])(?=[A-Z])/).filter(Boolean);
    if (words.length > 1) {
      bump(prefixes, words[0].replace(/\d+$/, "").toUpperCase() || words[0]);
      const last = words[words.length - 1];
      if (!/^\d+$/.test(last)) bump(suffixes, last.toUpperCase());
    }
  }
  return {
    separators,
    cases,
    prefixes: top(prefixes, 40),
    suffixes: top(suffixes, 60),
    numbered: names.length ? numbered / names.length : 0,
    averageLength: names.length ? Math.round((length / names.length) * 10) / 10 : 0,
  };
}

/* ----------------------------------------------------------- the scanner */

interface Ctx {
  get: (path: string) => Uint8Array | undefined;
  names: string[];
  problems: string[];
}

function json(ctx: Ctx, path: string): unknown {
  const e = ctx.get(path);
  if (!e) return undefined;
  try {
    return JSON.parse(decode(e));
  } catch (error) {
    ctx.problems.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/** Every table and its columns, and every row of the ones asked for. */
async function readDb(ctx: Ctx, name: string): Promise<{ tables: Record<string, string[]>; rows: (table: string) => Record<string, unknown>[] } | null> {
  const bytes = ctx.get(name);
  if (!bytes) return null;
  let db: Awaited<ReturnType<typeof openDatabase>>;
  try {
    db = await openDatabase(bytes);
  } catch (error) {
    ctx.problems.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  const tables: Record<string, string[]> = {};
  const cache = new Map<string, Record<string, unknown>[]>();
  try {
    const list = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")[0]?.values ?? [];
    for (const [t] of list) {
      const table = String(t);
      try {
        const info = db.exec(`pragma table_info('${table.replace(/'/g, "''")}')`)[0];
        tables[table] = (info?.values ?? []).map((r) => String(r[1]));
        // Rows of the tables a scan can use; capped, because a recipe table
        // can be large and none of it is convention.
        if (/^(Variables|variable_root|.*variable.*|Alarm|AlarmGroup|alarm_.*|.*_alarm)$/i.test(table)) {
          const res = db.exec(`SELECT * FROM "${table.replace(/"/g, '""')}" LIMIT 20000`)[0];
          cache.set(table, (res?.values ?? []).map((r) => Object.fromEntries(res!.columns.map((c, i) => [c, r[i]]))));
        }
      } catch (error) {
        ctx.problems.push(`${name} ${table}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    db.close();
  }
  return { tables, rows: (table) => cache.get(table) ?? [] };
}

const pick = (row: Record<string, unknown>, ...re: RegExp[]) => {
  for (const r of re) {
    const key = Object.keys(row).find((k) => r.test(k));
    if (key !== undefined && row[key] !== null && row[key] !== undefined) return row[key];
  }
  return undefined;
};

/**
 * Variables from whichever table holds them. The typed layout has a
 * `Variables` table; the struct layout spreads them over `variable_root` and
 * friends whose columns nobody has documented, so the struct path takes the
 * first table with a name-like and a type-like column and says so.
 */
function variablesFrom(db: NonNullable<Awaited<ReturnType<typeof readDb>>>, problems: string[]): { variables: KnownVariable[]; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  const tableNames = Object.keys(db.tables);
  const chosen =
    tableNames.find((t) => t === "Variables") ??
    tableNames.find((t) => /variable/i.test(t) && db.tables[t].some((c) => /^name$/i.test(c)) && db.tables[t].some((c) => /type/i.test(c)));
  if (!chosen) {
    if (tableNames.length) problems.push(`Variables.db: no table with a name and a type column among ${tableNames.join(", ")}`);
    return { variables: [], ids };
  }
  if (chosen !== "Variables") problems.push(`Variables.db: read from table ${chosen} by column names; the struct layout is not documented`);
  const variables: KnownVariable[] = [];
  for (const row of db.rows(chosen)) {
    const name = String(pick(row, /^Name$/i) ?? "").trim();
    if (!name) continue;
    const dataType = String(pick(row, /^DataType$/i, /^Type$/i, /type/i) ?? "");
    const id = pick(row, /^UniqueId$/i, /^Guid$/i, /^Id$/i);
    if (id !== undefined) ids.set(String(id).toUpperCase(), name);
    variables.push({
      name,
      dataType,
      comment: String(pick(row, /^Comments?$/i, /^Description$/i) ?? ""),
      address: String(pick(row, /^DeviceAddress$/i, /address/i) ?? ""),
      ...(pick(row, /^FolderName$/i, /^Folder$/i) ? { folder: String(pick(row, /^FolderName$/i, /^Folder$/i)) } : {}),
    });
  }
  return { variables, ids };
}

const LEVEL: Record<number, string> = { 1: "HiHi", 2: "Hi", 3: "Lo", 4: "LoLo" };

function alarmsFrom(db: NonNullable<Awaited<ReturnType<typeof readDb>>>): { alarms: KnownAlarm[]; groups: number; byId: Map<string, KnownAlarm> } {
  const byId = new Map<string, KnownAlarm>();
  const groupRows = db.rows("AlarmGroup").length ? db.rows("AlarmGroup") : db.rows("alarm_group");
  const groupName = new Map(groupRows.map((g) => [String(pick(g, /^UniqueId$/i, /^Id$/i) ?? "").toUpperCase(), String(pick(g, /^Name$/i) ?? "")]));
  const rows = db.rows("Alarm").length ? db.rows("Alarm") : db.rows("alarm_definition");
  const alarms = rows.map((r) => {
    const type = Number(pick(r, /^AlarmType$/i));
    const record = Number(pick(r, /^AlarmRecordType$/i));
    const a: KnownAlarm = {
      group: groupName.get(String(pick(r, /^AlarmGroupId$/i, /group/i) ?? "").toUpperCase()) ?? "",
      message: String(pick(r, /^Message$/i, /message/i) ?? ""),
      level: LEVEL[type] ?? (Number.isFinite(type) ? String(type) : ""),
      kind: record === 1 ? "bit" : record === 2 ? "level" : Number.isFinite(record) ? String(record) : "",
      ...(num(Number(pick(r, /^Severity$/i))) !== undefined ? { severity: Number(pick(r, /^Severity$/i)) } : {}),
      ...(pick(r, /^Value$/i) !== undefined ? { value: String(pick(r, /^Value$/i)) } : {}),
    };
    const uid = pick(r, /^UniqueId$/i);
    if (uid !== undefined) byId.set(String(uid).toUpperCase(), a);
    return a;
  });
  return { alarms, groups: groupRows.length, byId };
}

/** One screen document, walked: typed parts and struct nodes alike. */
function walkScreen(
  raw: Record<string, unknown>,
  id: string,
  area: "Screens" | "Contents",
  partTypes: ProjectKnowledge["partTypes"],
  inline: KnownBinding[],
  objectsById: Map<string, { type: string; name: string; screen: string }>,
): KnownScreen {
  const name = String(raw.Name ?? id);
  // Typed: Children[0] is the ViewBox/Canvas root. Struct: GraphicalObjects is
  // the root node (docs/VXDZ_FINDINGS.md §2.3).
  const struct = raw.GraphicalObjects && typeof raw.GraphicalObjects === "object";
  const root = (struct ? raw.GraphicalObjects : (raw.Children as unknown[] | undefined)?.[0]) as Record<string, unknown> | undefined;
  const screen: KnownScreen = { id, name, area, rootType: String(root?.Type ?? "unknown"), objects: [], types: {}, bound: 0 };

  const visit = (node: Record<string, unknown>, depth: number) => {
    const type = String(node.Type ?? "Unknown");
    const objName = String(node.Name ?? "");
    bump(screen.types, type);
    const pt = (partTypes[type] ??= { count: 0, properties: {} });
    pt.count++;

    const obj: KnownObject = { type, name: objName, depth };
    if (struct && Array.isArray(node.Properties)) {
      // {Name, FullName, Type, Value} records; a Struct's Value is more of them.
      const flat: Record<string, unknown> = {};
      const walkProps = (props: unknown[]) => {
        for (const p of props as Record<string, unknown>[]) {
          const full = String(p?.FullName ?? p?.Name ?? "");
          if (!full) continue;
          const v = p.Value;
          if (Array.isArray(v)) walkProps(v);
          else {
            flat[full] = v;
            bump(pt.properties, full);
            const b = v as Record<string, unknown> | null;
            if (b && typeof b === "object" && b.Type === "Binding" && b.BindingType === "Variable") {
              const src = b.Source as Record<string, unknown> | undefined;
              const tag = typeof src?.VariableName === "string" ? src.VariableName : "";
              if (tag) {
                inline.push({ tag, objectType: type, objectName: objName, property: full, screen: name, via: "inline", ...(b.Converter ? { converter: String((b.Converter as Record<string, unknown>)?.Name ?? "converter") } : {}) });
                screen.bound++;
              }
            }
          }
        }
      };
      walkProps(node.Properties);
      const row = num(flat["Location.Row"]);
      const col = num(flat["Location.Column"]);
      if (row !== undefined || col !== undefined) obj.cell = { row: row ?? 0, column: col ?? 0 };
      const l = num(flat["Location.Left"]);
      const t = num(flat["Location.Top"]);
      const w = num(flat["Width"]);
      const h = num(flat["Height"]);
      if (l !== undefined && t !== undefined && w !== undefined && h !== undefined) obj.box = { left: l, top: t, width: w, height: h };
      const text = flat["Text"];
      if (typeof text === "string" && text.trim()) obj.text = text.trim().slice(0, 80);
    } else {
      for (const p of propertyPaths(node)) bump(pt.properties, p);
      const loc = node.Location as Record<string, unknown> | undefined;
      const l = num(loc?.Left);
      const t = num(loc?.Top);
      const w = num(node.Width);
      const h = num(node.Height);
      if (l !== undefined && t !== undefined && w !== undefined && h !== undefined) obj.box = { left: l, top: t, width: w, height: h };
      const row = num(loc?.Row);
      const col = num(loc?.Column);
      if (row !== undefined || col !== undefined) obj.cell = { row: row ?? 0, column: col ?? 0 };
      const text = typeof node.Text === "string" ? node.Text : typeof (node.Text as Record<string, unknown>)?.Value === "string" ? String((node.Text as Record<string, unknown>).Value) : undefined;
      if (text && text.trim()) obj.text = text.trim().slice(0, 80);
      if (typeof node.UniqueId === "string") objectsById.set(node.UniqueId.toLowerCase(), { type, name: objName, screen: name });
    }
    screen.objects.push(obj);
    for (const c of Array.isArray(node.Children) ? (node.Children as Record<string, unknown>[]) : []) {
      if (c && typeof c === "object") visit(c, depth + 1);
    }
  };
  for (const c of Array.isArray(root?.Children) ? (root!.Children as Record<string, unknown>[]) : []) {
    if (c && typeof c === "object") visit(c, 0);
  }
  return screen;
}

/**
 * Scan a project file. Throws IngestError for a file that is not a project or
 * is unsafe to open; everything else is recorded, including what failed.
 */
export async function scanProject(bytes: Uint8Array, fileName = "project.eote"): Promise<ProjectKnowledge> {
  const kind = await sniff(bytes, fileName);
  if (kind.kind !== "ote-project") {
    throw new IngestError("unsupported-format", `${fileName} is not an Operator Terminal Expert project, so there is nothing to learn from it here.`);
  }
  guardZip(bytes);
  const zip = await JSZip.loadAsync(bytes);
  const entries = new Map<string, Uint8Array>();
  for (const [name, file] of Object.entries(zip.files)) {
    if (!file.dir) entries.set(name, await file.async("uint8array"));
  }
  const byPath = new Map([...entries.keys()].map((n) => [n.replace(/\\/g, "/").toLowerCase(), n]));
  const problems: string[] = [];
  const ctx: Ctx = {
    get: (p) => {
      const k = byPath.get(p.replace(/\\/g, "/").toLowerCase());
      return k === undefined ? undefined : entries.get(k);
    },
    names: [...entries.keys()],
    problems,
  };

  // --- target ---------------------------------------------------------------
  let target: ProjectKnowledge["target"] = null;
  const panel = readPanel(json(ctx, "Target.dat"));
  if (panel) target = { model: panel.model, width: panel.width, height: panel.height };
  else {
    // The struct layout keeps resolution in Project.dat as an array of
    // single-key objects (docs/VXDZ_FINDINGS.md §2.2).
    const project = json(ctx, "Project.dat") as Record<string, unknown> | undefined;
    const res = (Array.isArray(project?.Target) ? (project!.Target as Record<string, unknown>[]) : []).find((t) => t?.Resolution)?.Resolution as Record<string, unknown> | undefined;
    if (num(res?.Width) && num(res?.Height)) target = { model: "unknown", width: Number(res!.Width), height: Number(res!.Height) };
  }

  // --- databases ------------------------------------------------------------
  const tables: ProjectKnowledge["tables"] = {};
  const vdb = await readDb(ctx, "Variables.db");
  if (vdb) tables["Variables.db"] = vdb.tables;
  const { variables, ids } = vdb ? variablesFrom(vdb, problems) : { variables: [], ids: new Map<string, string>() };
  const adb = await readDb(ctx, "Alarm.db");
  if (adb) tables["Alarm.db"] = adb.tables;
  const { alarms, groups, byId: alarmsById } = adb ? alarmsFrom(adb) : { alarms: [], groups: 0, byId: new Map<string, KnownAlarm>() };
  for (const extra of ["Converters.db", "Recipe.db", "Security.db", "Logging.db", "Language.db", "DriverConfig.db"]) {
    const d = await readDb(ctx, extra);
    if (d) tables[extra] = d.tables;
  }

  // --- screens --------------------------------------------------------------
  const partTypes: ProjectKnowledge["partTypes"] = {};
  const inline: KnownBinding[] = [];
  const objectsById = new Map<string, { type: string; name: string; screen: string }>();
  const screens: KnownScreen[] = [];
  const seen = new Set<string>();
  for (const name of ctx.names) {
    const n = name.replace(/\\/g, "/");
    const typed = n.match(/^(Screens|Contents)\/([^/]+)\/Screen\.dat$/i);
    const struct = n.match(/^(Screens|Contents)\/(panel\d+)\.dat$/i);
    const m = typed ?? struct;
    if (!m || seen.has(n)) continue;
    seen.add(n);
    const raw = json(ctx, n) as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== "object") continue;
    const area = /^contents$/i.test(m[1]) ? "Contents" : "Screens";
    screens.push(walkScreen(raw, m[2], area, partTypes, inline, objectsById));
  }

  // --- bindings (graph) -----------------------------------------------------
  const bindings: KnownBinding[] = [...inline];
  const graph = json(ctx, "Bindings.dat") as { Sources?: Record<string, unknown>[]; Targets?: Record<string, unknown>[]; Bindings?: Record<string, unknown>[] } | undefined;
  if (graph && Array.isArray(graph.Bindings)) {
    const sources = new Map((graph.Sources ?? []).map((s) => [Number(s.ReferenceId), s]));
    const targets = new Map((graph.Targets ?? []).map((t) => [Number(t.ReferenceId), t]));
    // Both orientations occur. Ours, and most of OTE's: a variable Source,
    // a part Target, the part's property in TargetProperty. The corpus also
    // carries the reverse: a part Source whose PropertyFullName is the bound
    // property (docs/VXDZ_FINDINGS.md §6). Whichever end is the variable gives
    // the tag; whichever is the part gives the object and the property.
    const variableOf = (end: Record<string, unknown> | undefined) =>
      end && Number(end.ObjectType) === OBJECT_TYPE.VARIABLE ? ids.get(String(end.ObjectId ?? "").toUpperCase()) : undefined;
    for (const row of graph.Bindings) {
      const t = targets.get(Number(row.Target));
      const refs = String(row.Sources ?? "").split(",").filter((x) => x.trim()).map(Number);
      if (!t || refs.length !== 1) continue;
      const s = sources.get(refs[0]);
      if (!s) continue;

      if (Number(t.ObjectType) === OBJECT_TYPE.ALARM) {
        const tag = variableOf(s);
        const alarm = alarmsById.get(String(t.ObjectId ?? "").toUpperCase());
        if (tag && alarm) alarm.trigger = tag;
        continue;
      }
      const forward = variableOf(s) !== undefined && Number(t.ObjectType) === OBJECT_TYPE.PART;
      const reverse = variableOf(t) !== undefined && Number(s.ObjectType) === OBJECT_TYPE.PART;
      if (!forward && !reverse) continue;
      const tag = (forward ? variableOf(s) : variableOf(t))!;
      const part = forward ? t : s;
      const obj = objectsById.get(String(part.ObjectId ?? "").toLowerCase());
      const property = forward ? String(row.TargetProperty ?? "") : String(part.PropertyFullName ?? row.TargetProperty ?? "");
      bindings.push({
        tag,
        objectType: obj?.type ?? String(part.SubType ?? "Unknown"),
        objectName: obj?.name ?? String(part.ObjectFullName ?? ""),
        property,
        ...(obj ? { screen: obj.screen } : {}),
        ...(row.ConverterName ? { converter: String(row.ConverterName) } : row.ConverterId ? { converter: String(row.ConverterId) } : {}),
        via: "graph",
      });
    }
  }
  const types = new Map(variables.map((v) => [v.name.toLowerCase(), v.dataType]));
  for (const b of bindings) b.dataType = types.get(b.tag.toLowerCase()) ?? b.dataType;
  for (const s of screens) s.bound += bindings.filter((b) => b.via === "graph" && b.screen === s.name).length;

  // --- derived --------------------------------------------------------------
  const asOte: Variable[] = variables.flatMap((v) => {
    const dt = normaliseDataType(v.dataType);
    return dt && /^[A-Za-z_][A-Za-z0-9_]*$/.test(v.name) ? [{ Name: v.name, DataType: dt, Comments: v.comment, DeviceAddress: v.address }] : [];
  });
  let equipment: ProjectKnowledge["equipment"] = [];
  try {
    equipment = inferEquipment(asOte).map((e) => ({ id: e.id, kind: e.kind, label: e.label, tags: e.tags }));
  } catch (error) {
    problems.push(`equipment inference: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    v: KNOWLEDGE_VERSION,
    id: await sha256(bytes),
    fileName,
    scannedAt: new Date().toISOString(),
    source: { product: kind.product, layout: kind.layout, ...(kind.appVersion ? { appVersion: kind.appVersion } : {}), ...(kind.brand ? { brand: kind.brand } : {}) },
    target,
    counts: {
      entries: entries.size,
      screens: screens.filter((s) => s.area === "Screens").length,
      contentScreens: screens.filter((s) => s.area === "Contents").length,
      objects: screens.reduce((n, s) => n + s.objects.length, 0),
      variables: variables.length,
      alarms: alarms.length,
      alarmGroups: groups,
      bindings: bindings.length,
    },
    screens,
    partTypes,
    variables,
    bindings,
    alarms,
    naming: namingStats(variables.map((v) => v.name)),
    equipment,
    tables,
    problems,
  };
}
