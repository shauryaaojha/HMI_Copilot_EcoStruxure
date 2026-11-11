/**
 * Shapes, as Path geometry.
 *
 * The only vector part a generated project has had opened in the product is
 * Path (lib/components/bench.ts), and the only animations are a Lamp's two
 * faces and a Rectangle's fill level. So a round lamp, a ring gauge and a tank
 * with a domed head are each built from those:
 *
 *   - `shapePart` draws a shape: a pump casing, a ring's track, a tick.
 *   - `maskPart` draws a plate with a shape cut out of it. Over a Lamp, the
 *     lamp shows through as a circle or a diamond; over a filling Rectangle,
 *     the level rises inside a tank or around a ring.
 *
 * Every shape is written in the unit square and uses the four commands the
 * product's own library uses: M, L, C and z. A hole is wound the other way
 * from its outline, so it is a hole under either fill rule.
 */

import type { Part } from "./schema";
import { gid, type Box } from "./parts";

export interface Shape {
  Commands: string;
  /** Unit-square coordinates, x then y. */
  points: number[];
  /** Width over height the shape is drawn at. */
  aspect: number;
}

/** Collects one outline. */
class Pen {
  commands = "";
  points: number[] = [];
  move(x: number, y: number) { this.commands += "M"; this.points.push(x, y); return this; }
  line(x: number, y: number) { this.commands += "L"; this.points.push(x, y); return this; }
  curve(x1: number, y1: number, x2: number, y2: number, x: number, y: number) { this.commands += "C"; this.points.push(x1, y1, x2, y2, x, y); return this; }
  close() { this.commands += "z"; return this; }
  /**
   * An arc of an ellipse from `from` to `to` degrees (0 is east, 90 is south), as cubic curves.
   * Cut at every quarter turn, so no control point lies outside the arc's own extent: the
   * product stretches a path's points over its box, and the two must agree on where the edge is.
   */
  arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number) {
    const way = Math.sign(to - from) || 1;
    const stops = [from];
    for (let q = way > 0 ? Math.floor(from / 90) * 90 + 90 : Math.ceil(from / 90) * 90 - 90; way > 0 ? q < to : q > to; q += way * 90) stops.push(q);
    stops.push(to);
    for (let i = 0; i + 1 < stops.length; i++) {
      const a = (stops[i] * Math.PI) / 180, b = (stops[i + 1] * Math.PI) / 180;
      if (Math.abs(b - a) < 1e-9) continue;
      const k = (4 / 3) * Math.tan((b - a) / 4);
      this.curve(
        cx + rx * (Math.cos(a) - k * Math.sin(a)), cy + ry * (Math.sin(a) + k * Math.cos(a)),
        cx + rx * (Math.cos(b) + k * Math.sin(b)), cy + ry * (Math.sin(b) - k * Math.cos(b)),
        cx + rx * Math.cos(b), cy + ry * Math.sin(b),
      );
    }
    return this;
  }
  /** A whole ellipse, clockwise on screen unless `hole`. */
  ellipse(cx: number, cy: number, rx: number, ry: number, hole = false) {
    this.move(cx + rx, cy);
    return this.arc(cx, cy, rx, ry, 0, hole ? -360 : 360).close();
  }
  polygon(points: readonly (readonly [number, number])[]) {
    points.forEach(([x, y], i) => (i === 0 ? this.move(x, y) : this.line(x, y)));
    return this.close();
  }
  /** The aspect is the outline's own extent unless one is given. */
  shape(aspect?: number): Shape {
    const xs = this.points.filter((_, i) => i % 2 === 0), ys = this.points.filter((_, i) => i % 2 === 1);
    const own = (Math.max(...xs) - Math.min(...xs)) / Math.max(1e-9, Math.max(...ys) - Math.min(...ys));
    return { Commands: this.commands, points: this.points, aspect: aspect ?? own };
  }
}

const at = (cx: number, cy: number, r: number, degrees: number): [number, number] =>
  [cx + r * Math.cos((degrees * Math.PI) / 180), cy + r * Math.sin((degrees * Math.PI) / 180)];

