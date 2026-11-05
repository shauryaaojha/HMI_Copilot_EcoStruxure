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

import { boundsOf, pathInBox, type PathGeometry } from "@/lib/ote/graphics";
import { pathGeometry } from "@/lib/ote/schema";
import { fill, type PartOf } from "./geometry";

export interface GraphicObjectProps {
  /** Either a placed Path part or a raw entry out of the graphics index. */
  source: PathGeometry;
  /** Stretch to the box, as the product does with its own Path parts' 3072-unit geometry. */
  stretch?: boolean;
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
  stretch,
}: GraphicObjectProps) {
  // A malformed symbol should be visible as a gap, not take the screen down.
  let d: string;
  let natural: { width: number; height: number };
  try {
    natural = boundsOf(source);
    const extent = stretch ? { width: 3072, height: 3072 } : natural;
    const scale = stretch ? 1 : Math.min(width / Math.max(1, extent.width), height / Math.max(1, extent.height));
    const drawn = stretch ? { x, y, width, height } : {
      x: x + (width - extent.width * scale) / 2,
      y: y + (height - extent.height * scale) / 2,
      width: extent.width * scale,
      height: extent.height * scale,
    };
    d = pathInBox(source, drawn, extent);
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

  return <path d={d} fill={fillColor} fillRule="evenodd" stroke={strokeColor} strokeWidth={strokeWidth} />;
}

export function PathPartNode({ part }: { part: PartOf<"Path"> }) {
  const geometry = pathGeometry(part);
  if (!geometry) return null;
  return (
    <GraphicObject
      source={geometry}
      stretch={part.Commands === undefined}
      x={part.Location.Left}
      y={part.Location.Top}
      width={(part.Width ?? 0)}
      height={(part.Height ?? 0)}
      fillColor={fill(part, "Fill", "#2b7fd4")}
      strokeColor={fill(part, "Border", "#0d3f6e")}
      strokeWidth={part.Thickness ?? 1}
    />
  );
}
