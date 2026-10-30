/**
 * The project's own structure, read from the workspace's files: screens,
 * the objects on them at every depth, what each is bound to, and the tags.
 *
 * The tools speak in these terms so the agent can find "the START button on
 * Screen1" without walking JSON by hand. Writes that have to be exactly right
 * (a binding, a copied object, a new screen) go through here or through the
 * packager, never through a model's guess at the format.
 */

import { readProject, type ReadProject } from "@/lib/ote/reader";
import { packageProject } from "@/lib/ote/packager";
import type { Part } from "@/lib/ote/schema";
import type { Wire } from "@/lib/ote/bindings";
import { Workspace, WorkspaceError } from "./workspace";

type Json = Record<string, unknown>;

export interface ScreenInfo {
  kind: "screen" | "content";
  id: string;
  /** The folder it is stored in: what Screens/Hierarchy.dat lists. A master screen's differs from its UniqueId. */
  folder: string;
  name: string;
  /** Metadata Id (the number a screen switch uses) or ContentID. */
  number?: number;
  path: string;
  objects: number;
}

export interface ObjectInfo {
  id: string;
  type: string;
  name: string;
  screen: string;
  screenId: string;
  file: string;
  /** JSON pointer to the object inside its file. */
  pointer: string;
  /** Names of the containers it sits in, outermost first. */
  parents: string[];
  box?: { left: number; top: number; width: number; height: number };
  /** The grid cell, for an object laid out by a grid. */
  cell?: { row: number; column: number; rowSpan: number; columnSpan: number };
  text?: string;
  bound: { property: string; text: string; mode: number }[];
}

export interface BindingRow {
  objectId: string;
  object: string;
  type: string;
  /** 8 a screen object, 4 a variable, 30 an alarm. */
  objectType: number;
  property: string;
  text: string;
  mode: number;
  screenId?: string;
}

const isGuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/* ------------------------------------------------------------- screens */

export function screens(ws: Workspace): ScreenInfo[] {
  const out: ScreenInfo[] = [];
  for (const path of ws.list()) {
    const m = /^(Screens|Contents)\/([^/]+)\/Screen\.dat$/i.exec(path);
    if (!m) continue;
    const raw = ws.json<Json>(path);
    const meta = m[1].toLowerCase() === "screens" && ws.has(`Screens/${m[2]}/Metadata.dat`) ? ws.json<Json>(`Screens/${m[2]}/Metadata.dat`) : undefined;
    out.push({
      kind: m[1].toLowerCase() === "screens" ? "screen" : "content",
      id: String(raw.UniqueId ?? m[2]),
      folder: m[2],
      name: String(raw.Name ?? meta?.Name ?? m[2]),
      number: (meta?.Id as number | undefined) ?? (raw.ContentID as number | undefined) ?? (raw.ScreenID as number | undefined),
      path,
      objects: walk(raw).length,
    });
  }
  return out;
}

export function screenByName(ws: Workspace, name: string): ScreenInfo {
  const all = screens(ws);
  const lower = name.toLowerCase();
  const hit = all.find((s) => s.name.toLowerCase() === lower || s.id.toLowerCase() === lower || s.folder.toLowerCase() === lower || s.path.toLowerCase() === lower);
  if (!hit) throw new WorkspaceError(`no screen "${name}". Screens: ${all.map((s) => s.name).join(", ")}`);
  return hit;
}

/* ------------------------------------------------------------- objects */

interface Walked {
  node: Json;
  pointer: string;
  parents: string[];
}

/** Every object (a node with Type and UniqueId) below the root, depth first. */
export function walk(root: Json): Walked[] {
  const out: Walked[] = [];
  const visit = (value: unknown, pointer: string, parents: string[]) => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => visit(v, `${pointer}/${i}`, parents));
      return;
    }
    if (!value || typeof value !== "object") return;
    const node = value as Json;
    const isObject = typeof node.Type === "string" && isGuid(node.UniqueId);
    if (isObject && pointer !== "") out.push({ node, pointer, parents });
    const next = isObject && pointer !== "" ? [...parents, String(node.Name ?? node.Type)] : parents;
    for (const [k, v] of Object.entries(node)) if (v && typeof v === "object") visit(v, `${pointer}/${escape(k)}`, next);
  };
  visit(root, "", []);
  return out;
}