export const circle = (): Shape => new Pen().ellipse(0.5, 0.5, 0.5, 0.5).shape();
/** `inner` is the hole's share of the radius. */
export const ring = (inner = 0.7): Shape => new Pen().ellipse(0.5, 0.5, 0.5, 0.5).ellipse(0.5, 0.5, 0.5 * inner, 0.5 * inner, true).shape();
export const diamond = (): Shape => new Pen().polygon([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]).shape();
export const triangle = (direction: "up" | "down" | "right" = "up"): Shape =>
  new Pen().polygon(direction === "up" ? [[0.5, 0], [1, 1], [0, 1]] : direction === "down" ? [[0, 0], [1, 0], [0.5, 1]] : [[0, 0], [1, 0.5], [0, 1]]).shape();
export const hexagon = (): Shape => new Pen().polygon([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]).shape(1.15);
export const octagon = (): Shape => new Pen().polygon([[0.3, 0], [0.7, 0], [1, 0.3], [1, 0.7], [0.7, 1], [0.3, 1], [0, 0.7], [0, 0.3]]).shape();

/** A band of a ring between two angles: a gauge's track, or the normal range marked on it. */
export function arcBand(from: number, to: number, inner = 0.7): Shape {
  const pen = new Pen().move(...at(0.5, 0.5, 0.5, from)).arc(0.5, 0.5, 0.5, 0.5, from, to);
  pen.line(...at(0.5, 0.5, 0.5 * inner, to)).arc(0.5, 0.5, 0.5 * inner, 0.5 * inner, to, from).close();
  return pen.shape();
}

/** A lozenge: a status pill lying down, a vessel standing up. */
export function capsule(aspect: number): Shape {
  const pen = new Pen();
  if (aspect >= 1) {
    const r = 0.5 / aspect;
    pen.move(r, 0).line(1 - r, 0).arc(1 - r, 0.5, r, 0.5, -90, 90).line(r, 1).arc(r, 0.5, r, 0.5, 90, 270).close();
  } else {
    const r = 0.5 * aspect;
    pen.move(0, r).arc(0.5, r, 0.5, r, 180, 360).line(1, 1 - r).arc(0.5, 1 - r, 0.5, r, 0, 180).close();
  }
  return pen.shape(aspect);
}

/* --- equipment, as the P&ID draws it ---------------------------------- */

/** A centrifugal pump: the casing and its discharge leaving the top. */
export function pumpCasing(): Shape {
  const r = 0.44, cx = 0.44, cy = 0.56, lip = 0.3;
  const angle = (Math.asin((lip - cy) / r) * 180) / Math.PI; // where the discharge's underside meets the casing
  return new Pen().move(cx, cy - r).line(1, cy - r).line(1, lip).line(...at(cx, cy, r, angle)).arc(cx, cy, r, r, angle, 270).close().shape();
}
/** The impeller's direction, drawn inside the casing. */
export const pumpArrow = (): Shape => new Pen().polygon([[0.26, 0.34], [0.7, 0.56], [0.26, 0.78]]).shape();

/** A valve: two triangles meeting at the seat, and the actuator over it. */
export function valveBody(): Shape {
  return new Pen()
    .polygon([[0, 0.42], [0.5, 0.71], [1, 0.42], [1, 1], [0.5, 0.71], [0, 1]])
    .move(0.3, 0.3).arc(0.5, 0.3, 0.2, 0.3, 180, 360).close()
    .shape(1.2);
}

/** A motor: the round frame on its feet. */
export function motorFrame(): Shape {
  const r = 0.44, cx = 0.5, cy = 0.44;
  return new Pen().move(...at(cx, cy, r, 125)).arc(cx, cy, r, r, 125, 415).line(0.86, 1).line(0.14, 1).close().shape();
}

/** A vessel: straight sides, a domed head, and a domed, coned or flat foot. */
export function vessel(aspect: number, foot: "dome" | "cone" | "flat" = "dome"): Shape {
  const head = Math.min(0.2, 0.5 * aspect * 0.6);
  const pen = new Pen().move(0, head).arc(0.5, head, 0.5, head, 180, 360);
  if (foot === "dome") pen.line(1, 1 - head).arc(0.5, 1 - head, 0.5, head, 0, 180);
  else if (foot === "cone") pen.line(1, 0.72).line(0.58, 1).line(0.42, 1).line(0, 0.72);
  else pen.line(1, 1).line(0, 1);
  return pen.close().shape(aspect);
}

