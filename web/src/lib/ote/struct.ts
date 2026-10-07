/**
 * The older project layout: application version 3.1 to 3.3, which 85 of the 95
 * files in Schneider's own template pack are saved in.
 *
 * docs/VXDZ_FINDINGS.md §2 is the description of the format this reads, and
 * §7.2 the argument for leaving it alone. It was right about the cost and
 * wrong about the order: an engineer who opens any template from that pack got
 * a refusal, and "nothing loads" is the impression that leaves.
 *
 * The shape of the solution is translation, not a second reader. Every struct
 * object is a `{Type, Name, Properties[], Children[]}` node and every property
 * a `{Name, FullName, Type, Value}` record; `unprop` folds those records into
 * the typed layout's plain keys, so `Location: {Row: 1}` comes out exactly as
 * the 4.4 layout writes it. From there the same containers, schema and canvas
 * handle both generations, and nothing downstream knows which one it read.
 *
 * What it does not do is write back. The original bytes are in a layout this
 * tool does not write, so an opened struct project is a converted one: the
 * export is a new 4.4 project built from the skeleton, and the reader says so.
 *
 * Bindings are inline in this layout (§2.5): a bound property's Value is the
 * binding. `unprop` collects them as it goes, keeps the property's
 * FallbackValue as its design-time value, and the Variable ones on modelled
 * parts become wires. The other six kinds stay where they were - in a file
 * nobody writes back - and are counted.
 */

import JSZip from "jszip";
import { DATA_TYPES, type Alarm, type Variable } from "./schema";
import type { Wire } from "./bindings";
import { openDatabase, type Panel } from "./packager";
import { guardZip } from "@/lib/ingest/zip";
import { displaySizes, modelScreen, summariseOpaque, type ForeignSummary, type ReadProject } from "./reader";
import type { Screen } from "./schema";

type Raw = Record<string, unknown>;

interface PropRecord {
  Name: string;
  FullName?: string;
  Type?: string;
  Value?: unknown;
}

interface InlineBinding {
  /** The property path on its object, as the typed layout names it. */
  property: string;
  bindingType: string;
  variable?: string;
}

const isRecord = (v: unknown): v is PropRecord =>
  !!v && typeof v === "object" && typeof (v as PropRecord).Name === "string" && "Value" in (v as object);

const isTyped = (v: unknown, type: string): v is Raw =>
  !!v && typeof v === "object" && !Array.isArray(v) && (v as Raw).Type === type;

/**
 * Fold a property list into plain keys.
 *
 * `prefix` is the dotted path so far, which is how a binding is named: the
 * typed layout's TargetProperty for `Animation.FillLevel.VerticalFill` is that
 * string, and FullName in this layout is the same string.
 */
export function unprop(props: unknown, bindings: InlineBinding[] = [], prefix = ""): Raw {
  const out: Raw = {};
  if (!Array.isArray(props)) return out;
  for (const p of props) {
    if (!isRecord(p)) continue;
    const path = p.FullName ?? (prefix ? `${prefix}.${p.Name}` : p.Name);
    const value = convertValue(p, bindings, path);
    if (value !== undefined) out[p.Name] = value;
  }
  return out;
}

function convertValue(p: PropRecord, bindings: InlineBinding[], path: string): unknown {
  const v = p.Value;
  if (isTyped(v, "Binding")) {
    const source = (v.Source ?? {}) as Raw;
    bindings.push({
      property: path,
      bindingType: String(v.BindingType ?? ""),
      ...(v.BindingType === "Variable" && typeof source.VariableName === "string" ? { variable: source.VariableName } : {}),
    });
    // The value the product shows when the binding has nothing yet is the
    // honest design-time value.
    return v.FallbackValue === null ? undefined : v.FallbackValue;
  }
  if (isTyped(v, "Resource")) {
    const source = (v.Source ?? {}) as Raw;
    // The typed layout's font reference is {Type: 2, Value: <font id>}.
    if (v.ResourceType === "FontType") return { Type: 2, Value: Number(source.FontType ?? 0) };
    // Images: the resource id, so a later reader can find the bytes.
    if (v.ResourceType === "Image") return { ResourceId: source.ResourceID, Path: source.Path };
    return undefined;
  }
  if (Array.isArray(v)) {
    // A list: [{Value: [props]}, ...] - one object per item, kept in order.
    if (p.Type === "List" || p.Type === "StructList" || (v.length > 0 && v.every((x) => x && typeof x === "object" && !isRecord(x) && "Value" in (x as object)))) {
      return v.map((item, i) => unprop((item as Raw)?.Value, bindings, `${path}.${i}`));
    }
    return unprop(v, bindings, path);
  }
  return v;
}