export function objects(ws: Workspace, screen?: string): ObjectInfo[] {
  const bound = bindingsByObject(ws);
  const list = screen ? [screenByName(ws, screen)] : screens(ws);
  return list.flatMap((s) =>
    walk(ws.json<Json>(s.path)).map(({ node, pointer, parents }) => {
      const loc = node.Location as { Left?: number; Top?: number } | undefined;
      const box =
        typeof node.Width === "number" && typeof node.Height === "number"
          ? { left: loc?.Left ?? 0, top: loc?.Top ?? 0, width: node.Width as number, height: node.Height as number }
          : undefined;
      const id = String(node.UniqueId);
      const g = node.Location as { Row?: number; Column?: number; RowSpan?: number; ColumnSpan?: number } | undefined;
      const cell = g && (g.Row !== undefined || g.Column !== undefined)
        ? { row: g.Row ?? 0, column: g.Column ?? 0, rowSpan: g.RowSpan ?? 1, columnSpan: g.ColumnSpan ?? 1 }
        : undefined;
      return {
        id,
        type: String(node.Type),
        name: String(node.Name ?? ""),
        screen: s.name,
        screenId: s.id,
        file: s.path,
        pointer,
        parents,
        box,
        cell,
        text: textOf(node),
        bound: (bound.get(id.toLowerCase()) ?? []).map((b) => ({ property: b.property, text: b.text, mode: b.mode })),
      };
    }),
  );
}

export function findObject(ws: Workspace, ref: string, screen?: string): ObjectInfo {
  const all = objects(ws, screen);
  const lower = ref.toLowerCase();
  const byId = all.find((o) => o.id.toLowerCase() === lower);
  if (byId) return byId;
  const byName = all.filter((o) => o.name.toLowerCase() === lower);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new WorkspaceError(`"${ref}" names ${byName.length} objects (${byName.map((o) => `${o.screen}:${o.id}`).join(", ")}); give its id or a screen`);
  }
  throw new WorkspaceError(`no object "${ref}"${screen ? ` on ${screen}` : ""}`);
}

function textOf(node: Json): string | undefined {
  const t = node.Text;
  if (typeof t === "string") return t;
  if (t && typeof t === "object") return Object.values(t as Json).filter((v) => typeof v === "string").join(" / ") || undefined;
  const on = (node.On as Json | undefined)?.Text;
  const off = (node.Off as Json | undefined)?.Text;
  if (typeof on === "string" || typeof off === "string") return `${off ?? ""} / ${on ?? ""}`;
  return undefined;
}

/* ------------------------------------------------------------ bindings */

interface Graph {
  Sources: Json[];
  Targets: Json[];
  Bindings: Json[];
}

const graphOf = (ws: Workspace): Graph =>
  ws.has("Bindings.dat") ? ws.json<Graph>("Bindings.dat") : { Sources: [], Targets: [], Bindings: [] };

export function bindings(ws: Workspace): BindingRow[] {
  const g = graphOf(ws);
  const targets = new Map(g.Targets.map((t) => [t.ReferenceId as number, t]));
  return g.Bindings.flatMap((b) => {
    const t = targets.get(b.Target as number);
    if (!t) return [];
    return [{
      objectId: String(t.ObjectId),
      object: String(t.ObjectFullName ?? ""),
      type: String(t.SubType ?? t.ObjectType),
      objectType: Number(t.ObjectType),
      property: String(b.TargetProperty ?? ""),
      text: String(b.BindingText ?? ""),
      mode: Number(b.Mode ?? 1),
      screenId: t.ScreenId as string | undefined,
    }];
  });
}

function bindingsByObject(ws: Workspace): Map<string, BindingRow[]> {
  const out = new Map<string, BindingRow[]>();
  for (const b of bindings(ws)) {
    const k = b.objectId.toLowerCase();
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(b);
  }
  return out;
}

