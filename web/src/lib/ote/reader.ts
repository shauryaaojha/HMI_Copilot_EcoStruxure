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
import { guardZip } from "@/lib/ingest/zip";
import { IngestError } from "@/lib/ingest/errors";
import { readScales, scaleName, type Scale } from "./converters";

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
  /** Where it lives: a screen under Screens\, a content screen under Contents\. */
  area: "Screens" | "Contents";
}

export interface Preserved {
  /** Every entry of the file, by its exact (backslash) name. */
  entries: Map<string, Uint8Array>;
  screens: Map<string, PreservedScreen>;
  /** Modelled screen ids in hierarchy order, as read. */
  order: string[];
  /** Modelled content screen ids, as read. */
  contentOrder: string[];
  /**
   * Screens\Hierarchy.dat as read, every entry - the screens we could not
   * model too. A rewrite starts from this, so a carried screen keeps its place
   * instead of falling out of the project when another screen is added.
   */
  hierarchy: { ObjectId: string; [key: string]: unknown }[];
  variableIds: VariableIds;
  alarms: {
    groupId: string | null;
    groupName: string;
    uids: string[];
    startId: number;
    /**
     * Each modelled alarm's row exactly as read, aligned with `uids`, and the
     * key it is recognised by when written back (trigger, level, kind). A
     * rewrite reuses the row of an alarm it still holds, so its UniqueId,
     * deadband, parameter and every column the model does not cover survive
     * an edit to some other alarm.
     */
    rows?: Record<string, unknown>[];
    keys?: string[];
  };
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
  carried: {
    entries: number;
    opaqueParts: number;
    variableRows: number;
    bindingRows: number;
    /** Screens and content screens carried whole: their layout is not modelled. */
    screens: number;
    /** Their root types, e.g. { Grid: 54 }, so the UI can say why. */
    roots: Record<string, number>;
  };
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
      .map((w) => [w.part.UniqueId, w.tag, w.property, w.screenId ?? "", w.converter ? scaleName(w.converter) : ""])
      .sort((a, b) => String(a).localeCompare(String(b))),
  );

export const fingerprintScreen = (screen: Screen) => JSON.stringify(screen);

/** What identifies an alarm across an edit: what trips it, at which level, of which kind. */
export const alarmKey = (a: Pick<Alarm, "Trigger" | "AlarmType" | "AlarmRecordType">) =>
  `${a.Trigger.toLowerCase()}|${a.AlarmType}|${a.AlarmRecordType}`;

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

/**
 * Which generation of the format a file is, decided on its entry names.
 *
 * Schneider's own template packs ship both. The modern one - 4.4, and `.vxdz`
 * at AppVersion 3.4.1 and later - keeps a screen at `Screens\<guid>\Screen.dat`
 * and a `Variables` table in `Variables.db`, which is what this reader models.
 * The older one keeps screens at `Contents\panelN.dat`, models an object as a
 * `{Type, Properties[]}` node, and names its database tables differently.
 *
 * Reading it is a separate piece of work and docs/VXDZ_FINDINGS.md §7.2 is the
 * argument for not starting it. What matters here is that a file we cannot
 * read is refused by name rather than part way through, with the reason.
 */
export type ProjectLayout = "typed" | "struct";

export async function layoutOf(bytes: Uint8Array): Promise<ProjectLayout> {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const typed = names.some((n) => /Screens[\\/][0-9a-f-]{36}[\\/]Screen\.dat$/i.test(n));
  return typed ? "typed" : "struct";
}

