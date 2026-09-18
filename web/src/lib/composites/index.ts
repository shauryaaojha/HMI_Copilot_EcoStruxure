/**
 * Composites: our own parametric objects above the product's parts.
 *
 * docs/ARCHITECTURE_SCREEN_QUALITY.md §3.3. A real screen shows an analogue
 * indicator, not six rectangles; a KPI tile, not a number in a box; a pump
 * with its state, not a picture beside two lamps. The product's file has no
 * object for any of these, so a composite is a definition here (props, a
 * default size, and how it expands into parts on the Standard pack) plus an
 * instance record in the store (which parts are its, and the props they were
 * expanded from). The inspector edits the props and the store re-expands;
 * the packager sees only parts, which is what the product opens.
 *
 * Every part a composite expands to is one the canvas draws and the packager
 * writes, so nothing here can produce a screen the product would refuse.
 */

import { z } from "zod";
import type { Part } from "@/lib/ote/schema";
import {
  alarmLamp,
  barScale,
  lamp,
  numericDisplay,
  pathPart,
  rectangle,
  textBox,
  trendGraph,
  type Box,
} from "@/lib/ote/parts";
import { DEFAULT_PACK } from "@/lib/standard/pack";

const T = DEFAULT_PACK.tokens;

export const COMPOSITE_KINDS = ["AnalogIndicator", "KpiTile", "EquipmentSymbol"] as const;
export type CompositeKind = (typeof COMPOSITE_KINDS)[number];

export const isCompositeKind = (kind: string): kind is CompositeKind =>
  (COMPOSITE_KINDS as readonly string[]).includes(kind);

/** What an expansion produced: the parts in paint order, and which are bound. */
export interface Expanded {
  parts: Part[];
  /** Index into `parts`, the tag, and the property it drives. */
  wires: { index: number; tag: string; property: string }[];
}

export interface CompositeDef<P extends Record<string, unknown>> {
  kind: CompositeKind;
  label: string;
  hint: string;
  /** The key that arms it on the canvas. */
  key: string;
  props: z.ZodObject<z.ZodRawShape>;
  defaults: P;
  size: { width: number; height: number };
  expand: (props: P, box: Box, name: string) => Expanded;
}

const GRID = 8;
const snap = (n: number) => Math.round(n / GRID) * GRID;

/* ---------------------------------------------------------------------- */
/* AnalogIndicator                                                         */
/* ---------------------------------------------------------------------- */

export const AnalogIndicatorProps = z.object({
  label: z.string(),
  tag: z.string().optional(),
  units: z.string(),
  min: z.number(),
  max: z.number(),
  /** The band the operator expects the value to sit in. */
  normalLow: z.number(),
  normalHigh: z.number(),
  decimals: z.number().int().min(0).max(6),
});
export type AnalogIndicatorProps = z.infer<typeof AnalogIndicatorProps>;

/**
 * A scale with the normal band beside it, the live value under it, and the
 * unit. The level itself is not drawn live: the product's bar part has not
 * been captured yet (reference/part_examples.json has BarScale, not the bar),
 * so an indicator today is a scale, a band and a number - which is already
 * what the handbook asks for first. When the bar part is captured it goes
 * between the scale and the band and nothing else here changes.
 */
