/**
 * Laying a process graph out left to right, in flow order.
 * docs/ARCHITECTURE_SCREEN_QUALITY.md §3.4.
 *
 * Sugiyama's method, the small deterministic version: each node's layer is
 * the longest path from a source, nodes in a layer are ordered by the mean
 * position of what feeds them (so pipes cross as little as a one-pass
 * barycenter allows), and the layers are spread across the area with the
 * nodes centred in their columns. Same graph, same picture, every time.
 */

export interface Edge {
  from: string;
  to: string;
}

export interface Placed {
  id: string;
  layer: number;
  row: number;
  left: number;
  top: number;
}

/** Longest path from any source, so a node sits right of everything feeding it. */
export function layerOf(nodes: string[], edges: Edge[]): Map<string, number> {
  const preds = new Map<string, string[]>();
  for (const n of nodes) preds.set(n, []);
  for (const e of edges) if (preds.has(e.to) && preds.has(e.from)) preds.get(e.to)!.push(e.from);
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const layer = (n: string): number => {
    const known = memo.get(n);
    if (known !== undefined) return known;
    if (visiting.has(n)) return 0; // a cycle: break it here rather than loop
    visiting.add(n);
    const ps = preds.get(n) ?? [];
    const value = ps.length === 0 ? 0 : 1 + Math.max(...ps.map(layer));
    visiting.delete(n);
    memo.set(n, value);
    return value;
  };
  for (const n of nodes) layer(n);
  return memo;
}

/**
 * Rows within each layer: sources keep the order they were given; every
 * later layer sorts by the mean row of its predecessors, ties by name.
 */
export function orderLayers(nodes: string[], edges: Edge[]): string[][] {
  const layers = layerOf(nodes, edges);
  const depth = Math.max(0, ...layers.values());
  const columns: string[][] = Array.from({ length: depth + 1 }, () => []);
  for (const n of nodes) columns[layers.get(n) ?? 0].push(n);
  const rowOf = new Map<string, number>();
  columns[0].forEach((n, i) => rowOf.set(n, i));
  for (let c = 1; c < columns.length; c += 1) {
    const score = (n: string) => {
      const ps = edges.filter((e) => e.to === n && rowOf.has(e.from)).map((e) => rowOf.get(e.from)!);
      return ps.length === 0 ? Number.MAX_SAFE_INTEGER / 2 : ps.reduce((a, b) => a + b, 0) / ps.length;
    };
    columns[c].sort((a, b) => score(a) - score(b) || a.localeCompare(b));
    columns[c].forEach((n, i) => rowOf.set(n, i));
  }
  return columns;
}

export interface Area {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Boxes for every node inside the area. Columns spread evenly across the
 * width; rows stack from the top with the row pitch given; everything snaps
 * to the grid. A graph too tall for the area still lays out - the caller
 * decides whether to split it - but never overlaps itself.
 */
export function placeGraph(
  nodes: string[],
  edges: Edge[],
  area: Area,
  node: { width: number; height: number },
  pitch: { column: number; row: number },
  grid = 8,
): Placed[] {
  const snap = (n: number) => Math.round(n / grid) * grid;
  const columns = orderLayers(nodes, edges);
  const count = columns.length;
  const span = Math.max(0, area.width - node.width);
  const columnLeft = (c: number) =>
    count === 1 ? area.left + snap(span / 2) : area.left + snap((span * c) / (count - 1));
  // Never closer than the pitch while the area has the room; when it does
  // not, the even spread is what fits, and the columns simply sit closer.
  const roomForPitch = (count - 1) * pitch.column <= span;
  const lefts = columns.map((_, c) => (roomForPitch ? Math.max(columnLeft(c), area.left + c * pitch.column) : columnLeft(c)));
  const out: Placed[] = [];
  columns.forEach((column, c) => {
    column.forEach((id, r) => {
      out.push({ id, layer: c, row: r, left: snap(lefts[c]), top: snap(area.top + r * pitch.row) });
    });
  });
  return out;
}
