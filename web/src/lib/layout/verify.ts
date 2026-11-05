/** Hard checks on the plan before any store action can apply it. */
import type { Part, Screen } from "@/lib/ote/schema";
import { critiqueGeometry } from "@/lib/critic/geometry";
import { nearMisses } from "./facts";
import { layoutUnits, type SolveInput } from "./solve";
import type { Box, Constraint, Plan, Verification } from "./types";

const box = (p: Part): Box => ({ left: p.Location.Left, top: p.Location.Top, width: p.Width ?? 0, height: p.Height ?? 0 });
const inside = (a: Box, b: Box, pad = 0) => b.left >= a.left + pad && b.top >= a.top + pad &&
  b.left + b.width <= a.left + a.width - pad && b.top + b.height <= a.top + a.height - pad;
const overlap = (a: Box, b: Box) => Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left) > 2 &&
  Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top) > 2;
const near = (a: number, b: number, within = 0) => Math.abs(a - b) < within + 1e-9;
const edge = (b: Box, name: string) => name === "left" ? b.left : name === "right" ? b.left + b.width :
  name === "centre" ? b.left + b.width / 2 : name === "top" ? b.top : name === "bottom" ? b.top + b.height : b.top + b.height / 2;

export function partsAfterPlan(input: SolveInput, plan: Plan): Part[] {
  const move = new Map(plan.moves.flatMap((entry) => entry.ids.map((id) => [id, entry] as const)));
  return input.parts.map((part) => {
    const entry = move.get(part.UniqueId);
    if (!entry) return part;
    const one = entry.ids.length === 1;
    return { ...part, Location: { ...part.Location, Left: part.Location.Left + entry.to.left - entry.from.left,
      Top: part.Location.Top + entry.to.top - entry.from.top },
      ...(one ? { Width: entry.to.width, Height: entry.to.height } : {}) };
  });
}