/** A stable id from a string: the same object in the same file gets the same id. */
export function stableId(seed: string): string {
  // Two FNV-1a passes with different offsets, which is plenty to keep the ids
  // of one project apart; nothing here is security.
  const hash = (s: string, offset: number) => {
    let h = offset >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  const hex = hash(seed, 2166136261) + hash(seed, 3339675911) + hash(seed + "#", 1013904223) + hash(seed + "@", 2654435769);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** One struct object, and everything under it, in the typed layout's shape. */
function convertObject(node: unknown, seed: string, bindings: Map<string, InlineBinding[]>): Raw | null {
  if (!node || typeof node !== "object") return null;
  const o = node as Raw;
  const own: InlineBinding[] = [];
  const uid = stableId(seed);
  const out: Raw = { Type: o.Type, UniqueId: uid, Name: o.Name ?? String(o.Type), ...unprop(o.Properties, own) };
  delete out.Children;
  if (own.length > 0) bindings.set(uid, own);
  const kids = Array.isArray(o.Children) ? o.Children : [];
  if (kids.length > 0) {
    out.Children = kids.map((k, i) => convertObject(k, `${seed}/${i}`, bindings)).filter((k): k is Raw => k !== null);
  }
  return out;
}

const decode = (bytes: Uint8Array) => new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");

/** PanelIDs in the order a `.inf` folder tree lists them. */
function panelOrder(tree: unknown): { id: number; name: string }[] {
  const out: { id: number; name: string }[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as Raw;
    if (n.Folder === false && typeof n.PanelID === "number") out.push({ id: n.PanelID, name: String(n.Name ?? "") });
    if (Array.isArray(n.Children)) n.Children.forEach(walk);
  };
  walk((tree as Raw | undefined)?.Hierarchy);
  return out;
}

export async function readStructProject(
  bytes: Uint8Array,
  fileName = "project.vxdz",
): Promise<Omit<ReadProject, "preserved"> & { converted: Raw[] }> {
  // The same central-directory check readProject makes before inflating.
  guardZip(bytes);
  const zip = await JSZip.loadAsync(bytes);
  const entries = new Map<string, Uint8Array>();
  for (const [name, file] of Object.entries(zip.files)) {
    if (!file.dir) entries.set(name.replace(/\\/g, "/").toLowerCase(), await file.async("uint8array"));
  }
  const get = (path: string) => entries.get(path.toLowerCase());
  const json = (path: string) => {
    const e = get(path);
    if (!e) return undefined;
    try {
      return JSON.parse(decode(e)) as unknown;
    } catch {
      return undefined;
    }
  };
  const warnings: string[] = [];

  // --- target -------------------------------------------------------------
  const project = (json("Project.dat") ?? {}) as Raw;
  const resolution = (Array.isArray(project.Target) ? project.Target : [])
    .map((t: Raw) => t?.Resolution as Raw | undefined)
    .find((r) => r && typeof r.Width === "number");
  const targetDat = unprop(((json("Target.dat") ?? {}) as Raw).Properties);
  const info = (targetDat.TargetInfo ?? {}) as Raw;
  const prefs = (targetDat.Preferences ?? {}) as Raw;
  const target: Panel = {
    model: String(info.RuntimeModel ?? prefs.ModelName ?? "unknown"),
    width: typeof resolution?.Width === "number" ? resolution.Width : 800,
    height: typeof resolution?.Height === "number" ? resolution.Height : 480,
  };

  // --- screens and content screens ------------------------------------------
  const screens: Screen[] = [];
  const foreign: Record<string, ForeignSummary[]> = {};
  const wires: Wire[] = [];
  const carriedRoots: Record<string, number> = {};
  /** ContentID -> the box of the first display that shows it. */
  const shown = new Map<number, { width: number; height: number }>();
  /** Every screen as translated, before modelling: the harness reads these. */
  const converted: Raw[] = [];
  let opaqueParts = 0;
  let otherBindings = 0;

  const listed = (tree: string, area: "Screens" | "Contents") => {
    const order = panelOrder(json(tree));
    // Panels on disk the tree forgot still exist; list them after.
    for (const name of entries.keys()) {
      const m = name.match(new RegExp(`^${area.toLowerCase()}/panel(\\d+)\\.dat$`));
      if (m && !order.some((o) => o.id === Number(m[1]))) order.push({ id: Number(m[1]), name: "" });
    }
    return order;
  };

  const read = (area: "Screens" | "Contents", panel: { id: number; name: string }) => {
    const doc = json(`${area}/panel${panel.id}.dat`) as Raw | undefined;
    if (!doc || !doc.GraphicalObjects) return;
    const props = unprop(doc.Properties);
    const id = stableId(`${fileName}:${area}/${panel.id}`);
    const bindings = new Map<string, InlineBinding[]>();
    const root = convertObject(doc.GraphicalObjects, `${fileName}:${area}/${panel.id}/root`, bindings);
    if (!root) return;
    if (!Array.isArray(root.Children)) root.Children = [];
    const name = String(doc.Name || panel.name || `${area === "Screens" ? "Screen" : "Content"}${panel.id}`);
    const raw: Raw = {
      Type: area === "Screens" ? "Screen" : "Content",
      UniqueId: id,
      Name: name,
      ...(area === "Contents" ? { ContentID: typeof props.ContentID === "number" ? props.ContentID : panel.id } : {}),
      Children: [root],
    };
    converted.push(raw);
    const modelled = modelScreen(raw, target, typeof raw.ContentID === "number" ? shown.get(raw.ContentID) : undefined);
    if (modelled.screen) displaySizes(modelled.screen, shown);
    if (!modelled.screen) {
      const type = String(root.Type);
      carriedRoots[type] = (carriedRoots[type] ?? 0) + 1;
      return;
    }
    const screen = modelled.screen;
    screens.push(screen);
    opaqueParts += modelled.opaque.length;
    if (modelled.opaque.length > 0) {
      foreign[screen.UniqueId] = modelled.foreign ?? modelled.opaque.map((o) => summariseOpaque(o.raw));
    }
    const parts = new Map(screen.Children[0].Children.map((p) => [p.UniqueId, p]));
    for (const [uid, list] of bindings) {
      const part = parts.get(uid);
      for (const b of list) {
        if (part && b.variable) wires.push({ part, tag: b.variable, property: b.property, screenId: screen.UniqueId });
        else otherBindings++;
      }
    }
  };

  for (const panel of listed("hierarchy.inf", "Screens")) read("Screens", panel);
  for (const panel of listed("contents.inf", "Contents")) read("Contents", panel);

  const carriedScreens = Object.values(carriedRoots).reduce((n, c) => n + c, 0);
  if (carriedScreens > 0) {
    const why = Object.entries(carriedRoots).map(([type, n]) => `${n} ${type}`).join(", ");
    warnings.push(`${carriedScreens} screen${carriedScreens === 1 ? "" : "s"} could not be modelled (root: ${why}).`);
  }

  // --- variables ----------------------------------------------------------
  // VariableFolderList names the table each folder's variables live in.
  const variables: Variable[] = [];
  let variableRows = 0;
  const variablesDb = get("Variables.db");
  if (variablesDb) {
    const db = await openDatabase(variablesDb);
    try {
      const tables = (db.exec('SELECT "TableName" FROM VariableFolderList ORDER BY "id"')[0]?.values ?? []).map((r) => String(r[0]));
      if (tables.length === 0) tables.push("variable_root");
      const seen = new Set<string>();
      for (const table of tables) {
        if (!/^[A-Za-z0-9_]+$/.test(table)) continue;
        let rows;
        try {
          rows = db.exec(`SELECT "Name", "TypeName", "Address" FROM "${table}" ORDER BY "id"`)[0];
        } catch {
          continue;
        }
        for (const [name, type, address] of (rows?.values ?? []) as [string, string, string | null][]) {
          const dataType = String(type ?? "").toUpperCase();
          if (seen.has(name) || !(DATA_TYPES as readonly string[]).includes(dataType)) {
            variableRows++;
            continue;
          }
          seen.add(name);
          variables.push({ Name: name, DataType: dataType as Variable["DataType"], Comments: "", DeviceAddress: address ?? "" });
        }
      }
    } finally {
      db.close();
    }
  }

  // --- alarms -------------------------------------------------------------
  const alarms: Alarm[] = [];
  const alarmDb = get("Alarm.db");
  if (alarmDb) {
    const db = await openDatabase(alarmDb);
    try {
      const bools = new Map(
        ((db.exec('SELECT "alarm_id", "condition" FROM bool_alarm')[0]?.values ?? []) as [number, number][]).map(([id, c]) => [id, c]),
      );
      const levels = new Map(
        ((db.exec('SELECT "alarm_id", "level" FROM level_alarm')[0]?.values ?? []) as [number, string][]).map(([id, l]) => [id, l]),
      );
      const rows = db.exec('SELECT "alarm_id", "type_id", "variable", "msg", "severity" FROM alarm_definition ORDER BY "alarm_id"')[0];
      for (const [id, type, variable, msg, severity] of (rows?.values ?? []) as [number, number, string, string, number][]) {
        const isBool = bools.has(id);
        alarms.push({
          Message: String(msg ?? ""),
          Trigger: String(variable ?? ""),
          AlarmType: ([1, 2, 3, 4].includes(Number(type)) ? Number(type) : 2) as Alarm["AlarmType"],
          AlarmRecordType: isBool ? 1 : 2,
          Severity: Math.min(9, Math.max(1, Number(severity) || 5)),
          Value: isBool ? String(bools.get(id) ?? 1) : String(levels.get(id) ?? ""),
        });
      }
    } catch {
      warnings.push("The alarm tables could not be read; alarms were left out.");
    } finally {
      db.close();
    }
  }

  // A wire to a tag the variable tables do not hold (a system variable, or one
  // in a table this reader skipped) would be refused by the export; count it
  // with the other bindings that were not converted instead.
  const known = new Set(variables.map((v) => v.Name));
  const kept = wires.filter((w) => known.has(w.tag));
  otherBindings += wires.length - kept.length;
  wires.length = 0;
  wires.push(...kept);

  const appVersion = typeof project.AppVersion === "string" ? project.AppVersion : "3.x";
  warnings.unshift(
    `Converted from the ${appVersion} project layout. The editor has everything it could model; ` +
      "the export is a new 4.4 project, because this tool does not write the older layout back.",
  );
  if (otherBindings > 0) {
    warnings.push(`${otherBindings} binding${otherBindings === 1 ? "" : "s"} to language tables, system properties, expressions or carried objects were not converted.`);
  }

  const name = fileName.replace(/\.(eote|vxdz)$/i, "").replace(/[^A-Za-z0-9_]+/g, "_") || "Project";
  return {
    name,
    target,
    screens,
    foreign,
    variables,
    alarms,
    wires,
    carried: {
      entries: entries.size,
      opaqueParts,
      variableRows,
      bindingRows: otherBindings,
      screens: carriedScreens,
      roots: carriedRoots,
    },
    warnings,
    converted,
  };
}
