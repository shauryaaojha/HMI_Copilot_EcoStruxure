/**
 * Arranging objects, for the agent: align, space evenly, match size, snap, and
 * finding and clearing overlaps.
 *
 * Before this the agent could only edit Location by JSON pointer and work the
 * arithmetic out itself. These call the code the canvas toolbar and the chat
 * ops call (store/edits.ts, lib/ote/tidy.ts), so all three agree on what
 * "align left" means.
 *
 * Coordinates are relative to the container, so everything arranged together
 * must share one. An object laid out by a grid cell has no coordinates: it is
 * refused with what to do instead. A card takes what is drawn on it along, as
 * it does on the canvas.
 */

import type { Part } from "@/lib/ote/schema";
import { moveSetOf, overlapsOn, planTidy, unitsOf } from "@/lib/ote/tidy";
import { alignTo, distribute, matchSizes, snapPosition, type AlignMode } from "@/store/edits";
import { WorkspaceError, type Workspace } from "./workspace";
import { findObject, get, objects, screenByName, type ObjectInfo } from "./project";

type Json = Record<string, unknown>;
type Panel = { width: number; height: number };

const parentOf = (pointer: string) => pointer.slice(0, pointer.lastIndexOf("/"));

const hasBox = (node: unknown): node is Part => {
  const n = node as Json | null;
  const at = n?.Location as Json | undefined;
  return typeof n?.Width === "number" && typeof n?.Height === "number" && typeof at?.Left === "number" && typeof at?.Top === "number";
};

interface Container {
  file: string;
  doc: Json;
  /** Everything with coordinates in this container, in file order. */
  siblings: Part[];
  size: Panel;
}

function containerAt(ws: Workspace, file: string, pointer: string, panel: Panel): Container {
  const doc = ws.json<Json>(file);
  const list = get(doc, pointer);
  const siblings = (Array.isArray(list) ? list : []).filter(hasBox);
  const owner = get(doc, parentOf(pointer)) as Json | undefined;
  const size = typeof owner?.Width === "number" && typeof owner?.Height === "number" && owner.Width > 0 && owner.Height > 0
    ? { width: owner.Width, height: owner.Height }
    : panel;
  return { file, doc, siblings, size };
}

/** The named objects, and the one container they must all share. */
function pick(ws: Workspace, refs: string[], panel: Panel, screen?: string): { container: Container; parts: Part[]; infos: ObjectInfo[] } {
  const infos = refs.map((ref) => findObject(ws, ref, screen));
  for (const o of infos) {
    if (o.cell) throw new WorkspaceError(`"${o.name}" sits in grid cell row ${o.cell.row}, column ${o.cell.column}, so it has no position to arrange; set Location.Row and Location.Column with json_set`);
    if (!o.box) throw new WorkspaceError(`"${o.name}" has no size or position to arrange`);
  }
  const places = new Set(infos.map((o) => `${o.file}#${parentOf(o.pointer)}`));
  if (places.size > 1) {
    throw new WorkspaceError(`These are in different containers, so their coordinates cannot be compared: ${infos.map((o) => `"${o.name}" on ${o.screen}${o.parents.length ? ` in ${o.parents.join(" > ")}` : ""}`).join(", ")}`);
  }
  const container = containerAt(ws, infos[0].file, parentOf(infos[0].pointer), panel);
  // Keep the order the caller named them in: the first is the reference for matchSize.
  const parts = infos.map((o) => container.siblings.find((p) => p.UniqueId === o.id)).filter((p): p is Part => !!p);
  return { container, parts, infos };
}

function moveAll(container: Container, parts: Part[], to: Map<string, { left: number; top: number }>): number {
  const before = new Map(container.siblings.map((p) => [p.UniqueId, { left: p.Location.Left, top: p.Location.Top }]));
  const named = new Set(parts.map((p) => p.UniqueId));
  // Decided first and applied after, so one move does not change the next one's answer.
  const carried = parts.map((p) => moveSetOf(container.siblings, p.UniqueId, () => undefined, container.size).filter((id) => !named.has(id)));
  let moved = 0;
  parts.forEach((part, i) => {
    const target = to.get(part.UniqueId);
    if (!target) return;
    const was = before.get(part.UniqueId)!;
    const dx = Math.round(target.left) - was.left;
    const dy = Math.round(target.top) - was.top;
    if (dx === 0 && dy === 0) return;
    moved++;
    part.Location.Left += dx;
    part.Location.Top += dy;
    for (const id of carried[i]) {
      const other = container.siblings.find((s) => s.UniqueId === id);
      if (!other) continue;
      other.Location.Left += dx;
      other.Location.Top += dy;
    }
  });
  return moved;
}

const where = (p: Part) => `"${p.Name}" @${p.Location.Left},${p.Location.Top} ${p.Width}x${p.Height}`;

export function alignObjects(ws: Workspace, refs: string[], mode: AlignMode, panel: Panel, screen?: string): string {
  const { container, parts } = pick(ws, refs, panel, screen);
  const moved = moveAll(container, parts, alignTo(parts, mode, container.size));
  ws.writeJson(container.file, container.doc);
  return `aligned ${parts.length} ${mode} (${moved} moved):\n${parts.map(where).join("\n")}`;
}

