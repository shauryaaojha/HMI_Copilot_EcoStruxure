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
import { DATA_TYPES, Part, Screen, withOrigin, type Alarm, type Variable } from "./schema";
import type { BindingGraph, BindingRow, Source, Target, Wire } from "./bindings";
import { OBJECT_TYPE } from "./bindings";
import type { AlarmTarget, VariableIds } from "./databases";
import { openDatabase, readPanel, type Panel } from "./packager";
import { readScales, scaleName, type Scale } from "./converters";
import { flatten, isFlatRoot, layoutTree, type Laid } from "./containers";

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
  /**
   * Set when the screen is laid out by containers (a Grid root, or a canvas
   * holding grids and stacks): the resolved tree the export writes back into.
   * docs in lib/ote/containers.ts.
   */
  tree?: { laid: Laid; modelled: Set<string> };
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
export function summariseOpaque(raw: unknown, resolved?: ForeignSummary["box"]): ForeignSummary {
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
      resolved ??
      (left !== undefined && top !== undefined && width !== undefined && height !== undefined
        ? { left, top, width, height }
        : null),
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

export interface Modelled {
  screen: Screen | null;
  parts: Map<string, Record<string, unknown>>;
  opaque: OpaquePart[];
  tree?: PreservedScreen["tree"];
  /** Unmodelled leaves of a container tree, at their resolved boxes. */
  foreign?: ForeignSummary[];
}

/** The screen the store holds, and what was set aside from it. */
export function modelScreen(raw: Record<string, unknown>, panel: Panel): Modelled {
  const view = (raw.Children as Record<string, unknown>[] | undefined)?.[0];
  const parts = new Map<string, Record<string, unknown>>();
  const opaque: OpaquePart[] = [];
  if (!view || !Array.isArray(view.Children)) return { screen: null, parts, opaque };
  if (!isFlatRoot(view)) return modelTree(raw, view, panel);

  const known: Part[] = [];
  (view.Children as Record<string, unknown>[]).forEach((child, i) => {
    const parsed = Part.safeParse(withOrigin(child));
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
 * A screen laid out by containers, flattened for the editor.
 *
 * The store sees a Canvas at the root - the only root it draws - holding every
 * leaf the schema models, at the box the layout resolved. The real root and
 * everything between it and those leaves stays in `tree`, and the export
 * writes the edits back into it (lib/ote/containers.ts, `mergeTree`).
 */
function modelTree(raw: Record<string, unknown>, view: Record<string, unknown>, panel: Panel): Modelled {
  const parts = new Map<string, Record<string, unknown>>();
  const opaque: OpaquePart[] = [];
  const rootBox = {
    left: 0,
    top: 0,
    width: typeof view.Width === "number" ? view.Width : panel.width,
    height: typeof view.Height === "number" ? view.Height : panel.height,
  };
  const laid = layoutTree(view, rootBox);
  const known: Part[] = [];
  const modelled = new Set<string>();
  const foreign: ForeignSummary[] = [];
  laid.leaves.forEach((leaf, i) => {
    const parsed = Part.safeParse(flatten(leaf));
    if (parsed.success && !modelled.has(parsed.data.UniqueId)) {
      known.push(parsed.data);
      parts.set(parsed.data.UniqueId, leaf.raw);
      modelled.add(parsed.data.UniqueId);
    } else {
      opaque.push({ index: i, raw: leaf.raw });
      foreign.push(summariseOpaque(leaf.raw, leaf.box));
    }
  });

  const root = {
    Type: "Canvas" as const,
    UniqueId: view.UniqueId,
    Name: view.Name,
    ...(view.Width !== undefined ? { Width: view.Width } : {}),
    ...(view.Height !== undefined ? { Height: view.Height } : {}),
  };
  const withFill = Screen.safeParse({ ...raw, Children: [{ ...root, Fill: view.Fill, Children: known }] });
  const parsed = withFill.success ? withFill : Screen.safeParse({ ...raw, Children: [{ ...root, Children: known }] });
  return {
    screen: parsed.success ? parsed.data : null,
    parts,
    opaque,
    tree: { laid, modelled },
    foreign,
  };
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
    const { screen, parts, opaque, tree, foreign: resolved } = modelScreen(raw, target);
    if (!screen) {
      const rootType = String(((raw.Children as Record<string, unknown>[] | undefined)?.[0]?.Type) ?? "unknown");
      carriedRoots[rootType] = (carriedRoots[rootType] ?? 0) + 1;
      return;
    }
    opaqueParts += opaque.length;
    if (opaque.length > 0) foreign[screen.UniqueId] = resolved ?? opaque.map((o) => summariseOpaque(o.raw));
    screens.push(screen);
    preservedScreens.set(id, { raw, parts, opaque, metadata, fingerprint: fingerprintScreen(screen), area, ...(tree ? { tree } : {}) });
  };
  for (const id of order) read(id, "Screens");
  for (const id of contentOrder) read(id, "Contents");
  const carriedScreens = Object.values(carriedRoots).reduce((n, c) => n + c, 0);
  if (carriedScreens > 0) {
    // One sentence, not one per screen: why, and that nothing was lost.
    const why = Object.entries(carriedRoots).map(([type, n]) => `${n} ${type}`).join(", ");
    warnings.push(
      `${carriedScreens} screen${carriedScreens === 1 ? "" : "s"} could not be modelled (root: ${why}) and ${carriedScreens === 1 ? "is" : "are"} carried through unchanged.` +
        "",
    );
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

  // --- converters ---------------------------------------------------------
  // Scale converters only: a binding through one is a bar we can model and
  // write back as itself. Every other converter type stays opaque.
  let scales = new Map<string, Scale>();
  const convertersDb = get("Converters.db");
  if (convertersDb) {
    const db = await openDatabase(convertersDb);
    try {
      scales = readScales(db);
    } finally {
      db.close();
    }
  }

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