/**
 * Bind an object's property to a tag, the way the packager writes every
 * binding: the PLC symbol's full name and parent ids, the target's sub type
 * and screen, the Mode. Any object on any screen, Compound Object instances
 * included.
 */
export async function bind(ws: Workspace, objectRef: string, property: string, tag: string, mode?: 1 | 2): Promise<string> {
  const o = findObject(ws, objectRef);
  const read = await readProject(await ws.toBytes(), ws.fileName);
  const variable = read.variables.find((v) => v.Name.toLowerCase() === tag.toLowerCase());
  if (!variable) throw new WorkspaceError(`no tag "${tag}"; list them with tags`);
  const part = { UniqueId: o.id, Type: o.type, Name: o.name } as unknown as Part;
  const wires: Wire[] = [
    ...read.wires.filter((w) => !(w.part.UniqueId.toLowerCase() === o.id.toLowerCase() && w.property === property)),
    { part, tag: variable.Name, property, screenId: o.screenId, ...(mode ? { mode } : {}) },
  ];
  await ws.load(await packageProject({ ...read, wires }, undefined, read.preserved));
  const row = bindings(ws).find((b) => b.objectId.toLowerCase() === o.id.toLowerCase() && b.property === property);
  if (!row) throw new WorkspaceError("the binding was not written");
  return `${o.name} (${o.type}).${property} <- ${row.text}, mode ${row.mode}`;
}

/** Remove an object's bindings (one property, or all), and the targets and sources left unused. */
export function unbind(ws: Workspace, objectRef: string, property?: string): number {
  const o = findObject(ws, objectRef);
  const g = graphOf(ws);
  const targetIds = new Set(g.Targets.filter((t) => String(t.ObjectId).toLowerCase() === o.id.toLowerCase()).map((t) => t.ReferenceId as number));
  const kept = g.Bindings.filter((b) => !(targetIds.has(b.Target as number) && (!property || b.TargetProperty === property)));
  const removed = g.Bindings.length - kept.length;
  if (removed === 0) return 0;

  const usedTargets = new Set(kept.map((b) => b.Target as number));
  const usedSources = new Set(kept.flatMap((b) => String(b.Sources ?? "").split(",").filter(Boolean).map(Number)));
  const tMap = new Map<number, number>();
  const sMap = new Map<number, number>();
  const Targets = g.Targets.filter((t) => usedTargets.has(t.ReferenceId as number)).map((t, i) => (tMap.set(t.ReferenceId as number, i), { ...t, ReferenceId: i }));
  const Sources = g.Sources.filter((s) => usedSources.has(s.ReferenceId as number)).map((s, i) => (sMap.set(s.ReferenceId as number, i), { ...s, ReferenceId: i }));
  const Bindings = kept.map((b) => ({
    ...b,
    Target: tMap.get(b.Target as number),
    Sources: String(b.Sources ?? "").split(",").filter(Boolean).map((n) => sMap.get(Number(n))).join(","),
  }));
  ws.writeJson("Bindings.dat", { ...g, Sources, Targets, Bindings });
  return removed;
}

/* ------------------------------------------------------- copying objects */

/** New UniqueIds for every object in a copied subtree, with a map old -> new. */
export function regenerateIds<T>(value: T): { value: T; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  const copy = JSON.parse(JSON.stringify(value));
  for (const { node } of walk({ Children: [copy] } as Json)) {
    const fresh = crypto.randomUUID();
    ids.set(String(node.UniqueId).toLowerCase(), fresh);
    node.UniqueId = fresh;
  }
  return { value: copy, ids };
}

/**
 * Copy an object (and everything inside it) onto a screen, into the root
 * container or a named container. Bindings are not copied: a copy bound to
 * the same tag is usually a mistake, so the agent binds it on purpose.
 */
