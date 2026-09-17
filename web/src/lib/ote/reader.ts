/**
 * .eote -> project tree, keeping everything it does not understand.
 *
 * The writer's rule is "the canvas may only render what the packager can
 * emit". The reader's rule is the mirror: **nothing read is ever lost.** An
 * engineer opens a 2019 station, adds a pump, exports, and every recipe table,
 * security setting, script and unknown object comes back byte-identical.
 *
 * So this is a preservation problem first and a parsing problem second. The
 * whole ZIP is kept; the parts of it the store can model are modelled; the
 * rest travels alongside as `Preserved` and the writer puts it back.
 * docs/PLAN_PHASE1.md.
 */

import JSZip from "jszip";
import { DATA_TYPES, Part, Screen, type Alarm, type Variable } from "./schema";
import type { BindingGraph, BindingRow, Source, Target, Wire } from "./bindings";
import { OBJECT_TYPE } from "./bindings";
import type { AlarmTarget, VariableIds } from "./databases";
import { openDatabase, readPanel, type Panel } from "./packager";

/** A child of a screen the schema cannot model, kept where it was. */
export interface OpaquePart {
  index: number;
  raw: unknown;
}

export interface PreservedScreen {
  /** The original Screen.dat, parsed but untouched. */
  raw: Record<string, unknown>;
  /** The original JSON of every modelled part, by UniqueId, for merging. */
  parts: Map<string, Record<string, unknown>>;
  opaque: OpaquePart[];
  /** The original Metadata.dat, parsed. */
  metadata: Record<string, unknown>;
  fingerprint: string;
}

export interface Preserved {
  /** Every entry of the file, by its exact (backslash) name. */
  entries: Map<string, Uint8Array>;
  screens: Map<string, PreservedScreen>;
  /** Screen ids in hierarchy order, as read. */
  order: string[];
  variableIds: VariableIds;
  alarms: { groupId: string | null; groupName: string; uids: string[]; startId: number };
  alarmTargets: AlarmTarget[];
  /** Binding rows the reader could not model, kept verbatim for re-appending. */
  extra: { sources: Source[]; targets: Target[]; bindings: BindingRow[] };
  fingerprints: { variables: string; alarms: string; wires: string };
}

/** A carried object, described for the canvas: see ForeignPart in the store. */
export interface ForeignSummary {
  type: string;
  name: string;
  box: { left: number; top: number; width: number; height: number } | null;
}

/** What the canvas can say about an object it cannot model. */
export function summariseOpaque(raw: unknown): ForeignSummary {
  const r = (raw ?? {}) as Record<string, unknown>;
  const loc = r.Location as Record<string, unknown> | undefined;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const left = num(loc?.Left);
  const top = num(loc?.Top);
  const width = num(r.Width);
  const height = num(r.Height);
  return {
    type: typeof r.Type === "string" ? r.Type : "Unknown",
    name: typeof r.Name === "string" ? r.Name : "",
    box:
      left !== undefined && top !== undefined && width !== undefined && height !== undefined
        ? { left, top, width, height }
        : null,
  };
}

export interface ReadProject {
  name: string;
  target: Panel;
  screens: Screen[];
  /** Carried objects per screen UniqueId, for the canvas and the layers panel. */
  foreign: Record<string, ForeignSummary[]>;
  variables: Variable[];
  alarms: Alarm[];
  wires: Wire[];
  preserved: Preserved;
  /** What was carried rather than modelled, for the UI to say so. */
  carried: { entries: number; opaqueParts: number; variableRows: number; bindingRows: number };
  warnings: string[];
}

const decode = (bytes: Uint8Array) => new TextDecoder("utf-8").decode(bytes);

/** Entry lookup that does not care which slash the file used. */
function index(entries: Map<string, Uint8Array>) {
  const byPath = new Map<string, string>();
  for (const name of entries.keys()) byPath.set(name.replace(/\\/g, "/").toLowerCase(), name);
  return (path: string) => {
    const raw = byPath.get(path.replace(/\\/g, "/").toLowerCase());
    return raw !== undefined ? entries.get(raw) : undefined;
  };
}

export const fingerprintVariables = (variables: Variable[]) =>
  JSON.stringify(variables.map((v) => [v.Name, v.DataType, v.Comments ?? "", v.DeviceAddress ?? ""]));

export const fingerprintAlarms = (alarms: Alarm[]) =>
  JSON.stringify(
    alarms.map((a) => [a.Message, a.Trigger, a.AlarmType, a.AlarmRecordType, a.Severity, a.Value]),
  );

export const fingerprintWires = (wires: Wire[]) =>
  JSON.stringify(
    wires
      .map((w) => [w.part.UniqueId, w.tag, w.property, w.screenId ?? ""])
      .sort((a, b) => String(a).localeCompare(String(b))),
  );

export const fingerprintScreen = (screen: Screen) => JSON.stringify(screen);