/** A tank lying on its side. */
export const drum = (aspect: number): Shape => capsule(Math.max(1.2, aspect));

/* --- placing a shape --------------------------------------------------- */

const UNITS = 3072;
const paint = (index: number | undefined) => (index === undefined ? { Type: 0 as const } : { Color: { Value: index } });

/** The largest box of the shape's aspect inside `box`, centred, on the 4 px grid. */
export function fit(shape: Shape, box: Box): Box {
  const grid = (n: number) => Math.max(4, Math.floor(n / 4) * 4);
  const width = grid(Math.min(box.width, box.height * shape.aspect));
  const height = grid(Math.min(box.height, box.width / shape.aspect));
  return {
    left: box.left + Math.round((box.width - width) / 8) * 4,
    top: box.top + Math.round((box.height - height) / 8) * 4,
    width, height,
  };
}

/** The points stretched over the box the product stretches them over: their own extent, as 0..3072. */
function data(points: number[]): string {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    minX = Math.min(minX, points[i]); maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]); maxY = Math.max(maxY, points[i + 1]);
  }
  const spanX = Math.max(1e-9, maxX - minX), spanY = Math.max(1e-9, maxY - minY);
  return points.map((n, i) => Math.round(((n - (i % 2 === 0 ? minX : minY)) * UNITS) / (i % 2 === 0 ? spanX : spanY))).join(",");
}

export interface ShapePaint { fill?: number; border?: number; thickness?: number }

/** The shape, at its own aspect, inside the box. No `fill` is an outline; no `border` is a silhouette. */
export function shapePart(name: string, shape: Shape, box: Box, opts: ShapePaint = {}): Part {
  const drawn = fit(shape, box);
  return {
    Type: "Path", UniqueId: gid(), Name: name,
    Path: { Commands: shape.Commands, Data: data(shape.points) },
    Fill: paint(opts.fill), Border: paint(opts.border), Thickness: opts.border === undefined ? 0 : opts.thickness ?? 1,
    Location: { Left: drawn.left, Top: drawn.top }, Width: drawn.width, Height: drawn.height,
  } as Part;
}

/**
 * A plate the size of the box with the shape cut out of it, `inset` px in from
 * the plate's edge. Whatever is under it shows through the cut.
 */
export function maskPart(name: string, shape: Shape, box: Box, opts: ShapePaint & { inset?: number } = {}): Part {
  const inset = opts.inset ?? 4;
  const hole = fit(shape, { left: box.left + inset, top: box.top + inset, width: box.width - inset * 2, height: box.height - inset * 2 });
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < shape.points.length; i += 2) {
    minX = Math.min(minX, shape.points[i]); maxX = Math.max(maxX, shape.points[i]);
    minY = Math.min(minY, shape.points[i + 1]); maxY = Math.max(maxY, shape.points[i + 1]);
  }
  const x = (n: number) => (hole.left - box.left + ((n - minX) / Math.max(1e-9, maxX - minX)) * hole.width) / box.width;
  const y = (n: number) => (hole.top - box.top + ((n - minY) / Math.max(1e-9, maxY - minY)) * hole.height) / box.height;
  // The plate runs anticlockwise; every shape here runs clockwise.
  const points = [0, 0, 0, 1, 1, 1, 1, 0, ...shape.points.map((n, i) => (i % 2 === 0 ? x(n) : y(n)))];
  return {
    Type: "Path", UniqueId: gid(), Name: name,
    Path: { Commands: `MLLLz${shape.Commands}`, Data: data(points) },
    Fill: paint(opts.fill), Border: paint(opts.border), Thickness: opts.border === undefined ? 0 : opts.thickness ?? 1,
    Location: { Left: box.left, Top: box.top }, Width: box.width, Height: box.height,
  } as Part;
}
