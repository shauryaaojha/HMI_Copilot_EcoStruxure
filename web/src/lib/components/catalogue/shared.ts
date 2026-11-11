import type { Part } from "@/lib/ote/schema";
import type { Expanded } from "@/lib/composites";
import { fillBar, lamp, numericDisplay, rectangle, textBox, type Box } from "@/lib/ote/parts";
import { circle, diamond, fit, hexagon, maskPart, motorFrame, pumpArrow, pumpCasing, shapePart, triangle, valveBody, type Shape } from "@/lib/ote/shapes";
import type { ComponentUse } from "../types";
import type { Theme } from "../theme";

export const snap = (n: number) => Math.round(n / 4) * 4;
export const boxAt = (box: Box, x: number, y: number, width: number, height: number): Box => ({
  left: box.left + snap(x), top: box.top + snap(y), width: snap(width), height: snap(height),
});
export const stemOf = (use: ComponentUse) => (use.name ?? Object.values(use.tags)[0] ?? use.kind).replace(/[^A-Za-z0-9_]/g, "").slice(0, 40) || use.kind;

export function assembly() {
  const parts: Part[] = [];
  const wires: Expanded["wires"] = [];
  const add = (part: Part, tag?: string, property = "CurrentValue", converter?: { min: number; max: number }) => {
    const index = parts.push(part) - 1;
    if (tag) wires.push({ index, tag, property, ...(converter ? { converter } : {}) });
    return part;
  };
  return { parts, wires, add };
}

export function label(name: string, content: string, box: Box, theme: Theme, size: "label" | "small" | "title" = "label") {
  return textBox(name, content, box, { size: theme.type.regular[size], colour: theme.tokens.ink });
}

export function reading(name: string, box: Box, theme: Theme, decimals = 1, input = false) {
  const part = numericDisplay(name, box, decimals, input);
  if (part.Type === "NumericDisplay") {
    part.Font = { ...part.Font, Size: theme.type.regular.value };
    part.TextColor = { Color: { Value: theme.tokens.processValue } };
    part.Fill = { Color: { Value: theme.tokens.field } };
    part.Border = input ? { Color: { Value: theme.tokens.setpoint } } : { Type: 0 };
    part.Thickness = input ? 2 : 0;
  }
  return part;
}

export function equipmentBadge(name: string, box: Box, theme: Theme, words: [string, string] = ["STOPPED", "RUNNING"]) {
  const badge = lamp(name, words[0], words[1], box);
  if (badge.Type === "Lamp") {
    badge.Off = { ...badge.Off, TextColor: { Color: { Value: theme.tokens.ink } }, Fill: { Color: { Value: theme.tokens.equipmentStopped } },
      Border: { Color: { Value: theme.tokens.equipmentLine } }, Thickness: 1, Font: { ...badge.Off.Font, Size: theme.type.regular.small } };
    badge.On = { ...badge.On, TextColor: { Color: { Value: theme.tokens.onDark } }, Fill: { Color: { Value: theme.tokens.equipmentRunning } },
      Border: { Color: { Value: theme.tokens.equipmentRunning } }, Thickness: 0, Font: { ...badge.On.Font, Size: theme.type.regular.small } };
  }
  return badge;
}

export function equipmentBody(name: string, box: Box, theme: Theme) {
  const body = rectangle(name, box, { fill: theme.tokens.equipmentStopped, border: theme.tokens.equipmentLine });
  if (body.Type === "Rectangle") body.Thickness = theme.stroke.equipment;
  return body;
}

export function barParts(
  name: string, box: Box, theme: Theme,
  options: { tag?: string; min?: number; max?: number; normalLow?: number; normalHigh?: number; setpoint?: number; vertical?: boolean },
): Expanded {
  const { parts, wires, add } = assembly();
  const min = options.min ?? 0, max = options.max ?? 100;
  const fraction = (n: number) => Math.max(0, Math.min(1, (n - min) / (max - min || 1)));
  const vertical = options.vertical ?? box.height > box.width;
  const designValue = (fraction(((options.normalLow ?? min) + (options.normalHigh ?? max)) / 2) * 100);
  const bar = fillBar(`${name}_Fill`, box, { fill: theme.tokens.processValue, back: theme.tokens.field, border: theme.tokens.line, vertical, designValue });
  if (bar.Type === "Rectangle") bar.Thickness = 0;
  add(bar, options.tag, vertical ? "Animation.FillLevel.VerticalFill" : "Animation.FillLevel.HorizontalFill", { min, max });
  if (options.normalLow !== undefined && options.normalHigh !== undefined) {
    const low = fraction(options.normalLow), high = fraction(options.normalHigh);
    const band = vertical
      ? boxAt(box, 0, (1 - high) * box.height, box.width, (high - low) * box.height)
      : boxAt(box, low * box.width, 0, (high - low) * box.width, box.height);
    if (band.width > 0 && band.height > 0) {
      const mark = rectangle(`${name}_Band`, band, { fill: theme.tokens.normalBand, border: theme.tokens.normalBand });
      if (mark.Type === "Rectangle") { mark.Fill = { Type: 0 }; mark.Thickness = 1; mark.Border = { Color: { Value: theme.tokens.line } }; }
      add(mark);
    }
  }
  if (options.setpoint !== undefined) {
    const pos = fraction(options.setpoint);
    const tick = vertical
      ? boxAt(box, 0, (1 - pos) * box.height, box.width, 4)
      : boxAt(box, pos * box.width, 0, 4, box.height);
    add(rectangle(`${name}_Setpoint`, tick, { fill: theme.tokens.setpoint, border: theme.tokens.setpoint }));
  }
  return { parts, wires };
}