export function distributeObjects(ws: Workspace, refs: string[], axis: "horizontal" | "vertical", panel: Panel, screen?: string): string {
  if (refs.length < 3) throw new WorkspaceError(`Spacing evenly needs at least three objects; ${refs.length} given`);
  const { container, parts } = pick(ws, refs, panel, screen);
  const moved = moveAll(container, parts, distribute(parts, axis));
  ws.writeJson(container.file, container.doc);
  return `spaced ${parts.length} evenly ${axis} (${moved} moved):\n${parts.map(where).join("\n")}`;
}

export function matchSize(ws: Workspace, refs: string[], dimension: "width" | "height" | "both", panel: Panel, screen?: string): string {
  if (refs.length < 2) throw new WorkspaceError(`Matching a size needs at least two objects, the first being the size to copy; ${refs.length} given`);
  const { container, parts } = pick(ws, refs, panel, screen);
  const sizes = matchSizes(parts, dimension);
  for (const part of parts) {
    const size = sizes.get(part.UniqueId);
    if (!size) continue;
    part.Width = size.width;
    part.Height = size.height;
  }
  ws.writeJson(container.file, container.doc);
  return `matched ${parts.length - 1} to the size of "${parts[0].Name}":\n${parts.map(where).join("\n")}`;
}

/** Each named object, or with none named each faceplate in the screen's main container. */
export function snapToGrid(ws: Workspace, screen: string, panel: Panel, refs: string[], grid = 4): string {
  if (!(grid >= 1)) throw new WorkspaceError(`A grid of ${grid} pixels cannot be snapped to`);
  const named = refs.length > 0 ? pick(ws, refs, panel, screen) : undefined;
  const container = named?.container ?? mainContainer(ws, screen, panel);
  const sets = named
    ? named.parts.map((p) => moveSetOf(container.siblings, p.UniqueId, () => undefined, container.size))
    : unitsOf(container.siblings, () => undefined, container.size).map((u) => u.ids);
  const seen = new Set<string>();
  let moved = 0;
  for (const ids of sets) {
    if (ids.some((id) => seen.has(id))) continue;
    for (const id of ids) seen.add(id);
    const members = container.siblings.filter((p) => ids.includes(p.UniqueId));
    if (members.length === 0) continue;
    const left = Math.min(...members.map((p) => p.Location.Left));
    const top = Math.min(...members.map((p) => p.Location.Top));
    const right = Math.max(...members.map((p) => p.Location.Left + (p.Width ?? 0)));
    const bottom = Math.max(...members.map((p) => p.Location.Top + (p.Height ?? 0)));
    const to = snapPosition({ left, top, width: right - left, height: bottom - top }, grid, container.size);
    if (to.left === left && to.top === top) continue;
    for (const p of members) {
      p.Location.Left += to.left - left;
      p.Location.Top += to.top - top;
    }
    moved++;
  }
  ws.writeJson(container.file, container.doc);
  return moved ? `snapped ${moved} to the ${grid} px grid` : `everything was already on the ${grid} px grid`;
}

/** Each container on the screen that holds positioned objects, the fullest first. */
function containers(ws: Workspace, screen: string, panel: Panel): Container[] {
  const info = screenByName(ws, screen);
  const pointers = new Set(objects(ws, info.id).filter((o) => o.box && !o.cell).map((o) => parentOf(o.pointer)));
  return [...pointers]
    .map((pointer) => containerAt(ws, info.path, pointer, panel))
    .filter((c) => c.siblings.length > 0)
    .sort((a, b) => b.siblings.length - a.siblings.length);
}

function mainContainer(ws: Workspace, screen: string, panel: Panel): Container {
  const [main] = containers(ws, screen, panel);
  if (!main) throw new WorkspaceError(`${screen} has no objects with a position; it is laid out by grid cells`);
  return main;
}

export function findOverlaps(ws: Workspace, screen: string, panel: Panel): string {
  const lines = containers(ws, screen, panel).flatMap((c) =>
    overlapsOn(c.siblings, () => undefined, c.size).map((o) =>
      `"${o.mover.name}" covers "${o.other.name}" by ${o.width}x${o.height} px${o.inside ? `, both on "${o.inside}"` : ""}`,
    ),
  );
  return lines.length ? lines.join("\n") : "no overlaps";
}

/** Move what overlaps to the nearest clear spot, saying what could not be cleared. */
export function tidyScreen(ws: Workspace, screen: string, panel: Panel): string {
  const lines: string[] = [];
  let found = 0;
  for (const c of containers(ws, screen, panel)) {
    const plan = planTidy(c.siblings, c.size);
    found += plan.found.length;
    for (const move of plan.moves) {
      for (const p of c.siblings) {
        if (!move.ids.includes(p.UniqueId)) continue;
        p.Location.Left += move.dx;
        p.Location.Top += move.dy;
      }
      lines.push(`moved "${move.name}" by ${move.dx},${move.dy}`);
    }
    if (plan.stuck.length > 0) lines.push(`no clear spot for ${plan.stuck.join(", ")}: the space is full, so remove something or use another screen`);
    if (plan.moves.length > 0) ws.writeJson(c.file, c.doc);
  }
  return found === 0 ? "no overlaps, nothing moved" : lines.join("\n");
}
