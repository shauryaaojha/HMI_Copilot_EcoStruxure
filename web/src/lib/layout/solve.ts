/** Difference constraints over unit positions; the model never supplies boxes. */
import type { Part } from "@/lib/ote/schema";
import { moveSetOf, unitsOf } from "@/lib/ote/tidy";
import type { Box, Constraint, Plan, Scene, Unit } from "./types";

export interface SolveInput {
  scene: Scene;
  parts: Part[];
  constraints: Constraint[];
  groupOf?: (id: string) => string | undefined;
}
type Axis = "x" | "y";
interface Edge { from: number; to: number; limit: number; id: string }
const value = (b: Box, axis: Axis) => axis === "x" ? b.left : b.top;
const length = (b: Box, axis: Axis) => axis === "x" ? b.width : b.height;
const setValue = (b: Box, axis: Axis, at: number) => axis === "x" ? { ...b, left: at } : { ...b, top: at };
const setLength = (b: Box, axis: Axis, size: number) => axis === "x" ? { ...b, width: size } : { ...b, height: size };
const extent = (scene: Scene, axis: Axis) => axis === "x" ? scene.size.width : scene.size.height;
const holds = (a: Box, b: Box) => b.left >= a.left && b.top >= a.top &&
  b.left + b.width <= a.left + a.width && b.top + b.height <= a.top + a.height;
const overlaps = (a: Box, b: Box) =>
  Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left) > 2 &&
  Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top) > 2;

const unionBox = (parts: Part[]): Box => {
  const left = Math.min(...parts.map((p) => p.Location.Left)), top = Math.min(...parts.map((p) => p.Location.Top));
  return { left, top, width: Math.max(...parts.map((p) => p.Location.Left + (p.Width ?? 0))) - left,
    height: Math.max(...parts.map((p) => p.Location.Top + (p.Height ?? 0))) - top };
};

/** The object a constraint names, by id, handle or name. */
const partNamed = (input: SolveInput, name: string) => input.parts.find((part) =>
  part.UniqueId === name || input.scene.nodes.get(part.UniqueId)?.handle === name || part.Name === name);

const namesOf = (c: Constraint): string[] => "units" in c ? c.units : c.kind === "inside" ? [c.unit] : c.kind === "snap" && Array.isArray(c.scope) ? c.scope : [];

/** A lamp on its card is on it, not over it. Two lamps at one spot are in each other's way. */
export const clash = (a: Unit, b: Unit, ba: Box = a.box, bb: Box = b.box) =>
  overlaps(ba, bb) && !(a.backdrop && holds(ba, bb) && !holds(bb, ba)) && !(b.backdrop && holds(bb, ba) && !holds(ba, bb));

/**
 * The same card and composite units used by tidy, with cell bounds on leaves.
 * Naming something on a card moves that thing, on the card, as moveObject does:
 * "align the start and stop buttons" must not be two names for one card.
 */
export function layoutUnits(input: SolveInput): Unit[] {
  const groupOf = input.groupOf ?? (() => undefined);
  const grouped: { ids: string[]; box: Box; within?: Box }[] = unitsOf(input.parts, groupOf, input.scene.size);
  for (const name of input.constraints.flatMap(namesOf)) {
    const part = partNamed(input, name);
    const at = part ? grouped.findIndex((group) => group.ids.includes(part.UniqueId)) : -1;
    if (at < 0) continue;
    const held = grouped[at];
    const set = moveSetOf(input.parts, part!.UniqueId, groupOf, input.scene.size).filter((id) => held.ids.includes(id));
    if (set.length === held.ids.length) continue;
    const members = (ids: string[]) => input.parts.filter((p) => ids.includes(p.UniqueId));
    const rest = held.ids.filter((id) => !set.includes(id));
    grouped.splice(at, 1, { ...held, ids: rest, box: unionBox(members(rest)) },
      { ids: set, box: unionBox(members(set)), within: held.within ?? held.box });
  }
  return grouped.map((group) => {
    const nodes = group.ids.map((id) => input.scene.nodes.get(id));
    const cell = group.ids.length === 1 && nodes[0]?.slot?.kind === "cell" ? nodes[0].slot.cell : undefined;
    const head = input.parts.find((part) => part.UniqueId === group.ids[0]);
    return { id: group.ids[0], members: group.ids, box: { ...group.box },
      kind: head?.Type === "CompoundObject" ? "coInstance" : group.ids.length > 1 ? head?.Type === "Rectangle" ? "card" : "composite" : "part",
      ...(head?.Type === "Rectangle" ? { backdrop: true } : {}),
      ...(cell ?? group.within ? { cellBound: cell ?? group.within } : {}) };
  });
}