/* --- shapes that carry a state ----------------------------------------- */

const paint = (index: number) => ({ Color: { Value: index } });

/**
 * A lamp of any shape: the product's Lamp, seen through a plate cut to the
 * shape. `ground` is what the plate is painted, so it has to be what the lamp
 * stands on: the screen's ground, or the tile it is in.
 */
export function shapedLamp(
  name: string, shape: Shape, box: Box, theme: Theme,
  options: { tag?: string; on: number; off?: number; ground?: number; outlined?: boolean },
): Expanded {
  const { parts, wires, add } = assembly();
  const ground = options.ground ?? theme.tokens.ground;
  const light = lamp(name, "", "", box);
  if (light.Type === "Lamp") {
    // At rest it is the ground's own colour unless it is given one: a fault that is not there shows nothing.
    light.Off = { ...light.Off, Fill: paint(options.off ?? ground), Border: { Type: 0 }, Thickness: 0 };
    light.On = { ...light.On, Fill: paint(options.on), Border: { Type: 0 }, Thickness: 0 };
  }
  add(light, options.tag);
  add(maskPart(`${name}_Plate`, shape, box, { fill: ground, inset: 0 }));
  if (options.outlined) add(shapePart(`${name}_Edge`, shape, box, { border: theme.tokens.equipmentLine, thickness: box.width >= 32 ? theme.stroke.equipment : theme.stroke.hairline }));
  return { parts, wires };
}

/** What a fault bit, a high limit, a low limit and a running bit each look like. Shape first, colour second. */
export const INDICATOR = { fault: diamond, high: () => triangle("up"), low: () => triangle("down"), state: circle } as const;

export type SymbolKind = "Pump" | "Valve" | "Motor" | "Generic";
const SILHOUETTE: Record<SymbolKind, () => Shape> = { Pump: pumpCasing, Valve: valveBody, Motor: motorFrame, Generic: hexagon };

/**
 * A machine the way a P&ID draws it: the pump's casing, the valve's two
 * triangles, the motor on its feet. With a state tag the body is a lamp seen
 * through the outline, so it fills when the machine runs; without one it is the
 * resting grey, because a body bound to nothing must not claim a state.
 */
export function symbolParts(stem: string, kind: SymbolKind, box: Box, theme: Theme, options: { state?: string; ground?: number } = {}): Expanded {
  const { parts, wires, add } = assembly();
  const shape = SILHOUETTE[kind]();
  const ground = options.ground ?? theme.tokens.ground;
  if (options.state) {
    const body = lamp(`${stem}_Body`, "", "", box);
    if (body.Type === "Lamp") {
      body.Off = { ...body.Off, Fill: paint(theme.tokens.equipmentStopped), Border: { Type: 0 }, Thickness: 0 };
      body.On = { ...body.On, Fill: paint(theme.tokens.equipmentRunning), Border: { Type: 0 }, Thickness: 0 };
    }
    add(body, options.state);
  } else {
    const body = rectangle(`${stem}_Body`, box, { fill: theme.tokens.equipmentStopped, border: theme.tokens.equipmentStopped });
    if (body.Type === "Rectangle") body.Thickness = 0;
    add(body);
  }
  add(maskPart(`${stem}_Plate`, shape, box, { fill: ground, inset: 0 }));
  add(shapePart(`${stem}_Edge`, shape, box, { border: theme.tokens.equipmentLine, thickness: theme.stroke.equipment }));
  const drawn = fit(shape, box);
  if (kind === "Pump" && drawn.width >= 32) {
    // The casing spans y 0.12..1 of its own drawing; the arrow is placed in the same terms.
    add(shapePart(`${stem}_Glyph`, pumpArrow(), boxAt(drawn, drawn.width * 0.26, drawn.height * 0.26, drawn.width * 0.44, drawn.height * 0.5), { fill: theme.tokens.equipmentLine }));
  }
  if (kind === "Motor" && drawn.width >= 32) {
    const glyph = textBox(`${stem}_Glyph`, "M", boxAt(drawn, drawn.width * 0.25, drawn.height * 0.2, drawn.width * 0.5, drawn.height * 0.5), { size: theme.type.regular.title, colour: theme.tokens.ink, bold: true });
    if (glyph.Type === "TextBox") glyph.TextLayout = { HorizontalAlignment: 2, VerticalAlignment: 64 };
    add(glyph);
  }
  return { parts, wires };
}

/** Folds another expansion's parts and wires into an assembly. */
export function merge(into: { parts: Part[]; wires: Expanded["wires"] }, from: Expanded): void {
  const start = into.parts.length;
  into.parts.push(...from.parts);
  into.wires.push(...from.wires.map((wire) => ({ ...wire, index: wire.index + start })));
}
