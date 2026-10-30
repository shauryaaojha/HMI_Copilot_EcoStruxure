/**
 * Shared geometry and colour helpers for the part renderers.
 *
 * Every number in here is matched against tools/render_screen.py, which drew
 * assets/screen_design.png from the same Screen.dat. Where the two renderers
 * disagree the Python one is right, because its output is the picture in the
 * deck - so the pixel conventions it encodes (8px text padding, strokes drawn
 * inside the box, a 30px alarm header) are reproduced here deliberately rather
 * than re-derived.
 *
 * Phase 2 of docs/BUILD_PLAN.md.
 */

import type { Part } from "@/lib/ote/schema";
import { colorIndexOf, packedHex, resolveColor, resolveColorNode } from "@/lib/ote/palette";

/**
 * Resolve a {Fill|Border|TextColor} to "#rrggbb", or "none".
 *
 * A solid paint is {Color: {Value: n}}. The product also writes typed paints:
 * {Type: 0} means no fill or no border and is drawn as nothing; a gradient
 * ({Type: 5, Color1, Color2}) is drawn as its first colour, which is what the
 * product's own thumbnail does. Anything else falls back.
 */
type Colour = { Value?: number; ColorIndexEnabled?: boolean; Transparency?: number };

/** One colour as [r, g, b, alpha]: packed when ColorIndexEnabled is false, else a palette index. */
function rgbaOf(c: Colour | undefined): number[] | null {
  if (typeof c?.Value !== "number") return null;
  const hex = c.ColorIndexEnabled === false ? packedHex(c.Value) : resolveColor(c.Value, "");
  if (!hex) return null;
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1 - Math.max(0, Math.min(100, c.Transparency ?? 0)) / 100];
}

/** The mean of some colours, as #rrggbb, or #rrggbbaa when not opaque. */
function meanHex(colours: number[][]): string {
  const mean = [0, 1, 2, 3].map((k) => colours.reduce((sum, c) => sum + c[k], 0) / colours.length);
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${hex(mean[0])}${hex(mean[1])}${hex(mean[2])}${mean[3] < 1 ? hex(mean[3] * 255) : ""}`;
}

export function fill(node: unknown, key: string, fallback: string): string {
  const paint = (node as Record<string, unknown> | null)?.[key] as Record<string, unknown> | undefined;
  if (paint && !("Color" in paint) && typeof paint.Type === "number") {
    if (paint.Type === 0) return "none";
    const first = rgbaOf(paint.Color1 as Colour | undefined);
    if (first) return meanHex([first]);
    // A gradient written as stops (Type 3 radial, 4 linear): drawn flat, as
    // the mean of its stops, so a light-to-dark button reads as its middle.
    const stops = (Array.isArray(paint.ColorStops) ? paint.ColorStops : []) as { Color?: Colour }[];
    const rgba = stops.map(({ Color: c }) => rgbaOf(c)).filter((c): c is number[] => c !== null);
    if (rgba.length) return meanHex(rgba);
  }
  // resolveColorNode rather than resolveColor, because a project without a
  // palette writes the colour packed and an index lookup would miss it.
  const solid = resolveColorNode(node, key, fallback);
  // Transparency is a percentage: 85 is a faint shadow, 100 is not there.
  const clear = (paint?.Color as { Transparency?: unknown } | undefined)?.Transparency;
  if (typeof clear === "number" && clear > 0 && /^#[0-9a-f]{6}$/i.test(solid)) {
    return solid + Math.round((1 - Math.min(100, clear) / 100) * 255).toString(16).padStart(2, "0");
  }
  return solid;
}

export interface FontSpec {
  fontSize: number;
  fontWeight: number;
  fontStyle: "normal" | "italic";
}

export function fontOf(
  node: { Font?: { Size?: number; Bold?: boolean; Italic?: boolean } },
  fallback = 12,
): FontSpec {
  return {
    fontSize: node.Font?.Size ?? fallback,
    fontWeight: node.Font?.Bold ? 700 : 400,
    fontStyle: node.Font?.Italic ? "italic" : "normal",
  };
}

/** OTE alignment flags: horizontal 1 left, 2 centre, 4 right; vertical 64 middle. */
export type Align = number | undefined;

export function anchorOf(h: Align): "start" | "middle" | "end" {
  return h === 4 ? "end" : h === 2 ? "middle" : "start";
}

/** render_screen.py pads left- and right-aligned text by 8px; centred text not. */
export const TEXT_PAD = 8;

export function textX(left: number, width: number, h: Align, pad = TEXT_PAD): number {
  if (h === 4) return left + width - pad;
  if (h === 2) return left + width / 2;
  return left + pad;
}

/**
 * PIL draws a rectangle's outline *inside* the box; SVG straddles the path with
 * half the stroke either side. Insetting by half the stroke makes a 2px lamp
 * border sit where the Python renderer put it instead of bleeding 1px out.
 */
export function insetStroke(
  x: number,
  y: number,
  w: number,
  h: number,
  strokeWidth: number,
) {
  const half = strokeWidth / 2;
  return {
    x: x + half,
    y: y + half,
    width: Math.max(0, w - strokeWidth),
    height: Math.max(0, h - strokeWidth),
  };
}

/** Segoe UI's line box is a little over the em; this matches the Python spacing. */
export const LINE_HEIGHT = 1.2;

/**
 * Vertical centre of line `i` of `n`, for dominant-baseline="central".
 *
 * render_screen.py stacks the lines as one block and centres the block in the
 * box; this is the same arithmetic solved for a baseline instead of a top edge.
 */
export function lineCenterY(
  top: number,
  height: number,
  index: number,
  count: number,
  fontSize: number,
): number {
  const lh = fontSize * LINE_HEIGHT;
  return top + height / 2 + lh * (index - (count - 1) / 2);
}

/**
 * Per-part types, narrowed out of the discriminated union.
 *
 * lib/ote/schema.ts exports the zod objects as values and only `Part` as a
 * type, and it is frozen (docs/WORKSTREAMS.md), so the narrowing happens here
 * rather than by asking FORMAT to add nine type exports. Extract keeps this
 * automatically correct: a part whose schema changes changes here too.
 */
export type PartOf<T extends Part["Type"]> = Extract<Part, { Type: T }>;
