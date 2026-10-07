/**
 * Ellipse, Line, PolyLine and Polygon - the plain shapes of the product's
 * Basic tool chest, which every template in the corpus uses and which were
 * carried as hatched placeholders until they were modelled.
 *
 * Line, PolyLine and Polygon keep their points in the product's 3072-unit box
 * (`Path.Data`), stretched over the part's Width and Height - a 44x17 PSL tag
 * and a 236x139 group draw from the same numbers. So they are drawn in that
 * box with `preserveAspectRatio="none"`, and the stroke is non-scaling so a
 * Thickness of 2 stays 2 pixels whatever the stretch.
 */

import { toPathData } from "@/lib/ote/graphics";
import { fill, insetStroke, type PartOf } from "./geometry";

const UNITS = 3072;

/** The SVG path of a 3072-unit point list, or null when it cannot be drawn. */
function vector(path: { Commands?: string; Data?: string } | undefined, closed: boolean, fallback: string): string | null {
  const data = path?.Data ?? fallback;
  const n = data.split(",").filter((x) => x.trim() !== "").length / 2;
  if (n < 2) return null;
  const commands = path?.Commands ?? "M" + "L".repeat(n - 1) + (closed ? "z" : "");
  try {
    return toPathData({ Commands: commands, Points: data });
  } catch {
    return null;
  }
}

function Stretched({
  part,
  d,
  fillColor,
  strokeColor,
  strokeWidth,
}: {
  part: { Location: { Left: number; Top: number }; Width?: number; Height?: number };
  d: string;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
}) {
  // A zero-wide line is still a line: give its box a hair of width so the
  // viewport exists, and let the stroke do the drawing.
  const width = Math.max(part.Width ?? 0, 0.01);
  const height = Math.max(part.Height ?? 0, 0.01);
  return (
    <svg
      x={part.Location.Left}
      y={part.Location.Top}
      width={width}
      height={height}
      viewBox={`0 0 ${UNITS} ${UNITS}`}
      preserveAspectRatio="none"
      overflow="visible"
    >
      <path d={d} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function EllipsePart({ part }: { part: PartOf<"Ellipse"> }) {
  const stroke = part.Thickness ?? 1;
  const box = insetStroke(part.Location.Left, part.Location.Top, part.Width ?? 0, part.Height ?? 0, stroke);
  return (
    <ellipse
      cx={box.x + box.width / 2}
      cy={box.y + box.height / 2}
      rx={box.width / 2}
      ry={box.height / 2}
      fill={fill(part, "Fill", "#ffffff")}
      stroke={fill(part, "Border", "#515151")}
      strokeWidth={stroke}
    />
  );
}

export function LinePart({ part }: { part: PartOf<"Line"> | PartOf<"PolyLine"> | PartOf<"Bezier"> }) {
  // A line the product never bent runs corner to corner of its box.
  const d = vector(part.Path, false, `0,0,${UNITS},${UNITS}`);
  if (!d) return null;
  return (
    <Stretched part={part} d={d} fillColor="none" strokeColor={fill(part, "Stroke", "#000000")} strokeWidth={part.Thickness ?? 1} />
  );
}

export function PolygonPart({ part }: { part: PartOf<"Polygon"> }) {
  const d = vector(part.Path, true, `0,0,${UNITS},0,${UNITS},${UNITS},0,${UNITS}`);
  if (!d) return null;
  return (
    <Stretched
      part={part}
      d={d}
      fillColor={fill(part, "Fill", "#ffffff")}
      strokeColor={fill(part, "Border", "#515151")}
      strokeWidth={part.Thickness ?? 1}
    />
  );
}

/** A point on the box's ellipse, `deg` from three o'clock, clockwise. */
function at(cx: number, cy: number, rx: number, ry: number, deg: number) {
  const r = (deg * Math.PI) / 180;
  return [cx + rx * Math.cos(r), cy + ry * Math.sin(r)] as const;
}

/**
 * An elliptical arc from `start` to `end`. A sweep of a full turn or more is
 * two half arcs, because SVG cannot draw one arc that ends where it starts.
 */
function arcPath(cx: number, cy: number, rx: number, ry: number, start: number, end: number, move: boolean, reverse = false) {
  let a = start;
  let b = end;
  if (b < a) [a, b] = [b, a];
  const sweep = Math.min(b - a, 360);
  const [from, to] = reverse ? [a + sweep, a] : [a, a + sweep];
  const flag = reverse ? 0 : 1;
  const [x0, y0] = at(cx, cy, rx, ry, from);
  let d = move ? `M ${x0} ${y0}` : `L ${x0} ${y0}`;
  if (sweep >= 359.999) {
    const mid = (from + to) / 2;
    const [xm, ym] = at(cx, cy, rx, ry, mid);
    const [x1, y1] = at(cx, cy, rx, ry, to);
    d += ` A ${rx} ${ry} 0 0 ${flag} ${xm} ${ym} A ${rx} ${ry} 0 0 ${flag} ${x1} ${y1}`;
  } else {
    const [x1, y1] = at(cx, cy, rx, ry, to);
    d += ` A ${rx} ${ry} 0 ${sweep > 180 ? 1 : 0} ${flag} ${x1} ${y1}`;
  }
  return d;
}

type AngleShape = PartOf<"Arc"> | PartOf<"Pie"> | PartOf<"Arch"> | PartOf<"Doughnut">;

export function AngleShapePart({ part }: { part: AngleShape }) {
  const stroke = part.Thickness ?? 1;
  const box = insetStroke(part.Location.Left, part.Location.Top, part.Width ?? 0, part.Height ?? 0, stroke);
  if (box.width <= 0 || box.height <= 0) return null;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const rx = box.width / 2;
  const ry = box.height / 2;
  const start = part.Type === "Doughnut" ? 0 : part.StartAngle ?? 135;
  const end = part.Type === "Doughnut" ? 360 : part.EndAngle ?? 405;

  if (part.Type === "Arc") {
    return (
      <path d={arcPath(cx, cy, rx, ry, start, end, true)} fill="none" stroke={fill(part, "Stroke", "#000000")} strokeWidth={stroke} />
    );
  }
  let d: string;
  if (part.Type === "Pie") {
    d = `M ${cx} ${cy} ` + arcPath(cx, cy, rx, ry, start, end, false) + " Z";
  } else {
    const inner = Math.min(100, Math.max(0, part.InnerRadius ?? 70)) / 100;
    d =
      arcPath(cx, cy, rx, ry, start, end, true) +
      " " +
      arcPath(cx, cy, rx * inner, ry * inner, start, end, Math.abs(end - start) >= 360, true) +
      " Z";
  }
  return (
    <path d={d} fillRule="evenodd" fill={fill(part, "Fill", "#ffffff")} stroke={fill(part, "Border", "#515151")} strokeWidth={stroke} />
  );
}