export async function readProject(bytes: Uint8Array, fileName = "project.eote"): Promise<ReadProject> {
  // Checked here as well as at the route: the export path reads stored bytes
  // back through this function, and nothing should inflate unchecked.
  guardZip(bytes);
  const zip = await JSZip.loadAsync(bytes);
  const entries = new Map<string, Uint8Array>();
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    entries.set(name, await file.async("uint8array"));
  }
  const get = index(entries);
  const warnings: string[] = [];
  /**
   * An entry as JSON. A damaged entry is reported and treated as absent: the
   * bytes are still in `entries` and go back out unchanged, so a screen that
   * will not parse is carried rather than failing the whole open. Entries the
   * writer would *regenerate* from the model are the exception, and use
   * `required` - see Bindings.dat below.
   */
  const json = (path: string, required = false) => {
    const e = get(path);
    if (!e) return undefined;
    try {
      return JSON.parse(decode(e).replace(/^﻿/, "")) as unknown;
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      if (required) {
        throw new IngestError(
          "damaged",
          `${path.replace(/\//g, "\\")} in ${fileName} is damaged (${why}).`,
          "Open the project in Operator Terminal Expert and save it again; the product rewrites the file. Nothing was changed here.",
          { entry: path },
        );
      }
      warnings.push(`${path.replace(/\//g, "\\")} could not be read (${why}) and is carried through unchanged.`);
      return undefined;
    }
  };
  /** A database, or a refusal naming it: these are rewritten from the model. */
  const database = async (name: string) => {
    const e = get(name);
    if (!e) return undefined;
    try {
      return await openDatabase(e);
    } catch (error) {
      throw new IngestError("damaged", `${name} in ${fileName} is not a readable database (${error instanceof Error ? error.message : String(error)}).`, "Open the project in Operator Terminal Expert and save it again.", { entry: name });
    }
  };
  /** A query against a table this version of the product may not have. */
  const query = (db: Awaited<ReturnType<typeof openDatabase>>, table: string, sql: string) => {
    try {
      return db.exec(sql)[0];
    } catch (error) {
      throw new IngestError(
        "damaged",
        `The ${table} table in ${fileName} is not in the shape Operator Terminal Expert 4.4 writes (${error instanceof Error ? error.message : String(error)}).`,
        "If this project was made by a version before 3.4.1, open it in Operator Terminal Expert 4.4 and save it to upgrade it.",
        { table },
      );
    }
  };

  // --- target -------------------------------------------------------------
  const target = readPanel(json("Target.dat")) ?? { model: "unknown", width: 1024, height: 600 };

  // --- screens ------------------------------------------------------------
  const hierarchyRaw = json("Screens/Hierarchy.dat");
  const hierarchy = (Array.isArray(hierarchyRaw) ? hierarchyRaw : []).filter(
    (h): h is { ObjectId: string } => typeof (h as { ObjectId?: unknown })?.ObjectId === "string",
  );
  const order = hierarchy.map((h) => h.ObjectId);
  // Screens the hierarchy forgot still exist on disk; list them after.
  for (const name of entries.keys()) {
    const m = name.replace(/\\/g, "/").match(/^Screens\/([^/]+)\/Screen\.dat$/i);
    if (m && !order.includes(m[1])) order.push(m[1]);
  }

  // --- content screens ------------------------------------------------------
  // Contents\Hierarchy.dat is a tree: ContentFolders holding content screens.
  // A folder has a Folder.dat, a content screen a Screen.dat; only the second
  // is a screen. Ones on disk the tree forgot are listed after.
  const contentOrder: string[] = [];
  const walkContents = (nodes: unknown) => {
    for (const node of Array.isArray(nodes) ? (nodes as { ObjectId?: unknown; Children?: unknown }[]) : []) {
      if (typeof node?.ObjectId === "string" && get(`Contents/${node.ObjectId}/Screen.dat`)) contentOrder.push(node.ObjectId);
      walkContents(node?.Children);
    }
  };
  walkContents(json("Contents/Hierarchy.dat"));
  for (const name of entries.keys()) {
    const m = name.replace(/\\/g, "/").match(/^Contents\/([^/]+)\/Screen\.dat$/i);
    if (m && !contentOrder.includes(m[1])) contentOrder.push(m[1]);
  }

  const screens: Screen[] = [];
  const preservedScreens = new Map<string, PreservedScreen>();
  const foreign: Record<string, ForeignSummary[]> = {};
  let opaqueParts = 0;
  const carriedRoots: Record<string, number> = {};
  const read = (id: string, area: "Screens" | "Contents") => {
    const raw = json(`${area}/${id}/Screen.dat`) as Record<string, unknown> | undefined;
    if (!raw) {
      warnings.push(`Hierarchy lists screen ${id} but it has no Screen.dat`);
      return;
    }
    const metadata = (json(`${area}/${id}/Metadata.dat`) as Record<string, unknown> | undefined) ?? {};
    const { screen, parts, opaque } = modelScreen(raw);
    if (!screen) {
      const rootType = String(((raw.Children as Record<string, unknown>[] | undefined)?.[0]?.Type) ?? "unknown");
      carriedRoots[rootType] = (carriedRoots[rootType] ?? 0) + 1;
      return;
    }
    opaqueParts += opaque.length;
    if (opaque.length > 0) foreign[screen.UniqueId] = opaque.map((o) => summariseOpaque(o.raw));
    screens.push(screen);
    preservedScreens.set(id, { raw, parts, opaque, metadata, fingerprint: fingerprintScreen(screen), area });
  };
  for (const id of order) read(id, "Screens");
  for (const id of contentOrder) read(id, "Contents");
  const carriedScreens = Object.values(carriedRoots).reduce((n, c) => n + c, 0);
  if (carriedScreens > 0) {
    // One sentence, not one per screen: why, and that nothing was lost.
    const why = Object.entries(carriedRoots).map(([type, n]) => `${n} ${type}`).join(", ");
    warnings.push(
      `${carriedScreens} screen${carriedScreens === 1 ? "" : "s"} could not be modelled (root: ${why}) and ${carriedScreens === 1 ? "is" : "are"} carried through unchanged.` +
        (carriedRoots.Grid ? " A Grid places its children by row and column, which the editor does not lay out yet." : ""),
    );
  }

  // --- variables ----------------------------------------------------------
  const variables: Variable[] = [];
  const variableIds: VariableIds = {};
  let variableRows = 0;
  const db0 = await database("Variables.db");
  if (db0) {
    const db = db0;
    try {
      const rows = query(db, "Variables", 'SELECT "UniqueId", "Name", "DataType", "Comments", "DeviceAddress" FROM Variables ORDER BY "Order"');
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

  // --- converters ---------------------------------------------------------
  // Scale converters only: a binding through one is a bar we can model and
  // write back as itself. Every other converter type stays opaque.
  let scales = new Map<string, Scale>();
  const convertersDb = await database("Converters.db");
  if (convertersDb) {
    try {
      scales = readScales(convertersDb);
    } catch {
      // Converters we cannot read stay opaque: their bindings fall through
      // to `extra` and go back out as they came.
      warnings.push("Converters.db could not be read; bindings through a converter are carried unchanged.");
    } finally {
      convertersDb.close();
    }
  }

  // --- bindings -----------------------------------------------------------
  // Required: an export rewrites Bindings.dat from the wires plus `extra`, so
  // a graph we could not read would come back empty - every binding in the
  // project silently gone. Refusing is the only safe answer.
  const rawGraph = json("Bindings.dat", true) as Partial<BindingGraph> | undefined;
  const graph: BindingGraph = {
    Sources: Array.isArray(rawGraph?.Sources) ? rawGraph.Sources : [],
    Targets: Array.isArray(rawGraph?.Targets) ? rawGraph.Targets : [],
    Bindings: Array.isArray(rawGraph?.Bindings) ? rawGraph.Bindings : [],
  };
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

    // Through no converter, or a Scale converter we can read and write back
    // as itself; any other converter keeps the row as it was.
    const converter = row.ConverterId ? scales.get(String(row.ConverterId).toLowerCase()) : undefined;
    if (target && target.ObjectType === OBJECT_TYPE.PART && tag && (!row.ConverterId || converter)) {
      const found = partsById.get(target.ObjectId.toLowerCase());
      if (found) {
        wires.push({ part: found.part, tag, property: row.TargetProperty, screenId: found.screenId, ...(converter ? { converter } : {}) });
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
  const alarmDb = await database("Alarm.db");
  if (alarmDb) {
    const db = alarmDb;
    try {
      const groups = query(db, "AlarmGroup", 'SELECT "UniqueId", "Name" FROM AlarmGroup ORDER BY "Order"')?.values ?? [];
      if (groups[0]) {
        alarmMeta.groupId = String(groups[0][0]);
        alarmMeta.groupName = String(groups[0][1]);
      }
      // Only the first group is modelled. Alarms in any other group stay in
      // the file untouched: modelling them under the first group's name was
      // how a rewrite used to move them into it.
      const all = query(db, "Alarm", 'SELECT * FROM Alarm ORDER BY "Order"');
      const col = (name: string) => all?.columns.indexOf(name) ?? -1;
      const inGroup = (row: unknown[]) =>
        alarmMeta.groupId === null || col("AlarmGroupId") < 0 || String(row[col("AlarmGroupId")]).toUpperCase() === alarmMeta.groupId.toUpperCase();
      const mine = (all?.values ?? []).filter(inGroup);
      const others = (all?.values.length ?? 0) - mine.length;
      if (others > 0) {
        warnings.push(
          `${others} alarm${others === 1 ? "" : "s"} in ${groups.length - 1} other alarm group${groups.length - 1 === 1 ? "" : "s"} ` +
            `${others === 1 ? "is" : "are"} carried through unchanged; only "${alarmMeta.groupName}" is edited here.`,
        );
      }
      alarmMeta.rows = mine.map((r) => Object.fromEntries(all!.columns.map((c, i) => [c, r[i]])));
      alarmMeta.keys = [];
      const pick = ["UniqueId", "AlarmType", "AlarmRecordType", "Id", "Message", "Severity", "Value"].map(col);
      const rows = { values: mine.map((r) => pick.map((i) => (i >= 0 ? r[i] : null))) };
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
        alarmMeta.keys.push(alarmKey(alarm));
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
      order: screens.filter((s) => preservedScreens.get(s.UniqueId)?.area === "Screens").map((s) => s.UniqueId),
      contentOrder: screens.filter((s) => preservedScreens.get(s.UniqueId)?.area === "Contents").map((s) => s.UniqueId),
      hierarchy: (Array.isArray(hierarchy) ? hierarchy : []) as Preserved["hierarchy"],
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
      screens: carriedScreens,
      roots: carriedRoots,
    },
    warnings,
  };
}
