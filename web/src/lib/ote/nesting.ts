/**
 * The screen as a nested layout: page, cards, and what sits on each card,
 * with the free areas inside every card.
 *
 * A screen is a flat list of parts, and a model reading it flat sees a card
 * as one more object in the way: a body laid out as two big cards read as
 * full, though most of each card was empty, and nothing said which buttons
 * were on which card. Here a Rectangle that holds smaller parts is a
 * container; each part belongs to the smallest container that holds it whole;
 * and each container reports the empty rectangles inside it, in pixels, so a
 * new object is put on the card it belongs to, in space that is really free.
 *
 * Also what is wrong with the nesting: a part that crosses the edge of a card
 * (half on, half off), and two parts on the same card covering each other.
 */

import type { Part } from "./schema";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LayoutNode {
  part: Part;
  box: Box;
  children: LayoutNode[];
}

const boxOf = (p: Part): Box => ({ left: p.Location.Left, top: p.Location.Top, width: p.Width ?? 0, height: p.Height ?? 0 });
const area = (b: Box) => Math.max(0, b.width) * Math.max(0, b.height);
/** Holds whole, with a pixel of slack for rounding. */
const holds = (outer: Box, inner: Box) =>
  inner.left >= outer.left - 1 && inner.top >= outer.top - 1 && inner.left + inner.width <= outer.left + outer.width + 1 && inner.top + inner.height <= outer.top + outer.height + 1;
const meets = (a: Box, b: Box) => a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
const shared = (a: Box, b: Box) => {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 2 && h > 2 ? { w, h } : null;
};

/** A rectangle that holds a smaller part is something to put things on, not something in the way. */
function isContainer(p: Part, parts: Part[]): boolean {
  if (p.Type !== "Rectangle") return false;
  const b = boxOf(p);
  return parts.some((q) => q !== p && area(boxOf(q)) < area(b) && holds(b, boxOf(q)));
}

/** The parts as a tree: each under the smallest container holding it whole. */
export function nest(parts: Part[]): LayoutNode[] {
  const containers = parts.filter((p) => isContainer(p, parts));
  const nodes = new Map<Part, LayoutNode>(parts.map((p) => [p, { part: p, box: boxOf(p), children: [] }]));
  const roots: LayoutNode[] = [];
  for (const p of parts) {
    const b = boxOf(p);
    let parent: Part | undefined;
    for (const c of containers) {
      if (c === p) continue;
      const cb = boxOf(c);
      if (area(cb) <= area(b) || !holds(cb, b)) continue;
      if (!parent || area(cb) < area(boxOf(parent))) parent = c;
    }
    (parent ? nodes.get(parent)!.children : roots).push(nodes.get(p)!);
  }
  return roots;
}

/**
 * The largest empty rectangles inside a box, clear of `taken` by `gap`,
 * biggest first: on an 8 px grid, the largest empty rectangle is found
 * (histogram method), marked, and the next looked for.
 */
export function freeAreas(inner: Box, taken: Box[], options: { gap?: number; min?: { width: number; height: number }; max?: number } = {}): Box[] {
  const G = 8;
  const gap = options.gap ?? 8;
  const min = options.min ?? { width: 64, height: 32 };
  const cols = Math.floor(inner.width / G);
  const rows = Math.floor(inner.height / G);
  if (cols <= 0 || rows <= 0) return [];
  const used: boolean[][] = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  for (const t of taken) {
    const x0 = Math.max(0, Math.floor((t.left - gap - inner.left) / G));
    const x1 = Math.min(cols - 1, Math.ceil((t.left + t.width + gap - inner.left) / G) - 1);
    const y0 = Math.max(0, Math.floor((t.top - gap - inner.top) / G));
    const y1 = Math.min(rows - 1, Math.ceil((t.top + t.height + gap - inner.top) / G) - 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) used[y][x] = true;
  }
  const out: Box[] = [];
  for (let n = 0; n < (options.max ?? 3); n++) {
    const heights = new Array<number>(cols).fill(0);
    let best = { area: 0, x: 0, y: 0, w: 0, h: 0 };
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) heights[x] = used[y][x] ? 0 : heights[x] + 1;
      const stack: number[] = [];
      for (let x = 0; x <= cols; x++) {
        const h = x === cols ? 0 : heights[x];
        while (stack.length && heights[stack[stack.length - 1]] >= h) {
          const top = stack.pop()!;
          const height = heights[top];
          const left = stack.length ? stack[stack.length - 1] + 1 : 0;
          const width = x - left;
          if (width * G >= min.width && height * G >= min.height && width * height > best.area) best = { area: width * height, x: left, y: y - height + 1, w: width, h: height };
        }
        stack.push(x);
      }
    }
    if (best.area === 0) break;
    out.push({ left: inner.left + best.x * G, top: inner.top + best.y * G, width: best.w * G, height: best.h * G });
    for (let y = best.y; y < best.y + best.h; y++) for (let x = best.x; x < best.x + best.w; x++) used[y][x] = true;
  }
  return out;
}