function axisSolution(units: Unit[], boxes: Map<string, Box>, axis: Axis, scene: Scene, constraints: Constraint[],
  named: Set<string>, separated: { a: string; b: string; axis: Axis; id: string }[],
  snapped = new Map<string, number>()): { values?: number[]; conflict?: string[] } {
  const index = new Map(units.map((u, i) => [u.id, i + 1]));
  const edges: Edge[] = [];
  const add = (from: number, to: number, limit: number, id: string) => edges.push({ from, to, limit, id });
  const equalities: { a: number; b: number; offset: number; id: string }[] = [];
  const equal = (a: number, b: number, offset: number, id: string) => {
    add(a, b, offset, id); add(b, a, -offset, id);
    equalities.push({ a, b, offset, id });
  };
  const at = (u: Unit) => value(boxes.get(u.id)!, axis);
  for (const u of units) {
    const i = index.get(u.id)!;
    // x <= max and x >= min, including Grid cell containment.
    const min = u.cellBound ? value(u.cellBound, axis) : 0;
    const max = (u.cellBound ? value(u.cellBound, axis) + length(u.cellBound, axis) : extent(scene, axis)) - length(boxes.get(u.id)!, axis);
    // Bounds bind what may move. A part left off the panel stays where it is, and
    // is no conflict for the parts that were asked about.
    if (named.has(u.id) && !inputLocked(scene, u)) {
      add(0, i, max, "bounds:" + u.id);
      add(i, 0, -min, "bounds:" + u.id);
    } else equal(0, i, at(u), "keep:" + u.id);
    if (snapped.has(u.id)) equal(0, i, snapped.get(u.id)!, "snap:" + u.id);
  }
  const byId = new Map(units.map((u) => [u.id, u]));
  const ref = (name: string) => units.find((u) => u.id === name || u.members.includes(name) ||
    u.members.some((id) => scene.nodes.get(id)?.handle === name)) ?? units.find((u) => u.members.some((id) => scene.nodes.get(id)?.name === name));
  for (const c of constraints) {
    if (c.kind === "align" || c.kind === "row" || c.kind === "column") {
      const chosen = c.units.map(ref).filter((u): u is Unit => !!u);
      const edge = c.kind === "align" ? c.edge : c.kind === "row" ? "middle" : "left";
      const onAxis = axis === "x" ? ["left", "centre", "right"].includes(edge) : ["top", "middle", "bottom", "baseline"].includes(edge);
      if (!onAxis || chosen.length < 2) continue;
      // Whole pixels: a part's place is an integer in the file, so an odd width centres half a pixel out.
      const offset = (u: Unit) => edge === "centre" || edge === "middle" ? Math.floor(length(boxes.get(u.id)!, axis) / 2) :
        edge === "right" || edge === "bottom" ? length(boxes.get(u.id)!, axis) : 0;
      for (const u of chosen.slice(1)) equal(index.get(chosen[0].id)!, index.get(u.id)!, offset(chosen[0]) - offset(u), c.id);
    }
    if (c.kind === "distribute" || c.kind === "row" || c.kind === "column") {
      const onAxis = c.kind === "distribute" ? c.axis : c.kind === "row" ? "x" : "y";
      if (axis !== onAxis) continue;
      const chosen = c.units.map(ref).filter((u): u is Unit => !!u).sort((a, b) => at(a) - at(b));
      if (chosen.length < 2) continue;
      // Equal and whole: the set may end a pixel or two short of its old span.
      const gap = c.gap ?? Math.floor((at(chosen.at(-1)!) + length(boxes.get(chosen.at(-1)!.id)!, axis) - at(chosen[0]) -
        chosen.reduce((sum, u) => sum + length(boxes.get(u.id)!, axis), 0)) / (chosen.length - 1));
      for (let i = 1; i < chosen.length; i++) equal(index.get(chosen[i - 1].id)!, index.get(chosen[i].id)!,
        length(boxes.get(chosen[i - 1].id)!, axis) + gap, c.id);
    }
    if (c.kind === "inside") {
      const u = ref(c.unit), container = ref(c.container);
      if (!u || !container || u.id === container.id) continue;
      const pad = c.pad ?? 0;
      add(index.get(u.id)!, index.get(container.id)!, -pad, c.id);
      add(index.get(container.id)!, index.get(u.id)!, length(boxes.get(container.id)!, axis) - length(boxes.get(u.id)!, axis) - pad, c.id);
    }
  }
  for (const pair of separated.filter((p) => p.axis === axis)) {
    const a = byId.get(pair.a)!, b = byId.get(pair.b)!;
    add(index.get(b.id)!, index.get(a.id)!, -length(boxes.get(a.id)!, axis), pair.id);
  }
  // Bellman-Ford starts at current positions. It only changes a value when a
  // hard edge requires it, then shifts the anchored origin back to zero.
  // Weighted union-find turns every equality class into one median anchor.
  // This only chooses an initial feasible point; the graph still checks all
  // inequalities and reports a negative cycle when they cannot coexist.
  const parent = Array.from({ length: units.length + 1 }, (_, i) => i);
  const weight = parent.map(() => 0);
  const find = (i: number): [number, number] => {
    if (parent[i] === i) return [i, 0];
    const [root, offset] = find(parent[i]);
    weight[i] += offset;
    parent[i] = root;
    return [root, weight[i]];
  };
  for (const equality of equalities) {
    const [ra, oa] = find(equality.a), [rb, ob] = find(equality.b);
    if (ra === rb) {
      if (Math.abs(ob - oa - equality.offset) > 1e-9) return { conflict: [equality.id] };
    } else {
      parent[rb] = ra;
      weight[rb] = oa + equality.offset - ob;
    }
  }
  const current = [0, ...units.map(at)];
  const classes = new Map<number, number[]>();
  for (let i = 0; i < current.length; i++) {
    const [root, offset] = find(i);
    (classes.get(root) ?? classes.set(root, []).get(root)!).push(current[i] - offset);
  }
  const anchor = new Map([...classes].map(([root, values]) => {
    values.sort((a, b) => a - b);
    return [root, values[Math.floor((values.length - 1) / 2)]];
  }));
  const distances = current.map((_, i) => { const [root, offset] = find(i); return anchor.get(root)! + offset; });
  const predecessor: (Edge | undefined)[] = Array(distances.length);
  let changed = -1;
  for (let pass = 0; pass < distances.length; pass++) {
    changed = -1;
    for (const edge of edges) if (distances[edge.to] > distances[edge.from] + edge.limit + 1e-9) {
      distances[edge.to] = distances[edge.from] + edge.limit;
      predecessor[edge.to] = edge;
      changed = edge.to;
    }
    if (changed < 0) break;
  }
  if (changed >= 0) {
    const ids = new Set<string>();
    let cursor = changed;
    for (let i = 0; i < distances.length; i++) cursor = predecessor[cursor]?.from ?? cursor;
    const start = cursor;
    do { const edge = predecessor[cursor]; if (!edge) break; ids.add(edge.id); cursor = edge.from; } while (cursor !== start && ids.size < edges.length);
    return { conflict: [...ids].sort() };
  }
  return { values: distances.map((n) => n - distances[0]) };
}
const inputLocked = (scene: Scene, unit: Unit) => unit.members.some((id) => scene.nodes.get(id)?.locked);