export function cloneObject(
  ws: Workspace,
  objectRef: string,
  toScreen: string,
  options: { name?: string; container?: string; left?: number; top?: number; row?: number; column?: number } = {},
): ObjectInfo & { overlaps: string[] } {
  const src = findObject(ws, objectRef);
  const node = get(ws.json<Json>(src.file), src.pointer) as Json;
  const { value } = regenerateIds(node);
  const copy = value as Json;
  const target = screenByName(ws, toScreen);
  const screen = ws.json<Json>(target.path);
  const names = new Set(walk(screen).map((w) => String(w.node.Name ?? "")));
  let name = options.name ?? String(copy.Name ?? copy.Type);
  for (let n = 2; names.has(name) && !options.name; n++) name = `${String(copy.Name ?? copy.Type).replace(/\d+$/, "")}${n}`;
  copy.Name = name;

  const holder = options.container
    ? walk(screen).find((w) => String(w.node.Name).toLowerCase() === options.container!.toLowerCase() && Array.isArray(w.node.Children))?.node
    : ((screen.Children as Json[] | undefined)?.[0] ?? screen);
  if (!holder) throw new WorkspaceError(`no container "${options.container}" on ${target.name}`);
  if (!Array.isArray(holder.Children)) holder.Children = [];
  const siblings = holder.Children as Json[];
  const loc = { ...((copy.Location as Json | undefined) ?? {}) };
  let overlaps: string[] = [];

  if (holder.Type === "Grid") {
    // In a grid an object sits in a cell; Left and Top mean nothing there.
    const rows = Array.isArray(holder.Rows) ? holder.Rows.length : 1;
    const columns = Array.isArray(holder.Columns) ? holder.Columns.length : 1;
    const rowSpan = Number(loc.RowSpan ?? 1);
    const columnSpan = Number(loc.ColumnSpan ?? 1);
    const taken = siblings.map((c) => {
      const l = (c.Location as Json | undefined) ?? {};
      return { name: String(c.Name ?? c.Type), row: Number(l.Row ?? 0), column: Number(l.Column ?? 0), rows: Number(l.RowSpan ?? 1), columns: Number(l.ColumnSpan ?? 1) };
    });
    const under = (row: number, column: number) => taken.filter((t) =>
      row < t.row + t.rows && t.row < row + rowSpan && column < t.column + t.columns && t.column < column + columnSpan).map((t) => t.name);
    // With no cell given: the first free one, reading across then down, that
    // the copy fits in whole; else where the original sits.
    let free: { row: number; column: number } | undefined;
    for (let r = 0; r + rowSpan <= rows && !free; r++) {
      for (let c = 0; c + columnSpan <= columns && !free; c++) if (!under(r, c).length) free = { row: r, column: c };
    }
    const row = options.row ?? free?.row ?? Number(loc.Row ?? 0);
    const column = options.column ?? (options.row === undefined ? free?.column : undefined) ?? Number(loc.Column ?? 0);
    if (row < 0 || row >= rows || column < 0 || column >= columns) {
      throw new WorkspaceError(`${holder.Name ?? "the grid"} has ${rows} rows and ${columns} columns (from 0); row ${row}, column ${column} is outside it`);
    }
    overlaps = under(row, column);
    if (overlaps.length) {
      overlaps.push(free
        ? `(a free ${rowSpan}x${columnSpan} cell: row ${free.row}, column ${free.column})`
        : `(the grid has no free ${rowSpan}x${columnSpan} cell; a smaller RowSpan or ColumnSpan may fit)`);
    }
    // The engineer's grid objects carry Left and Top as null.
    if ("Left" in loc) loc.Left = null;
    if ("Top" in loc) loc.Top = null;
    copy.Location = { ...loc, Row: row, Column: column };
  } else if (options.left !== undefined || options.top !== undefined) {
    copy.Location = { ...loc, Left: options.left ?? loc.Left ?? 0, Top: options.top ?? loc.Top ?? 0 };
  }
  siblings.push(copy);
  ws.writeJson(target.path, screen);
  return { ...findObject(ws, String(copy.UniqueId)), overlaps };
}

/* ------------------------------------------------------- whole screens */

/**
 * A copy of a screen: new UniqueIds throughout, the next free Metadata Id,
 * listed in the screen tree beside the original. Bindings stay on the
 * original; the copy is bound on purpose.
 */