/** What is wrong with the nesting: parts across a card's edge, and parts on one card covering each other. */
export function nestingProblems(parts: Part[], label: (p: Part) => string = (p) => p.Name): string[] {
  const out: string[] = [];
  const containers = parts.filter((p) => isContainer(p, parts));
  for (const p of parts) {
    const b = boxOf(p);
    for (const c of containers) {
      if (c === p) continue;
      const cb = boxOf(c);
      if (area(cb) <= area(b) || holds(cb, b) || holds(b, cb) || !shared(cb, b)) continue;
      out.push(`${label(p)} crosses the edge of ${label(c)}: put it wholly inside the card or wholly outside it`);
    }
  }
  const walk = (list: LayoutNode[]) => {
    const solid = list.filter((n) => n.children.length === 0 && n.part.Type !== "Rectangle");
    for (let i = 0; i < solid.length; i++) {
      for (let j = i + 1; j < solid.length; j++) {
        const s = shared(solid[i].box, solid[j].box);
        if (s && !holds(solid[i].box, solid[j].box) && !holds(solid[j].box, solid[i].box)) out.push(`${label(solid[i].part)} overlaps ${label(solid[j].part)} by ${s.w}x${s.h} px`);
      }
    }
    for (const n of list) walk(n.children);
  };
  walk(nest(parts));
  return out;
}

const at = (b: Box) => `${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)}`;

/**
 * The tree as the model reads it: one line a part, indented under its card,
 * with each card's free areas. Pads keep a new object off the card's edge.
 */
export function layoutTree(parts: Part[], label: (p: Part) => string = (p) => p.Name, pad = 16, panel?: { width: number; height: number }): string {
  const lines: string[] = [];
  // The screen's own free space, outside every card: where a new card goes.
  // Left out when one card is the whole page: then its line says it.
  const roots = nest(parts);
  if (panel && !roots.some((n) => n.box.width >= panel.width - 2 && n.box.height >= panel.height - 2)) {
    const free = freeAreas({ left: pad, top: pad, width: panel.width - 2 * pad, height: panel.height - 2 * pad }, roots.map((n) => n.box));
    lines.push(`Screen ${panel.width}x${panel.height}, free outside every card: ${free.length ? free.map(at).join("; ") : "none"}`);
  }
  const draw = (list: LayoutNode[], depth: number) => {
    for (const n of [...list].sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left)) {
      const indent = "  ".repeat(depth);
      if (n.children.length) {
        const inner = { left: n.box.left + pad, top: n.box.top + pad, width: n.box.width - 2 * pad, height: n.box.height - 2 * pad };
        const free = freeAreas(inner, n.children.map((c) => c.box));
        lines.push(`${indent}- ${label(n.part)} [card ${at(n.box)}] free inside: ${free.length ? free.map(at).join("; ") : "none"}`);
        draw(n.children, depth + 1);
      } else {
        lines.push(`${indent}- ${label(n.part)} [${n.part.Type} ${at(n.box)}]`);
      }
    }
  };
  draw(roots, 0);
  return lines.join("\n");
}
