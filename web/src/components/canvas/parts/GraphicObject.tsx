/**
 * One of the 475 graphic objects the product ships, drawn from the very
 * geometry the generated project will contain.
 *
 * Commands and Points are stored the way the product stores them and have to be
 * zipped into an SVG `d` - handing the raw command string to <path> would
 * silently draw nothing, which is the sort of failure that survives all the way
 * to a judge opening the file.
 *
 * Phase 2b of docs/BUILD_PLAN.md. The Library panel renders the same component
 * from the same index, so what is browsed is what is placed.
 */

import { boundsOf, toPathData, type RawPathFile } from "@/lib/ote/graphics";
import { fill, type PartOf } from "./geometry";

export interface GraphicObjectProps {
  /** Either a placed Path part or a raw entry out of the graphics index. */
  source: RawPathFile;
  x: number;
  y: number;
  width: number;
  height: number;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
}

export function GraphicObject({
  source,
  x,
  y,
  width,
  height,
  fillColor,
  strokeColor,
  strokeWidth,
}: GraphicObjectProps) {
  // A malformed symbol should be visible as a gap, not take the screen down.
  let d: string;
  let natural: { width: number; height: number };
  try {
    d = toPathData(source);
    natural = boundsOf(source);
  } catch {
    return (
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="none"
        stroke="#f04438"
        strokeWidth={1}
        strokeDasharray="4 3"
      />
    );
  }

  return (
    <svg
      x={x}
      y={y}
      width={width}
      height={height}
      viewBox={`0 0 ${natural.width || 1} ${natural.height || 1}`}
      preserveAspectRatio="xMidYMid meet"
      overflow="visible"
    >
      <path d={d} fill={fillColor} stroke={strokeColor} strokeWidth={strokeWidth} />
    </svg>
  );
}

export function PathPartNode({ part }: { part: PartOf<"Path"> }) {
  return (
    <GraphicObject
      source={part}
      x={part.Location.Left}
      y={part.Location.Top}
      width={part.Width}
      height={part.Height}
      fillColor={fill(part, "Fill", "#2b7fd4")}
      strokeColor={fill(part, "Border", "#0d3f6e")}
      strokeWidth={part.Thickness ?? 1}
    />
  );
}