export const AnalogIndicator: CompositeDef<AnalogIndicatorProps> = {
  kind: "AnalogIndicator",
  label: "Analogue indicator",
  hint: "Scale, normal band, live value and unit",
  key: "i",
  props: AnalogIndicatorProps,
  defaults: { label: "Level", units: "%", min: 0, max: 100, normalLow: 20, normalHigh: 80, decimals: 1 },
  size: { width: 144, height: 184 },
  expand(p, box, name) {
    const parts: Part[] = [];
    const wires: Expanded["wires"] = [];
    const { left: x, top: y, width: w, height: h } = box;
    const vertical = h >= w;
    const span = Math.max(1e-9, p.max - p.min);
    const frac = (v: number) => Math.min(1, Math.max(0, (v - p.min) / span));

    parts.push(rectangle(`${name}`, box, { fill: T.panel, border: T.line }));
    // The label takes the row when the scale runs down; beside a horizontal
    // scale it shares the top row with the value and stops short of it.
    const valueWidth = vertical ? 0 : 80;
    const unitWidth = vertical ? 0 : 40;
    parts.push(
      textBox(`${name}_Lbl`, p.label, { left: x + 8, top: y + 4, width: Math.max(GRID, w - 16 - (vertical ? 0 : valueWidth + unitWidth + 8)), height: 20 }, { size: 12, bold: true, colour: T.ink }),
    );

    if (vertical) {
      const scaleTop = y + 28;
      const scaleH = Math.max(GRID, h - 28 - 40);
      parts.push(barScale(`${name}_Scale`, { left: x + 8, top: scaleTop, width: 40, height: scaleH }, p.max));
      const bandTop = scaleTop + (1 - frac(p.normalHigh)) * scaleH;
      const bandBottom = scaleTop + (1 - frac(p.normalLow)) * scaleH;
      parts.push(
        rectangle(`${name}_Band`, { left: x + 56, top: Math.round(bandTop), width: 16, height: Math.max(2, Math.round(bandBottom - bandTop)) }, { fill: T.ground, border: T.line }),
      );
      parts.push(numericDisplay(`${name}_Val`, { left: x + 8, top: y + h - 36, width: w - 16 - 40, height: 28 }, p.decimals));
      parts.push(textBox(`${name}_Unit`, p.units, { left: x + w - 44, top: y + h - 34, width: 36, height: 24 }, { size: 12, colour: T.muted }));
    } else {
      const scaleLeft = x + 8;
      const scaleW = Math.max(GRID, w - 16);
      parts.push(barScale(`${name}_Scale`, { left: scaleLeft, top: y + h - 32, width: scaleW, height: 24 }, p.max));
      const bandLeft = scaleLeft + frac(p.normalLow) * scaleW;
      const bandRight = scaleLeft + frac(p.normalHigh) * scaleW;
      parts.push(
        rectangle(`${name}_Band`, { left: Math.round(bandLeft), top: y + h - 44, width: Math.max(2, Math.round(bandRight - bandLeft)), height: 10 }, { fill: T.ground, border: T.line }),
      );
      parts.push(numericDisplay(`${name}_Val`, { left: x + w - 8 - valueWidth - unitWidth, top: y + 4, width: valueWidth, height: 24 }, p.decimals));
      parts.push(textBox(`${name}_Unit`, p.units, { left: x + w - 8 - unitWidth + 4, top: y + 6, width: unitWidth - 4, height: 20 }, { size: 12, colour: T.muted }));
    }

    if (p.tag) wires.push({ index: parts.findIndex((q) => q.Name === `${name}_Val`), tag: p.tag, property: "CurrentValue" });
    return { parts, wires };
  },
};

/* ---------------------------------------------------------------------- */
/* KpiTile                                                                 */
/* ---------------------------------------------------------------------- */

export const KpiTileProps = z.object({
  label: z.string(),
  tag: z.string().optional(),
  units: z.string(),
  decimals: z.number().int().min(0).max(6),
  /** A small trend of the same tag under the number; off for a discrete value. */
  trend: z.boolean(),
});
export type KpiTileProps = z.infer<typeof KpiTileProps>;

/** A level 1 tile: the number large, its unit, and where it has been. */
export const KpiTile: CompositeDef<KpiTileProps> = {
  kind: "KpiTile",
  label: "KPI tile",
  hint: "A large value with its unit and a small trend",
  key: "q",
  props: KpiTileProps,
  defaults: { label: "Flow", units: "m3/h", decimals: 1, trend: true },
  size: { width: 208, height: 120 },
  expand(p, box, name) {
    const parts: Part[] = [];
    const wires: Expanded["wires"] = [];
    const { left: x, top: y, width: w, height: h } = box;
    parts.push(rectangle(`${name}`, box, { fill: T.panel, border: T.line }));
    parts.push(textBox(`${name}_Lbl`, p.label, { left: x + 8, top: y + 4, width: w - 16, height: 20 }, { size: 12, bold: true, colour: T.ink }));
    const value = numericDisplay(`${name}_Val`, { left: x + 8, top: y + 28, width: Math.max(64, w - 16 - 48), height: 36 }, p.decimals);
    if (value.Type === "NumericDisplay") value.Font = { ...value.Font!, Size: 24 };
    parts.push(value);
    parts.push(textBox(`${name}_Unit`, p.units, { left: x + w - 52, top: y + 34, width: 44, height: 24 }, { size: 12, colour: T.muted }));
    if (p.trend && h >= 104) {
      parts.push(trendGraph(`${name}_Trend`, p.tag ? [p.tag] : [], { left: x + 8, top: y + 72, width: w - 16, height: h - 80 }));
    }
    if (p.tag) wires.push({ index: parts.indexOf(value), tag: p.tag, property: "CurrentValue" });
    return { parts, wires };
  },
};