export function verifyPlan(input: SolveInput, plan: Plan): Verification {
  if (plan.conflict) return { ok: false, checks: [{ name: "conflict", ok: false, ids: plan.conflict.constraints }] };
  const after = partsAfterPlan(input, plan);
  const beforeById = new Map(input.parts.map((p) => [p.UniqueId, p]));
  const afterById = new Map(after.map((p) => [p.UniqueId, p]));
  const moved = new Set(plan.moves.flatMap((move) => move.ids));
  const units = layoutUnits(input);
  const movedUnit = new Map(plan.moves.map((move) => [move.unit, move.to]));
  const afterBox = (id: string) => movedUnit.get(id) ?? units.find((u) => u.id === id)?.box;
  const resolve = (id: string) => units.find((u) => u.id === id || u.members.includes(id) ||
    u.members.some((member) => input.scene.nodes.get(member)?.handle === id));
  const checks: Verification["checks"] = [];
  const check = (name: string, ok: boolean, ids?: string[], before?: number, now?: number) =>
    checks.push({ name, ok, ...(ids?.length ? { ids } : {}), ...(before === undefined ? {} : { before, after: now }) });

  const residual = (c: Constraint): boolean => {
    if (c.kind === "align") {
      const chosen = c.units.map(resolve).filter((u): u is NonNullable<typeof u> => !!u);
      const e = c.edge;
      return chosen.length === c.units.length && chosen.every((u) => near(edge(afterBox(u.id)!, e), edge(afterBox(chosen[0].id)!, e), e === "centre" || e === "middle" ? 0.5 : 0));
    }
    if (c.kind === "sameSize") {
      const chosen = c.units.map(resolve).filter((u): u is NonNullable<typeof u> => !!u);
      return chosen.length === c.units.length && chosen.every((u) =>
        (c.dim === "height" || near(afterBox(u.id)!.width, afterBox(chosen[0].id)!.width)) &&
        (c.dim === "width" || near(afterBox(u.id)!.height, afterBox(chosen[0].id)!.height)));
    }
    if (c.kind === "inside") {
      const u = resolve(c.unit), container = resolve(c.container);
      return !!u && !!container && inside(afterBox(container.id)!, afterBox(u.id)!, c.pad);
    }
    if (c.kind === "distribute" || c.kind === "row" || c.kind === "column") {
      const axis = c.kind === "distribute" ? c.axis : c.kind === "row" ? "x" : "y";
      const chosen = c.units.map(resolve).filter((u): u is NonNullable<typeof u> => !!u)
        .sort((a, b) => edge(a.box, axis === "x" ? "left" : "top") - edge(b.box, axis === "x" ? "left" : "top"));
      if (chosen.length !== c.units.length || chosen.length < 2) return false;
      const gaps = chosen.slice(1).map((u, i) => edge(afterBox(u.id)!, axis === "x" ? "left" : "top") -
        edge(afterBox(chosen[i].id)!, axis === "x" ? "right" : "bottom"));
      const lined = c.kind === "distribute" || chosen.every((u) => near(edge(afterBox(u.id)!, c.kind === "row" ? "middle" : "left"), edge(afterBox(chosen[0].id)!, c.kind === "row" ? "middle" : "left"), c.kind === "row" ? 0.5 : 0));
      return lined && gaps.every((gap) => near(gap, c.gap ?? gaps[0]));
    }
    if (c.kind === "noOverlap") {
      const scope = c.scope === "screen" ? undefined : Array.isArray(c.scope)
        ? new Set(c.scope.map((name) => resolve(name)?.id).filter((id): id is string => !!id))
        : undefined;
      return !units.some((a, i) => units.slice(i + 1).some((b) =>
        (!scope || scope.has(a.id) || scope.has(b.id)) && overlap(afterBox(a.id)!, afterBox(b.id)!)));
    }
    if (c.kind === "keep") return c.units.every((name) => { const u = resolve(name); return !!u && JSON.stringify(afterBox(u.id)) === JSON.stringify(u.box); });
    if (c.kind === "snap") return plan.moves.every((move) => near(move.to.left / input.scene.grid.unit, Math.round(move.to.left / input.scene.grid.unit)) &&
      near(move.to.top / input.scene.grid.unit, Math.round(move.to.top / input.scene.grid.unit)));
    return true;
  };
  for (const c of input.constraints) check("constraint:" + c.id, residual(c), [c.id]);
  check("untouched", input.parts.every((part) => moved.has(part.UniqueId) || JSON.stringify(afterById.get(part.UniqueId)) === JSON.stringify(part)));
  check("containment", units.every((u) => !u.cellBound || inside(u.cellBound, afterBox(u.id)!)) &&
    plan.moves.every((entry) => entry.ids.every((id) => {
      const old = beforeById.get(id), now = afterById.get(id);
      return !!old && !!now && near(now.Location.Left - old.Location.Left, entry.to.left - entry.from.left) &&
        near(now.Location.Top - old.Location.Top, entry.to.top - entry.from.top);
    })));
  const pairs = (boxes: Box[]) => boxes.reduce((n, a, i) => n + boxes.slice(i + 1).filter((b) => overlap(a, b)).length, 0);
  const beforeOverlaps = pairs(units.map((u) => u.box));
  const afterOverlaps = pairs(units.map((u) => afterBox(u.id)!));
  check("overlaps", afterOverlaps <= beforeOverlaps, undefined, beforeOverlaps, afterOverlaps);
  // What it moved. A part the engineer left off the panel is theirs to leave there.
  check("bounds", plan.moves.every((move) => inside({ left: 0, top: 0, ...input.scene.size }, move.to)));
  const grid = input.scene.grid.unit;
  // An edge the engineer asked to line up outranks the grid: two right edges of
  // parts whose widths differ by 7 cannot both have a left on a 4 px grid.
  const exact = new Set(input.constraints.flatMap((c) => c.kind === "align" || c.kind === "distribute" || c.kind === "row" || c.kind === "column" || c.kind === "sameSize" ? c.units : c.kind === "inside" ? [c.unit] : [])
    .flatMap((name) => { const u = resolve(name); return u ? [u.id] : []; }));
  check("grid", plan.moves.every((move) => exact.has(move.unit) || (near(move.to.left / grid, Math.round(move.to.left / grid)) &&
    near(move.to.top / grid, Math.round(move.to.top / grid)))));
  // In the scope: lining a set up may well pass close to something nobody named.
  const inScope = (parts: Part[]) => parts.filter((part) => moved.has(part.UniqueId));
  const nearBefore = nearMisses(inScope(input.parts)).length, nearAfter = nearMisses(inScope(after)).length;
  check("nearMisses", nearAfter <= nearBefore, undefined, nearBefore, nearAfter);
  const screen = (parts: Part[]): Screen => ({ Type: "Screen", UniqueId: input.scene.id, Name: "Layout",
    Children: [{ Type: "ViewBox", UniqueId: input.scene.id, Name: "View", Width: input.scene.size.width,
      Height: input.scene.size.height, Children: parts }] } as Screen);
  const beforeScore = critiqueGeometry(screen(input.parts)).score, afterScore = critiqueGeometry(screen(after)).score;
  check("critic", afterScore >= beforeScore, undefined, beforeScore, afterScore);
  return { ok: checks.every((item) => item.ok), checks };
}