/** The screen the store holds, and what was set aside from it. */
function modelScreen(raw: Record<string, unknown>): { screen: Screen | null; parts: Map<string, Record<string, unknown>>; opaque: OpaquePart[] } {
  const view = (raw.Children as Record<string, unknown>[] | undefined)?.[0];
  const parts = new Map<string, Record<string, unknown>>();
  const opaque: OpaquePart[] = [];
  if (!view || !Array.isArray(view.Children)) return { screen: null, parts, opaque };

  const known: Part[] = [];
  (view.Children as Record<string, unknown>[]).forEach((child, i) => {
    const parsed = Part.safeParse(child);
    if (parsed.success) {
      known.push(parsed.data);
      parts.set(parsed.data.UniqueId, child);
    } else {
      opaque.push({ index: i, raw: child });
    }
  });

  const candidate = {
    ...raw,
    Children: [{ ...view, Children: known }],
  };
  const parsed = Screen.safeParse(candidate);
  return { screen: parsed.success ? parsed.data : null, parts, opaque };
}

export async function readProject(bytes: Uint8Array, fileName = "project.eote"): Promise<ReadProject> {
  const zip = await JSZip.loadAsync(bytes);
  const entries = new Map<string, Uint8Array>();
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    entries.set(name, await file.async("uint8array"));
  }
  const get = index(entries);
  const warnings: string[] = [];
  const json = (path: string) => {
    const e = get(path);
    return e ? (JSON.parse(decode(e)) as unknown) : undefined;
  };

  // --- target -------------------------------------------------------------
  const target = readPanel(json("Target.dat")) ?? { model: "unknown", width: 1024, height: 600 };

  // --- screens ------------------------------------------------------------
  const hierarchy = (json("Screens/Hierarchy.dat") as { ObjectId: string }[] | undefined) ?? [];
  const order = hierarchy.map((h) => h.ObjectId);
  // Screens the hierarchy forgot still exist on disk; list them after.
  for (const name of entries.keys()) {
    const m = name.replace(/\\/g, "/").match(/^Screens\/([^/]+)\/Screen\.dat$/i);
    if (m && !order.includes(m[1])) order.push(m[1]);
  }

  const screens: Screen[] = [];
  const preservedScreens = new Map<string, PreservedScreen>();
  const foreign: Record<string, ForeignSummary[]> = {};
  let opaqueParts = 0;
  for (const id of order) {
    const raw = json(`Screens/${id}/Screen.dat`) as Record<string, unknown> | undefined;
    if (!raw) {
      warnings.push(`Hierarchy lists screen ${id} but it has no Screen.dat`);
      continue;
    }
    const metadata = (json(`Screens/${id}/Metadata.dat`) as Record<string, unknown> | undefined) ?? {};
    const { screen, parts, opaque } = modelScreen(raw);
    if (!screen) {
      warnings.push(`Screen ${id} could not be modelled; it is carried through unchanged`);
      continue;
    }
    opaqueParts += opaque.length;
    if (opaque.length > 0) foreign[screen.UniqueId] = opaque.map((o) => summariseOpaque(o.raw));
    screens.push(screen);
    preservedScreens.set(id, { raw, parts, opaque, metadata, fingerprint: fingerprintScreen(screen) });
  }

  // --- variables ----------------------------------------------------------
  const variables: Variable[] = [];
  const variableIds: VariableIds = {};
  let variableRows = 0;
  const variablesDb = get("Variables.db");
  if (variablesDb) {
    const db = await openDatabase(variablesDb);
    try {
      const rows = db.exec(
        'SELECT "UniqueId", "Name", "DataType", "Comments", "DeviceAddress" FROM Variables ORDER BY "Order"',
      )[0];
      for (const row of rows?.values ?? []) {
        const [uid, name, dataType, comments, address] = row as [string, string, string, string | null, string | null];
        if (!(DATA_TYPES as readonly string[]).includes(dataType)) {
          variableRows++;
          continue;
        }
        variables.push({
          Name: name,
          DataType: dataType as Variable["DataType"],
          Comments: comments ?? "",
          DeviceAddress: address ?? "",
        });
        variableIds[name] = uid;
      }
    } finally {
      db.close();
    }
  } else {
    warnings.push("No Variables.db in the file");
  }
  const byVariableId = new Map(Object.entries(variableIds).map(([name, id]) => [id.toUpperCase(), name]));

  // --- bindings -----------------------------------------------------------
  const graph = (json("Bindings.dat") as BindingGraph | undefined) ?? { Sources: [], Targets: [], Bindings: [] };
  const sourcesByRef = new Map(graph.Sources.map((s) => [s.ReferenceId, s]));
  const targetsByRef = new Map(graph.Targets.map((t) => [t.ReferenceId, t]));
  const partsById = new Map(
    screens.flatMap((s) => s.Children[0].Children.map((p) => [p.UniqueId.toLowerCase(), { part: p, screenId: s.UniqueId }] as const)),
  );

  const wires: Wire[] = [];
  const triggers = new Map<string, string>(); // alarm uid (upper) -> tag
  const extra: Preserved["extra"] = { sources: [], targets: [], bindings: [] };
  const usedSources = new Set<number>();
  const usedTargets = new Set<number>();

  for (const row of graph.Bindings) {
    const target = targetsByRef.get(row.Target);
    const sourceRefs = String(row.Sources ?? "")
      .split(",")
      .filter((s) => s.trim() !== "")
      .map((s) => Number(s));
    const source = sourceRefs.length === 1 ? sourcesByRef.get(sourceRefs[0]) : undefined;
    const tag = source && source.ObjectType === OBJECT_TYPE.VARIABLE ? byVariableId.get(source.ObjectId.toUpperCase()) : undefined;

    if (target && target.ObjectType === OBJECT_TYPE.PART && tag && !row.ConverterId) {
      const found = partsById.get(target.ObjectId.toLowerCase());
      if (found) {
        wires.push({ part: found.part, tag, property: row.TargetProperty, screenId: found.screenId });
        usedSources.add(sourceRefs[0]);
        usedTargets.add(row.Target);
        continue;
      }
    }
    if (target && target.ObjectType === OBJECT_TYPE.ALARM && tag && row.TargetProperty === "VariableName") {
      triggers.set(target.ObjectId.toUpperCase(), tag);
      usedSources.add(sourceRefs[0]);
      usedTargets.add(row.Target);
      continue;
    }
    extra.bindings.push(row);
  }
  for (const t of graph.Targets) if (!usedTargets.has(t.ReferenceId)) extra.targets.push(t);
  for (const s of graph.Sources) {
    // A source is only "extra" if some extra binding still needs it.
    const needed = extra.bindings.some((b) => String(b.Sources).split(",").map(Number).includes(s.ReferenceId));
    if (needed) extra.sources.push(s);
  }
  // Extra targets that no extra binding references are dropped from `extra`
  // only if they are the ones we modelled; anything else stays.
  extra.targets = extra.targets.filter(
    (t) => !usedTargets.has(t.ReferenceId),
  );

  // --- alarms -------------------------------------------------------------
  const alarms: Alarm[] = [];
  const alarmTargets: AlarmTarget[] = [];
  const alarmMeta: Preserved["alarms"] = { groupId: null, groupName: "", uids: [], startId: 1 };
  const alarmDb = get("Alarm.db");
  if (alarmDb) {
    const db = await openDatabase(alarmDb);
    try {
      const group = db.exec('SELECT "UniqueId", "Name" FROM AlarmGroup ORDER BY "Order" LIMIT 1')[0];
      if (group?.values[0]) {
        alarmMeta.groupId = String(group.values[0][0]);
        alarmMeta.groupName = String(group.values[0][1]);
      }
      const rows = db.exec(
        'SELECT "UniqueId", "AlarmType", "AlarmRecordType", "Id", "Message", "Severity", "Value" FROM Alarm ORDER BY "Order"',
      )[0];
      const LEVEL: Record<number, string> = { 1: "HiHi", 2: "Hi", 3: "Lo", 4: "LoLo" };
      let first = true;
      for (const row of rows?.values ?? []) {
        const [uid, type, kind, id, message, severity, value] = row as [string, number, number, number, string, number, string | null];
        if (first) {
          alarmMeta.startId = Number(id) || 1;
          first = false;
        }
        const alarm: Alarm = {
          Message: String(message ?? ""),
          Trigger: triggers.get(String(uid).toUpperCase()) ?? "",
          AlarmType: ([1, 2, 3, 4].includes(Number(type)) ? Number(type) : 2) as Alarm["AlarmType"],
          AlarmRecordType: (Number(kind) === 1 ? 1 : 2) as Alarm["AlarmRecordType"],
          Severity: Math.min(9, Math.max(1, Number(severity) || 5)),
          Value: value == null ? "" : String(value),
        };
        alarms.push(alarm);
        alarmMeta.uids.push(String(uid));
        alarmTargets.push({
          uid: String(uid),
          fullName: `${alarmMeta.groupName}.Alarm${id}.${LEVEL[alarm.AlarmType]}`,
          subType: alarm.AlarmRecordType === 1 ? "BoolAlarm" : "LevelAlarm",
          trigger: alarm.Trigger,
        });
      }
    } finally {
      db.close();
    }
  }

  const name = fileName.replace(/\.eote$/i, "").replace(/[^A-Za-z0-9_]+/g, "_") || "Project";

  return {
    name,
    target,
    screens,
    foreign,
    variables,
    alarms,
    wires,
    preserved: {
      entries,
      screens: preservedScreens,
      order: screens.map((s) => s.UniqueId),
      variableIds,
      alarms: alarmMeta,
      alarmTargets,
      extra,
      fingerprints: {
        variables: fingerprintVariables(variables),
        alarms: fingerprintAlarms(alarms),
        wires: fingerprintWires(wires),
      },
    },
    carried: {
      entries: entries.size,
      opaqueParts,
      variableRows,
      bindingRows: extra.bindings.length,
    },
    warnings,
  };
}
