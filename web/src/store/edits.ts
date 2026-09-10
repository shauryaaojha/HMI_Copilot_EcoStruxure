/**
 * The pure half of editing: geometry and ordering, with no store in sight.
 *
 * Everything here takes parts and returns parts (or indices), so the canvas
 * toolbar, the keyboard shortcuts and the chat's edit operations all reach the
 * same code rather than three implementations of "align left" that disagree by
 * a pixel. Tested directly in tests/edits.test.ts.
 */

import type { Part } from "@/lib/ote/schema";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const boxOf = (part: Part): Box => ({
  left: part.Location.Left,
  top: part.Location.Top,
  width: part.Width,
  height: part.Height,
});

/** The smallest box containing all of them. Empty input has no bounds. */
export function unionOf(parts: Part[]): Box | null {
  if (parts.length === 0) return null;
  const boxes = parts.map(boxOf);
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  const right = Math.max(...boxes.map((b) => b.left + b.width));
  const bottom = Math.max(...boxes.map((b) => b.top + b.height));
  return { left, top, width: right - left, height: bottom - top };
}

export type AlignMode =
  | "left"
  | "centre"
  | "right"
  | "top"
  | "middle"
  | "bottom";

/**
 * Where each part's origin moves to line the selection up.
 *
 * Two or more objects align to their shared bounding box; a single object
 * aligns to the screen, which is what every design tool does and what an
 * engineer centring one banner expects.
 */
export function alignTo(
  parts: Part[],
  mode: AlignMode,
  screen: { width: number; height: number },
): Map<string, { left: number; top: number }> {
  const moves = new Map<string, { left: number; top: number }>();
  if (parts.length === 0) return moves;

  const frame =
    parts.length > 1
      ? unionOf(parts)!
      : { left: 0, top: 0, width: screen.width, height: screen.height };

  for (const part of parts) {
    const b = boxOf(part);
    let { left, top } = b;
    switch (mode) {
      case "left":
        left = frame.left;
        break;
      case "centre":
        left = frame.left + (frame.width - b.width) / 2;
        break;
      case "right":
        left = frame.left + frame.width - b.width;
        break;
      case "top":
        top = frame.top;
        break;
      case "middle":
        top = frame.top + (frame.height - b.height) / 2;
        break;
      case "bottom":
        top = frame.top + frame.height - b.height;
        break;
    }
    moves.set(part.UniqueId, { left: Math.round(left), top: Math.round(top) });
  }
  return moves;
}

/**
 * Even gaps between the outermost two, which stay put.
 *
 * Distributing by gap rather than by centre is the one that looks right when
 * the objects are different sizes - a row of a wide alarm banner and two narrow
 * lamps reads as evenly spaced only if the *space* is equal.
 */
export function distribute(
  parts: Part[],
  axis: "horizontal" | "vertical",
): Map<string, { left: number; top: number }> {
  const moves = new Map<string, { left: number; top: number }>();
  if (parts.length < 3) return moves;

  const horizontal = axis === "horizontal";
  const sorted = [...parts].sort((a, b) =>
    horizontal ? a.Location.Left - b.Location.Left : a.Location.Top - b.Location.Top,
  );

  const span = horizontal
    ? sorted.at(-1)!.Location.Left + sorted.at(-1)!.Width - sorted[0].Location.Left
    : sorted.at(-1)!.Location.Top + sorted.at(-1)!.Height - sorted[0].Location.Top;
  const occupied = sorted.reduce((sum, p) => sum + (horizontal ? p.Width : p.Height), 0);
  const gap = (span - occupied) / (sorted.length - 1);

  let cursor = horizontal ? sorted[0].Location.Left : sorted[0].Location.Top;
  for (const part of sorted) {
    moves.set(part.UniqueId, {
      left: horizontal ? Math.round(cursor) : part.Location.Left,
      top: horizontal ? part.Location.Top : Math.round(cursor),
    });
    cursor += (horizontal ? part.Width : part.Height) + gap;
  }
  return moves;
}

export type ZMove = "front" | "forward" | "backward" | "back";

/**
 * Reorder within the ViewBox's Children, which *is* the z-order: the packager
 * writes the array in order and the product paints it in order, so there is no
 * separate z property to set.
 *
 * Returns a new array. Moves preserve the relative order of the moved objects,
 * which is what stops a multi-select "bring to front" from shuffling them.
 */
export function restack(parts: Part[], ids: string[], move: ZMove): Part[] {
  const wanted = new Set(ids);
  const moving = parts.filter((p) => wanted.has(p.UniqueId));
  if (moving.length === 0) return parts;
  const rest = parts.filter((p) => !wanted.has(p.UniqueId));

  if (move === "front") return [...rest, ...moving];
  if (move === "back") return [...moving, ...rest];

  // One step: walk the array and swap each moved run past its neighbour.
  const next = [...parts];
  const indices = next
    .map((p, i) => (wanted.has(p.UniqueId) ? i : -1))
    .filter((i) => i !== -1);
  const order = move === "forward" ? [...indices].reverse() : indices;

  for (const i of order) {
    const to = move === "forward" ? i + 1 : i - 1;
    if (to < 0 || to >= next.length) continue;
    if (wanted.has(next[to].UniqueId)) continue; // already adjacent to a sibling
    [next[i], next[to]] = [next[to], next[i]];
  }
  return next;
}

/** Names have to stay unique inside a screen: the packager binds by name. */
export function uniqueName(taken: Set<string>, wanted: string): string {
  if (!taken.has(wanted)) return wanted;
  const stem = wanted.replace(/_(\d+)$/, "");
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${stem}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem}_${Date.now()}`;
}

/**
 * Copies with fresh ids and non-colliding names, offset so the copy is visible
 * rather than exactly on top of its original.
 */
export function clonePartsInto(
  parts: Part[],
  taken: Set<string>,
  offset: { dx: number; dy: number },
): Part[] {
  return parts.map((part) => {
    const name = uniqueName(taken, part.Name);
    taken.add(name);
    return {
      ...structuredClone(part),
      UniqueId: crypto.randomUUID(),
      Name: name,
      Location: {
        Left: part.Location.Left + offset.dx,
        Top: part.Location.Top + offset.dy,
      },
    };
  });
}

/**
 * Object edges and centres worth snapping to, from everything except the
 * objects being dragged. Figma calls these smart guides; without them a screen
 * laid out by hand never quite lines up with one laid out by the pipeline.
 */
export function snapTargets(parts: Part[], exclude: Set<string>) {
  const vertical: number[] = [];
  const horizontal: number[] = [];
  for (const part of parts) {
    if (exclude.has(part.UniqueId)) continue;
    const b = boxOf(part);
    vertical.push(b.left, b.left + b.width / 2, b.left + b.width);
    horizontal.push(b.top, b.top + b.height / 2, b.top + b.height);
  }
  return { vertical, horizontal };
}

/**
 * The nearest guide within `tolerance`, as the delta that would land on it.
 * `edges` are the moving object's own candidate lines in the same axis.
 */
export function snapDelta(
  edges: number[],
  guides: number[],
  tolerance: number,
): { delta: number; line: number } | null {
  let best: { delta: number; line: number } | null = null;
  for (const edge of edges) {
    for (const guide of guides) {
      const delta = guide - edge;
      if (Math.abs(delta) > tolerance) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, line: guide };
    }
  }
  return best;
}
