/** A read model over the editable flat parts and the preserved container tree. */
import type { Screen, Part } from "@/lib/ote/schema";
import { rootBox } from "@/lib/ote/schema";
import { isContainer, layoutTree, type Slot } from "@/lib/ote/containers";
import type { PreservedScreen } from "@/lib/ote/reader";
import type { Look } from "@/lib/ote/co-look";
import type { Box, Grid, Scene, SceneNode, Transform } from "./types";

type Raw = Record<string, unknown>;
const boxOf = (part: Part): Box => ({ left: part.Location.Left, top: part.Location.Top, width: part.Width ?? 0, height: part.Height ?? 0 });
const num = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const kids = (raw: Raw): Raw[] => Array.isArray(raw.Children) ? raw.Children as Raw[] : [];
const union = (boxes: Box[]): Box => {
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  return { left, top, width: Math.max(...boxes.map((b) => b.left + b.width)) - left, height: Math.max(...boxes.map((b) => b.top + b.height)) - top };
};
export const transformPoint = (point: { x: number; y: number }, t: Transform) =>
  ({ x: point.x * t.sx + t.tx, y: point.y * t.sy + t.ty });
export const inverseTransform = (t: Transform): Transform =>
  ({ sx: 1 / t.sx, sy: 1 / t.sy, tx: -t.tx / t.sx, ty: -t.ty / t.sy });

/** Opened screens keep their existing lattice, including fractional content coordinates. */
export function detectGrid(parts: Part[], fallback: 1 | 2 | 4 | 8 = 4): Grid {
  if (!parts.length) return { unit: fallback, origin: { x: 0, y: 0 }, detected: false, coverage: 1 };
  const covers = (unit: number) => parts.filter((part) =>
    Math.abs(part.Location.Left / unit - Math.round(part.Location.Left / unit)) < 1e-9 &&
    Math.abs(part.Location.Top / unit - Math.round(part.Location.Top / unit)) < 1e-9).length / parts.length;
  const unit = ([8, 4, 2, 1] as const).find((candidate) => covers(candidate) >= 0.7) ?? 1;
  return { unit, origin: { x: 0, y: 0 }, detected: true, coverage: covers(unit) };
}
function coTransform(look: Look, box: Box): Transform {
  const sx = box.width / look.width, sy = box.height / look.height;
  const scale = look.uniform ? Math.min(sx, sy) : undefined;
  return { sx: scale ?? sx, sy: scale ?? sy,
    tx: box.left + (scale ? (box.width - look.width * scale) / 2 : 0) - (look.x ?? 0) * (scale ?? sx),
    ty: box.top + (scale ? (box.height - look.height * scale) / 2 : 0) - (look.y ?? 0) * (scale ?? sy) };
}
export interface SceneInput {
  screen: Screen;
  panel: { width: number; height: number };
  preserved?: PreservedScreen;
  meta?: Record<string, { locked?: boolean; groupId?: string }>;
  handles?: Record<string, string>;
  contentScreens?: Screen[];
  /** New and generated layouts use 4; opened layouts detect the engineer's unit. */
  opened?: boolean;
}
export function sceneOf(input: SceneInput): Scene {
  const { screen, panel, preserved, meta = {}, handles = {}, contentScreens = [] } = input;
  const view = screen.Children[0];
  const size = rootBox(view, panel);
  const scale = Math.min(panel.width / size.width, panel.height / size.height);
  const toPanel: Transform = view.Type === "ViewBox"
    ? { sx: scale, sy: scale, tx: (panel.width - size.width * scale) / 2, ty: (panel.height - size.height * scale) / 2 }
    : { sx: 1, sy: 1, tx: 0, ty: 0 };
  const parts = view.Children;
  const flat = new Map(parts.map((part) => [part.UniqueId, part]));
  const laid = preserved?.tree?.laid ?? layoutTree(view as Raw, { left: 0, top: 0, ...size });
  const slots = new Map(laid.leaves.map((leaf) => [leaf.uid, leaf.slot]));
  const nodes = new Map<string, SceneNode>();
  const rawRoot = (preserved?.raw.Children as Raw[] | undefined)?.[0] ?? view as Raw;
  const add = (raw: Raw, parent?: string): string | undefined => {
    const id = typeof raw.UniqueId === "string" ? raw.UniqueId : undefined;
    if (!id) return undefined;
    const container = isContainer(raw);
    const part = flat.get(id);
    if (!container && !part) return undefined;
    const childIds = container ? kids(raw).map((kid) => add(kid, id)).filter((value): value is string => !!value) : [];
    const childBoxes = childIds.map((child) => nodes.get(child)!.box);
    const box = part ? boxOf(part) : parent ? childBoxes.length ? union(childBoxes) : { left: 0, top: 0, width: 0, height: 0 }
      : { left: 0, top: 0, ...size };
    const slot: Slot | undefined = slots.get(id);
    const node: SceneNode = { id, handle: handles[id], kind: container ? "container" : part?.Type === "CompoundObject" ? "coInstance" : "part",
      type: String(raw.Type), name: String(raw.Name ?? raw.Type), box, parent, children: childIds,
      ...(slot?.kind === "cell" ? { slot: { kind: "cell" as const, row: slot.row, column: slot.column, cell: slot.box } }
        : slot?.kind === "stack" ? { slot: { kind: "stack" as const, slot: slot.box } }
        : slot ? { slot: { kind: "canvas" as const } } : {}),
      locked: !!meta[id]?.locked };
    if (part?.Type === "CompoundObject" && part.Look) {
      const look = part.Look as Look;
      node.inner = { sceneId: String(part.Definition), toHost: coTransform(look, box), uniform: look.uniform };
    }
    if (part?.Type === "ContentDisplay") {
      const content = contentScreens.find((candidate) => candidate.ContentID === part.ScreenId);
      if (content) {
        const innerSize = rootBox(content.Children[0], box);
        node.inner = { sceneId: content.UniqueId, uniform: false,
          toHost: { sx: box.width / innerSize.width, sy: box.height / innerSize.height, tx: box.left, ty: box.top } };
      }
    }
    nodes.set(id, node);
    return id;
  };
  const rootId = add(rawRoot);
  for (const part of parts) if (!nodes.has(part.UniqueId)) add(part as Raw, rootId);
  const grid = input.opened ? detectGrid(parts) : { unit: 4 as const, origin: { x: 0, y: 0 }, detected: false, coverage: 1 };
  return { id: screen.UniqueId, kind: screen.Type === "Content" ? "content" : "screen", size, toPanel, grid, nodes,
    roots: rootId ? [rootId] : [], hash: JSON.stringify({ parts, meta, size }) };
}