export function duplicateScreen(ws: Workspace, from: string, name: string): ScreenInfo {
  const src = screenByName(ws, from);
  if (src.kind !== "screen") throw new WorkspaceError("only screens can be duplicated; copy a content screen's objects instead");
  if (ws.has(`Screens/${src.folder}/Folder.dat`)) throw new WorkspaceError(`${src.name} is a master screen (a folder of screens); duplicate one of its screens instead`);
  if (screens(ws).some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new WorkspaceError(`a screen called ${name} exists`);
  const id = crypto.randomUUID();
  const folder = src.path.replace(/\/Screen\.dat$/i, "");
  ws.copy(folder, `Screens/${id}`);

  const raw = ws.json<Json>(src.path);
  const { value } = regenerateIds(raw.Children);
  const used = screens(ws).filter((s) => s.kind === "screen").map((s) => s.number ?? 0);
  const number = Math.max(0, ...used) + 1;
  ws.writeJson(`Screens/${id}/Screen.dat`, { ...raw, UniqueId: id, Name: name, ScreenID: number, Children: value, ...(raw.NavigationSwitch ? { NavigationSwitch: { ...(raw.NavigationSwitch as Json), Label: name } } : {}) });
  if (ws.has(`Screens/${id}/Metadata.dat`)) {
    const meta = ws.json<Json>(`Screens/${id}/Metadata.dat`);
    ws.writeJson(`Screens/${id}/Metadata.dat`, { ...meta, Id: number, Name: name, Order: number });
  }
  if (ws.has("Screens/Hierarchy.dat")) {
    const tree = ws.json<Json[]>("Screens/Hierarchy.dat");
    const place = (nodes: Json[]): boolean => {
      const i = nodes.findIndex((n) => String(n.ObjectId).toLowerCase() === src.folder.toLowerCase());
      if (i >= 0) {
        nodes.splice(i + 1, 0, { ObjectId: id, Children: [] });
        return true;
      }
      return nodes.some((n) => Array.isArray(n.Children) && place(n.Children as Json[]));
    };
    if (!place(tree)) tree.push({ ObjectId: id, Children: [] });
    ws.writeJson("Screens/Hierarchy.dat", tree);
  }
  return screenByName(ws, id);
}

/* -------------------------------------------------------- JSON pointers */

const escape = (k: string) => k.replace(/~/g, "~0").replace(/\//g, "~1");
const unescape = (k: string) => k.replace(/~1/g, "/").replace(/~0/g, "~");

export function get(root: unknown, pointer: string): unknown {
  if (pointer === "" || pointer === "/") return root;
  let cur: unknown = root;
  for (const raw of pointer.replace(/^\//, "").split("/")) {
    const k = unescape(raw);
    if (cur === null || typeof cur !== "object") throw new WorkspaceError(`${pointer}: nothing at ${k}`);
    cur = (cur as Json)[k];
    if (cur === undefined) throw new WorkspaceError(`${pointer}: no key "${k}"`);
  }
  return cur;
}

/** Set (or with `remove`, delete) a value. "-" as the last segment appends to an array. */
export function set(root: unknown, pointer: string, value: unknown, remove = false): void {
  const parts = pointer.replace(/^\//, "").split("/").map(unescape);
  const last = parts.pop();
  if (last === undefined || pointer === "") throw new WorkspaceError("give a pointer below the root, e.g. /Children/0/Width");
  const parent = get(root, parts.length ? `/${parts.map(escape).join("/")}` : "");
  if (Array.isArray(parent)) {
    if (last === "-") {
      if (remove) throw new WorkspaceError("nothing to remove at -");
      parent.push(value);
      return;
    }
    const i = Number(last);
    if (!Number.isInteger(i) || i < 0 || i > parent.length) throw new WorkspaceError(`${pointer}: ${last} is not an index of the array`);
    if (remove) parent.splice(i, 1);
    else parent[i] = value;
    return;
  }
  if (!parent || typeof parent !== "object") throw new WorkspaceError(`${pointer}: the parent is not an object`);
  if (remove) delete (parent as Json)[last];
  else (parent as Json)[last] = value;
}

export type { ReadProject };
