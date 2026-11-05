/** Numeric layout facts in screen design units, with stable ordering. */
import type { Part } from "@/lib/ote/schema";
import { roomReport } from "@/lib/ote/regions";
import { overlapsOn } from "@/lib/ote/tidy";
import type { Box, Edge, LayoutFacts, Scene } from "./types";

const CHROME = /^(Ground|Hdr|HdrTitle|HdrLevel|Nav|NavChip|NavLbl|NavGo|Foot|FootLbl|FootMark|AlarmBanner|AlarmsLbl)_/;
const edges = (box: Box) => ({
  x: [box.left, box.left + box.width / 2, box.left + box.width],
  y: [box.top, box.top + box.height / 2, box.top + box.height],
});
const names = { x: ["left", "centre", "right"], y: ["top", "middle", "bottom"] } as const;
export interface NearMiss { a: string; b: string; edge: Edge; by: number }

/** Same pair rule as the S5 measurement, including text and centre lines. */
export function nearMisses(parts: Part[], slop = 3): NearMiss[] {
  const list = parts.filter((part) => !CHROME.test(part.Name));
  const out: NearMiss[] = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = edges({ left: list[i].Location.Left, top: list[i].Location.Top, width: list[i].Width ?? 0, height: list[i].Height ?? 0 });
    const b = edges({ left: list[j].Location.Left, top: list[j].Location.Top, width: list[j].Width ?? 0, height: list[j].Height ?? 0 });
    for (const axis of ["x", "y"] as const) {
      const index = a[axis].findIndex((value, at) => Math.abs(value - b[axis][at]) > 0.01 && Math.abs(value - b[axis][at]) <= slop);
      if (index < 0) continue;
      out.push({ a: list[i].UniqueId, b: list[j].UniqueId, edge: names[axis][index], by: Math.abs(a[axis][index] - b[axis][index]) });
      break;
    }
  }
  return out;
}

function groups(units: LayoutFacts["units"], axis: "x" | "y", slop: number): LayoutFacts["rows"] {
  const values = units.map((unit) => ({ id: unit.id, at: axis === "x" ? unit.box.left : unit.box.top, box: unit.box }))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const out: LayoutFacts["rows"] = [];
  let cluster: typeof values = [];
  const flush = () => {
    if (cluster.length >= 2) {
      const sorted = [...cluster].sort((a, b) => axis === "x" ? a.box.top - b.box.top : a.box.left - b.box.left);
      const gaps = sorted.slice(1).map((entry, index) => axis === "x"
        ? entry.box.top - sorted[index].box.top - sorted[index].box.height
        : entry.box.left - sorted[index].box.left - sorted[index].box.width);
      out.push({ id: axis + (out.length + 1), edge: axis === "x" ? "left" : "top", at: cluster[0].at, units: cluster.map((entry) => entry.id), gaps });
    }
    cluster = [];
  };
  for (const value of values) {
    if (cluster.length && value.at - cluster[cluster.length - 1].at > slop) flush();
    cluster.push(value);
  }
  flush();
  return out;
}

export function layoutFacts(scene: Scene, parts: Part[], panel: string, scope: string[] | "screen" = "screen"): LayoutFacts {
  const allowed = scope === "screen" ? undefined : new Set(scope);
  const units = [...scene.nodes.values()].filter((node) => node.kind === "part" || node.kind === "coInstance")
    .filter((node) => !allowed || allowed.has(node.id))
    .map((node): LayoutFacts["units"][number] => ({ id: node.handle ?? node.id, kind: node.kind === "coInstance" ? "coInstance" : "part",
      type: node.type, parent: node.parent, box: node.box,
      ...(node.slot?.kind === "cell" ? { row: String(node.slot.row), column: String(node.slot.column) } : {}) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const body = parts.filter((part) => !allowed || allowed.has(part.UniqueId));
  const near = nearMisses(body).map((item) => ({ ...item, a: scene.nodes.get(item.a)?.handle ?? item.a, b: scene.nodes.get(item.b)?.handle ?? item.b }));
  const violations: LayoutFacts["violations"] = overlapsOn(body).map((item) =>
    ({ kind: "overlap", a: item.mover.ids[0], b: item.other.ids[0], w: item.width, h: item.height }));
  for (const unit of units) {
    const b = unit.box;
    if (b.left < 0 || b.top < 0 || b.left + b.width > scene.size.width || b.top + b.height > scene.size.height)
      violations.push({ kind: "outOfBounds", unit: unit.id });
    if (Math.abs(b.left / scene.grid.unit - Math.round(b.left / scene.grid.unit)) > 1e-9 ||
        Math.abs(b.top / scene.grid.unit - Math.round(b.top / scene.grid.unit)) > 1e-9)
      violations.push({ kind: "offGrid", unit: unit.id });
  }
  return { scene: { id: scene.id, size: { left: 0, top: 0, ...scene.size }, panel, grid: scene.grid,
    ...(scene.toPanel.sx !== 1 && scene.toPanel.sx === scene.toPanel.sy ? { scaleAssumption: "ViewBox letterbox scale is assumed from the renderer; OTE bench confirmation is pending." } : {}) },
    units, rows: groups(units, "y", 4), columns: groups(units, "x", 4), nearMisses: near, violations,
    room: roomReport(parts, scene.size) };
}

export function printLayoutFacts(facts: LayoutFacts): string {
  const number = (n: number) => Number(n.toFixed(3));
  const box = (b: Box) => [number(b.left), number(b.top), number(b.width) + "x" + number(b.height)].join(",");
  return [
    "screen " + facts.scene.id + " " + facts.scene.size.width + "x" + facts.scene.size.height + " SDU (panel " + facts.scene.panel + ") grid " + facts.scene.grid.unit,
    ...(facts.scene.scaleAssumption ? [facts.scene.scaleAssumption] : []),
    "units (id kind type parent box [row col]):",
    ...facts.units.map((u) => " " + [u.id, u.kind, u.type, u.parent ?? "-", box(u.box), u.row === undefined ? "" : "r" + u.row + " c" + u.column].join(" ").trimEnd()),
    ...facts.rows.map((r) => "row " + r.id + " " + r.edge + "=" + number(r.at) + " " + r.units.join(",") + " gaps " + r.gaps.map(number).join(",")),
    ...facts.columns.map((r) => "column " + r.id + " " + r.edge + "=" + number(r.at) + " " + r.units.join(",") + " gaps " + r.gaps.map(number).join(",")),
    ...facts.nearMisses.map((n) => "near-miss " + n.a + "/" + n.b + " " + n.edge + " " + number(n.by)),
    ...facts.violations.map((v) => v.kind === "overlap" ? "overlap " + v.a + "/" + v.b + " " + number(v.w) + "x" + number(v.h) : v.kind + " " + v.unit),
    "free: " + facts.room,
  ].join("\n");
}