/* ---------------------------------------------------------------------- */
/* EquipmentSymbol                                                         */
/* ---------------------------------------------------------------------- */

export const EquipmentSymbolProps = z.object({
  label: z.string(),
  runTag: z.string().optional(),
  faultTag: z.string().optional(),
  /** The shipped graphic's geometry, from the library. Absent draws an outline. */
  graphic: z.object({ Commands: z.string(), Points: z.string() }).optional(),
});
export type EquipmentSymbolProps = z.infer<typeof EquipmentSymbolProps>;

/**
 * The product's own drawing of the machine, in the equipment greys, with its
 * name under it and two small state indicators at the corners: running as an
 * outline change at the top right, fault as priority-1 colour at the top
 * left. Nothing repaints the symbol itself; that is the handbook's rule.
 */
export const EquipmentSymbol: CompositeDef<EquipmentSymbolProps> = {
  kind: "EquipmentSymbol",
  label: "Equipment symbol",
  hint: "A library symbol with running and fault indicators",
  key: "y",
  props: EquipmentSymbolProps,
  defaults: { label: "P-101" },
  size: { width: 120, height: 128 },
  expand(p, box, name) {
    const parts: Part[] = [];
    const wires: Expanded["wires"] = [];
    const { left: x, top: y, width: w, height: h } = box;
    const dot = 16;
    const symbolBox = { left: x + dot + 4, top: y + 4, width: Math.max(GRID, w - 2 * (dot + 4)), height: Math.max(GRID, h - 32) };
    // The library's path is one filled shape; the outline is what makes it
    // read on the grey ground, and a 2px one is what the handbook draws.
    const symbol = p.graphic
      ? pathPart(`${name}`, p.graphic, symbolBox, { fill: T.equipmentFill, border: T.equipmentLine })
      : rectangle(`${name}`, symbolBox, { fill: T.equipmentFill, border: T.equipmentLine });
    if ("Thickness" in symbol) symbol.Thickness = 2;
    parts.push(symbol);
    parts.push(textBox(`${name}_Lbl`, p.label, { left: x, top: y + h - 24, width: w, height: 20 }, { size: 12, bold: true, colour: T.ink }));
    if (p.runTag) {
      const run = lamp(`${name}_RUN`, "", "", { left: x + w - dot, top: y, width: dot, height: dot });
      parts.push(run);
      wires.push({ index: parts.indexOf(run), tag: p.runTag, property: "CurrentValue" });
    }
    if (p.faultTag) {
      const fault = alarmLamp(`${name}_FLT`, "", "", { left: x, top: y, width: dot, height: dot });
      parts.push(fault);
      wires.push({ index: parts.indexOf(fault), tag: p.faultTag, property: "CurrentValue" });
    }
    return { parts, wires };
  },
};

/* ---------------------------------------------------------------------- */
/* The registry                                                            */
/* ---------------------------------------------------------------------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const COMPOSITES: Record<CompositeKind, CompositeDef<any>> = {
  AnalogIndicator,
  KpiTile,
  EquipmentSymbol,
};

/** Parse props against the definition, filling gaps from the defaults. */
export function propsFor(kind: CompositeKind, given: Record<string, unknown> = {}): Record<string, unknown> {
  const def = COMPOSITES[kind];
  return def.props.parse({ ...def.defaults, ...given });
}

/** Expand with parsed props and a grid-snapped box. */
export function expandComposite(kind: CompositeKind, props: Record<string, unknown>, box: Box, name: string): Expanded {
  const def = COMPOSITES[kind];
  const snapped: Box = { left: snap(box.left), top: snap(box.top), width: Math.max(GRID, snap(box.width)), height: Math.max(GRID, snap(box.height)) };
  return def.expand(propsFor(kind, props), snapped, name);
}

/** The smallest box that holds every part, for re-expanding in place. */
export function unionBox(parts: Part[]): Box | null {
  if (parts.length === 0) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of parts) {
    left = Math.min(left, p.Location.Left);
    top = Math.min(top, p.Location.Top);
    right = Math.max(right, p.Location.Left + p.Width);
    bottom = Math.max(bottom, p.Location.Top + p.Height);
  }
  return { left, top, width: right - left, height: bottom - top };
}