export function solveLayout(input: SolveInput): Plan {
  const units = layoutUnits(input);
  const boxes = new Map(units.map((u) => [u.id, { ...u.box }]));
  const ref = (name: string) => units.find((u) => u.id === name || u.members.includes(name) ||
    u.members.some((id) => input.scene.nodes.get(id)?.handle === name)) ?? units.find((u) => u.members.some((id) => input.scene.nodes.get(id)?.name === name));
  const named = new Set<string>();
  const pinned = new Set<string>();
  const fallbackNamed = new Set<string>();
  const overlapConstraints = input.constraints.filter((c) => c.kind === "noOverlap");
  for (const c of input.constraints) {
    if ("units" in c) c.units.forEach((name) => { const u = ref(name); if (u) named.add(u.id); });
    if (c.kind === "inside") { const u = ref(c.unit); if (u) named.add(u.id); }
    if (c.kind === "keep") c.units.forEach((name) => { const u = ref(name); if (u) pinned.add(u.id); });
    if (c.kind === "snap" && Array.isArray(c.scope)) c.scope.forEach((name) => { const u = ref(name); if (u) named.add(u.id); });
    // A standalone "snap this screen" expressly names every unit. When it is
    // paired with noOverlap, only the displaced overlap units move instead.
    if (c.kind === "snap" && c.scope === "screen" && !input.constraints.some((other) => other.kind === "noOverlap")) units.forEach((u) => named.add(u.id));
  }
  for (const c of input.constraints.filter((c) => c.kind === "sameSize")) {
    const chosen = c.units.map(ref).filter((u): u is Unit => !!u);
    if (chosen.length < 2) continue;
    for (const axis of ["x", "y"] as const) {
      if (c.dim !== "both" && c.dim !== (axis === "x" ? "width" : "height")) continue;
      const sizes = chosen.map((u) => length(boxes.get(u.id)!, axis)).sort((a, b) => a - b);
      const target = c.to ? ref(c.to) : undefined;
      const size = target ? length(boxes.get(target.id)!, axis) : sizes[Math.floor(sizes.length / 2)];
      for (const u of chosen) boxes.set(u.id, setLength(boxes.get(u.id)!, axis, size));
    }
  }
  for (const c of overlapConstraints) {
    const scope = c.scope === "screen" ? undefined : Array.isArray(c.scope) ? new Set(c.scope.map((name) => ref(name)?.id)) : undefined;
    for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
      const a = units[i], b = units[j];
      if (!clash(a, b) || (scope && !scope.has(a.id) && !scope.has(b.id))) continue;
      // A displaced object has usually lost its row and column. Move that one
      // first; if it has no feasible slot the other overlapping unit can move.
      const alignment = (u: Unit) => {
        const lines = (box: Box, axis: Axis) => [value(box, axis), value(box, axis) + length(box, axis) / 2, value(box, axis) + length(box, axis)];
        return units.filter((other) => other.id !== u.id).reduce((score, other) => score +
          (["x", "y"] as const).filter((axis) => lines(u.box, axis).some((line, at) =>
            Math.abs(line - lines(other.box, axis)[at]) < 0.01)).length, 0);
      };
      const mover = alignment(a) < alignment(b) ? a : alignment(b) < alignment(a) ? b :
        a.box.width * a.box.height <= b.box.width * b.box.height ? a : b;
      const other = mover === a ? b : a;
      if (!pinned.has(mover.id)) named.add(mover.id);
      if (!pinned.has(other.id)) fallbackNamed.add(other.id);
    }
  }
  for (const id of pinned) named.delete(id);
  const separated: { a: string; b: string; axis: Axis; id: string }[] = [];
  for (let pass = 0; pass < 8; pass++) {
    if (overlapConstraints.length) for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
      const a = units[i], b = units[j], ba = boxes.get(a.id)!, bb = boxes.get(b.id)!;
      if (!clash(a, b, ba, bb) || separated.some((pair) => [pair.a, pair.b].includes(a.id) && [pair.a, pair.b].includes(b.id))) continue;
      if (!pinned.has(a.id) && !named.has(b.id)) named.add(a.id);
      if (!pinned.has(b.id) && !named.has(a.id)) named.add(b.id);
      const width = Math.min(ba.left + ba.width, bb.left + bb.width) - Math.max(ba.left, bb.left);
      const height = Math.min(ba.top + ba.height, bb.top + bb.height) - Math.max(ba.top, bb.top);
      const axis: Axis = width < height ? "x" : "y"; // ties use tidy's below-first order
      const mover = named.has(a.id) && !named.has(b.id) ? a : named.has(b.id) && !named.has(a.id) ? b :
        ba.width * ba.height <= bb.width * bb.height ? a : b;
      const other = mover === a ? b : a;
      if (!named.has(mover.id) && !named.has(other.id)) continue;
      const first = value(boxes.get(mover.id)!, axis) + length(boxes.get(mover.id)!, axis) / 2 <=
        value(boxes.get(other.id)!, axis) + length(boxes.get(other.id)!, axis) / 2 ? mover : other;
      separated.push({ a: first.id, b: first === mover ? other.id : mover.id, axis, id: overlapConstraints[0].id });
    }
    let conflict: string[] | undefined;
    for (const axis of ["x", "y"] as const) {
      const result = axisSolution(units, boxes, axis, input.scene, input.constraints, named, separated);
      if (result.conflict) { conflict = result.conflict; break; }
      units.forEach((u, i) => boxes.set(u.id, setValue(boxes.get(u.id)!, axis, result.values![i + 1])));
    }
    if (conflict && fallbackNamed.size) {
      for (const id of fallbackNamed) named.add(id);
      fallbackNamed.clear();
      continue;
    }
    if (conflict) return { moves: [], ops: [], conflict: { constraints: conflict, reason: "Constraints conflict: " + conflict.join(", ") } };
    if (!overlapConstraints.length || !units.some((a, i) => units.slice(i + 1).some((b) => clash(a, b, boxes.get(a.id)!, boxes.get(b.id)!)))) break;
  }
  const grid = input.scene.grid.unit;
  const snapX = new Map<string, number>(), snapY = new Map<string, number>();
  const explicitSnap = input.constraints.length === 1 && input.constraints[0].kind === "snap";
  for (const u of units) {
    if (!named.has(u.id) || (!explicitSnap && JSON.stringify(boxes.get(u.id)) === JSON.stringify(u.box))) continue;
    snapX.set(u.id, Math.round(boxes.get(u.id)!.left / grid) * grid);
    snapY.set(u.id, Math.round(boxes.get(u.id)!.top / grid) * grid);
  }
  if (snapX.size) {
    const x = axisSolution(units, boxes, "x", input.scene, input.constraints, named, separated, snapX);
    const y = axisSolution(units, boxes, "y", input.scene, input.constraints, named, separated, snapY);
    // Each axis on its own: right edges that cannot all sit on the grid still let the tops.
    if (x.values || y.values) {
      const trial = new Map(units.map((u, i) => [u.id, { ...boxes.get(u.id)!,
        ...(x.values ? { left: x.values[i + 1] } : {}), ...(y.values ? { top: y.values[i + 1] } : {}) }]));
      const count = (candidate: Map<string, Box>) => units.reduce((total, a, i) =>
        total + units.slice(i + 1).filter((b) => clash(a, b, candidate.get(a.id)!, candidate.get(b.id)!)).length, 0);
      if (count(trial) <= count(boxes)) for (const [id, box] of trial) boxes.set(id, box);
    }
  }
  const moves = units.flatMap((u) => {
    const to = boxes.get(u.id)!;
    return JSON.stringify(to) === JSON.stringify(u.box) ? [] : [{ unit: u.id, ids: u.members, from: u.box, to }];
  });
  const ops: Plan["ops"] = moves.flatMap((move) => [
    ...(move.to.left !== move.from.left || move.to.top !== move.from.top ? [{ op: "moveObject" as const, target: move.ids[0], screen: input.scene.id, dx: move.to.left - move.from.left, dy: move.to.top - move.from.top }] : []),
    ...(move.to.width !== move.from.width || move.to.height !== move.from.height ? [{ op: "resizeObject" as const, target: move.ids[0], screen: input.scene.id, width: move.to.width, height: move.to.height }] : []),
  ]);
  return { moves, ops };
}
