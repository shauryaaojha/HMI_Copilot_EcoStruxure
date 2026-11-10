/**
 * Part factories. Every shape here was taken from a real object in a shipped
 * sample project (reference/part_examples.json), never invented - which is what
 * lets the product open what we write.
 *
 * Ported from tools/make_project.py. Phase 1 of docs/BUILD_PLAN.md.
 */

import {
  AMBER,
  BLUE,
  DARK_GREY,
  GREEN,
  GREY,
  INK,
  PAPER,
  RED,
  TEAL,
  WHITE,
} from "./palette";
import type { Part, Screen, ViewBox } from "./schema";
import { DEFAULT_PACK } from "../standard/pack";
import { DEFAULT_THEME } from "../components/theme";

/** The Standard in force. Running is an outline change; colour is for alarms. */
const T = DEFAULT_PACK.tokens;

/** The font reference the product writes for the default face. */
export const FONT = {
  Type: { Type: 2 as const, Value: "0", DisplayValue: "0" },
};

export const gid = () => crypto.randomUUID();

const color = (value: number) => ({ Color: { Value: value } });

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function textBox(
  name: string,
  text: string,
  box: Box,
  opts: { size?: number; colour?: number; bold?: boolean } = {},
): Part {
  const { size = 12, colour = INK, bold = false } = opts;
  return {
    Type: "TextBox",
    UniqueId: gid(),
    Name: name,
    Text: text,
    TextColor: color(colour),
    // Attribute.Bold is the product's own key for bold; Bold is what this editor has always drawn from.
    Font: bold ? { ...FONT, Size: size, Bold: true, Attribute: { Bold: true } } : { ...FONT, Size: size },
    TextLayout: { HorizontalAlignment: 1, VerticalAlignment: 64 },
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
  };
}

export function rectangle(
  name: string,
  box: Box,
  opts: { fill?: number; border?: number; fillLevel?: { back: number; vertical?: boolean }; radius?: number } = {},
): Part {
  const { fill = PAPER, border = GREY, fillLevel } = opts;
  return {
    Type: "Rectangle",
    UniqueId: gid(),
    Name: name,
    Fill: color(fill),
    Border: color(border),
    Thickness: 1,
    ...(opts.radius !== undefined ? { CornerRadius: { Style: 2, TopLeft: opts.radius, TopRight: opts.radius, BottomLeft: opts.radius, BottomRight: opts.radius } } : {}),
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
    // The product's bar: a Rectangle that fills to a level, with BackColor as
    // the part not yet filled. The axis is named by which property is present,
    // which is how the shipped templates distinguish them.
    ...(fillLevel
      ? {
          Animation: {
            FillLevel: {
              Enable: true,
              BackColor: { Value: fillLevel.back },
              ...(fillLevel.vertical === false ? { HorizontalFill: 50 } : { VerticalFill: 50 }),
            },
          },
        }
      : {}),
  };
}

/** A surface: the fill step says where it is, so it draws no outline (design B, V2). */
export function surface(name: string, box: Box, fill: number = T.white): Part {
  return { Type: "Rectangle", UniqueId: gid(), Name: name, Fill: color(fill), Border: { Type: 0 }, Thickness: 0,
    Location: { Left: box.left, Top: box.top }, Width: box.width, Height: box.height };
}

/**
 * A group that draws nothing: spacing and a heading say what belongs together
 * (V1), and this is what a tidy, a move and a regeneration hold on to.
 */
export function groupBox(name: string, box: Box): Part {
  return { Type: "Rectangle", UniqueId: gid(), Name: name, Fill: { Type: 0 }, Border: { Type: 0 }, Thickness: 0,
    Location: { Left: box.left, Top: box.top }, Width: box.width, Height: box.height };
}

/** Factories for parts the reader and writer know, held out of generation until OTE is benched. */
export function ellipse(name: string, box: Box, opts: { fill?: number; border?: number; thickness?: number } = {}): Part {
  return { Type: "Ellipse", UniqueId: gid(), Name: name, Fill: color(opts.fill ?? PAPER), Border: color(opts.border ?? DARK_GREY), Thickness: opts.thickness ?? 2,
    Location: { Left: box.left, Top: box.top }, Width: box.width, Height: box.height };
}

export function polygon(name: string, box: Box, points: readonly { x: number; y: number }[], opts: { fill?: number; border?: number; thickness?: number } = {}): Part {
  if (points.length < 3) throw new Error("A polygon needs at least three points");
  return { Type: "Polygon", UniqueId: gid(), Name: name, Fill: color(opts.fill ?? PAPER), Border: color(opts.border ?? DARK_GREY), Thickness: opts.thickness ?? 2,
    Path: { Commands: "M" + "L".repeat(points.length - 1) + "z", Data: points.map((p) => `${Math.round(p.x * 3072)},${Math.round(p.y * 3072)}`).join(",") },
    Location: { Left: box.left, Top: box.top }, Width: box.width, Height: box.height };
}

export function line(name: string, box: Box, opts: { stroke?: number; thickness?: number; points?: readonly { x: number; y: number }[] } = {}): Part {
  const points = opts.points ?? [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  if (points.length < 2) throw new Error("A line needs at least two points");
  return { Type: "Line", UniqueId: gid(), Name: name, Stroke: color(opts.stroke ?? DARK_GREY), Thickness: opts.thickness ?? 2,
    Path: { Commands: "M" + "L".repeat(points.length - 1), Data: points.map((p) => `${Math.round(p.x * 3072)},${Math.round(p.y * 3072)}`).join(",") },
    Location: { Left: box.left, Top: box.top }, Width: box.width, Height: box.height };
}

export function arch(name: string, box: Box, opts: { start?: number; end?: number; innerRadius?: number; fill?: number; border?: number; thickness?: number } = {}): Part {
  return { Type: "Arch", UniqueId: gid(), Name: name, StartAngle: opts.start ?? 135, EndAngle: opts.end ?? 405,
    InnerRadius: opts.innerRadius ?? 70, Fill: color(opts.fill ?? PAPER), Border: color(opts.border ?? DARK_GREY), Thickness: opts.thickness ?? 2,
    Location: { Left: box.left, Top: box.top }, Width: box.width, Height: box.height };
}

/**
 * A live bar: a Rectangle whose FillLevel animation fills it from the bottom
 * (vertical) or the left (horizontal), the product's default start points.
 * Drawn half full at design time - the binding fills it at runtime.
 */
export function fillBar(name: string, box: Box, opts: { fill: number; back: number; border: number; vertical: boolean; designValue?: number }): Part {
  return {
    Type: "Rectangle",
    UniqueId: gid(),
    Name: name,
    Fill: color(opts.fill),
    Border: color(opts.border),
    Thickness: 1,
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
    Animation: {
      FillLevel: {
        Enable: true,
        ...(opts.vertical ? { VerticalFill: opts.designValue ?? 50 } : { HorizontalFill: opts.designValue ?? 50 }),
        BackColor: { Value: opts.back },
      },
    },
  };
}

/** A rectangle with no fill: a frame drawn over something, like a normal band on a bar. */
export function outline(name: string, box: Box, border: number): Part {
  return {
    Type: "Rectangle",
    UniqueId: gid(),
    Name: name,
    Fill: { Type: 0 },
    Border: color(border),
    Thickness: 1,
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
  };
}

/** A Lamp carries both faces; the bound tag chooses between them at runtime. */
function face(text: string, fg: number, bg: number, bd: number) {
  return {
    TextColor: color(fg),
    Text: text,
    Font: { ...FONT, Size: 13 },
    TextLayout: { Wrap: true },
    Fill: color(bg),
    Border: color(bd),
    Thickness: 1,
  };
}

export function lamp(name: string, off: string, on: string, box: Box): Part {
  return {
    Type: "Lamp",
    UniqueId: gid(),
    Name: name,
    // V5: running is a dark fill with white text, stopped an outline on the ground.
    Off: face(off, T.ink, DEFAULT_THEME.tokens.equipmentStopped, DEFAULT_THEME.tokens.equipmentLine),
    On: face(on, DEFAULT_THEME.tokens.onDark, DEFAULT_THEME.tokens.equipmentRunning, DEFAULT_THEME.tokens.equipmentRunning),
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
  };
}

/** Same part, priority-1 On face - a fault reads as an alarm, not a status. */
export function alarmLamp(name: string, off: string, on: string, box: Box): Part {
  return {
    Type: "Lamp",
    UniqueId: gid(),
    Name: name,
    Off: face(off, T.ink, DEFAULT_THEME.tokens.equipmentStopped, DEFAULT_THEME.tokens.equipmentLine),
    On: face(on, T.onAlarm, T.alarmP1, T.alarmP1),
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
  };
}

/**
 * A number on the panel. Read-only unless `input` says otherwise: the product
 * leaves IsInputModeEnabled out when it is on, so a display that does not say
 * false is one an operator can touch and type a value into, written straight
 * to the PLC (the rig's engineer sets false on every display that is not an
 * entry). An entry is drawn white with a heavier border, so it looks touchable.
 */
export function numericDisplay(name: string, box: Box, decimals = 1, input = false): Part {
  return {
    Type: "NumericDisplay",
    UniqueId: gid(),
    Name: name,
    CurrentValue: 0,
    FloatDigits: decimals,
    ...(input ? {} : { IsInputModeEnabled: false }),
    TextColor: color(INK),
    Font: { ...FONT, Size: 20 },
    Fill: color(WHITE),
    Border: color(DARK_GREY),
    Thickness: input ? 2 : 1,
    TextLayout: { HorizontalAlignment: 4, VerticalAlignment: 64 },
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
  };
}

/**
 * OTE's bit operations (OperationType 1), as the Pro-face push button CO
 * names its four inner switches: Operation absent is Set, 1 Reset, 2 Toggle,
 * 10 Momentary. Which bit is decided by the binding (ClickTrigger.Destination).
 */
export const BIT_OPERATION = { set: 0, reset: 1, toggle: 2, momentary: 10 } as const;

/**
 * A push button: a grey face at rest, the brand green while pressed. Momentary
 * by default - the bit is 1 while the finger is on it, which is what a PLC's
 * START, STOP and RESET inputs expect (the rig's own buttons are momentary).
 */
export function switchPart(name: string, label: string, box: Box, operation: number = BIT_OPERATION.momentary): Part {
  return {
    Type: "Switch",
    UniqueId: gid(),
    Name: name,
    Release: face(label, T.ink, T.white, T.line),
    Press: face(label, T.pressedInk, T.pressedFill, T.pressedFill),
    ClickTrigger: operation === BIT_OPERATION.set ? { OperationType: 1 } : { OperationType: 1, Operation: operation },
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
  };
}

/**
 * A touch area that changes screen: a Switch with no face of its own, laid
 * over a navigation chip so the chip's look and label stay as drawn. Its
 * destination is a screen name until the packager writes the screen's number
 * (OperationType 4, Operation 1, as the rig's header icons switch screens).
 */
export function screenSwitch(name: string, screenName: string, box: Box): Part {
  const clear = { Text: "", Fill: { Type: 0 }, Border: { Type: 0 }, Thickness: 0 };
  return {
    Type: "Switch",
    UniqueId: gid(),
    Name: name,
    Release: clear,
    Press: { ...clear, Fill: color(T.pressedFill) },
    ClickTrigger: { OperationType: 4, Operation: 1, ScreenName: screenName },
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
  };
}

/**
 * Faces per state: at rest, running (outline), warning (priority 2), fault
 * (priority 1), then round again. Colour appears from the third state on,
 * because that is where "abnormal" starts.
 */
const STATE_FACES: [number, number, number][] = [
  [T.ink, T.equipmentFill, T.equipmentLine],
  [T.ink, T.white, T.runningLine],
  [T.ink, T.alarmP2, T.alarmP2],
  [T.onAlarm, T.alarmP1, T.alarmP1],
];

/** An indicator with one face per state; the bound integer picks the face. */
export function nStateLamp(name: string, states: string[], box: Box): Part {
  const labels = states.length >= 2 ? states.slice(0, 16) : ["STOPPED", "RUNNING"];
  return {
    Type: "N-StateLamp",
    UniqueId: gid(),
    Name: name,
    NumberOfStates: labels.length,
    States: labels.map((text, i) => {
      const [fg, bg, bd] = STATE_FACES[i % STATE_FACES.length];
      return face(text, fg, bg, bd);
    }),
    Invalid: face("?", T.onAlarm, T.alarmP4, T.alarmP4),
    CurrentValue: 0,
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
  };
}

/** Text from a STRING tag, drawn the way a numeric display draws a number. */
export function stringDisplay(name: string, box: Box, length = 20): Part {
  return {
    Type: "StringDisplay",
    UniqueId: gid(),
    Name: name,
    CurrentValue: "",
    DisplayLength: length,
    TextColor: color(INK),
    Font: { ...FONT, Size: 16 },
    Fill: color(WHITE),
    Border: color(DARK_GREY),
    Thickness: 1,
    TextLayout: { HorizontalAlignment: 1, VerticalAlignment: 64 },
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
  };
}

/** A latching two-position switch: grey at rest, the brand green when on. */
export function toggleSwitch(name: string, off: string, on: string, box: Box): Part {
  return {
    Type: "ToggleSwitch",
    UniqueId: gid(),
    Name: name,
    InterlockState: false,
    Off: face(off, T.ink, T.equipmentFill, T.equipmentLine),
    On: face(on, T.pressedInk, T.pressedFill, T.pressedFill),
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
  };
}

/** A scale from 0 to `max`, in the ink colour, one label per major tick. */
export function barScale(name: string, box: Box, max = 100): Part {
  return {
    Type: "BarScale",
    UniqueId: gid(),
    Name: name,
    ScaleLabel: true,
    LabelAttribute: {
      Max: max,
      TextColor: color(INK),
      Font: { ...FONT, Size: 10 },
      IntegerDigits: String(Math.round(max)).length,
      FloatDigits: 0,
    },
    Stroke: color(INK),
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
  };
}

/**
 * A straight pipe across the box: along its longer side, so a tall box draws
 * a riser and a wide one a header. State 0 is the empty pipe, state 1 the
 * flowing one, in the product's own 3072-unit geometry.
 */
export function pipe(name: string, box: Box): Part {
  const vertical = box.height >= box.width;
  const half = 1536;
  const data = vertical
    ? [{ Location: { Left: half, Top: 0 } }, { Location: { Left: half, Top: 3072 } }]
    : [{ Location: { Left: 0, Top: half } }, { Location: { Left: 3072, Top: half } }];
  return {
    Type: "Pipe",
    UniqueId: gid(),
    Name: name,
    States: [
      { Fill: color(T.panel), Border: color(T.line), FillThickness: 6, BorderThickness: 10 },
      { Fill: color(T.runningLine), Border: color(T.line), FillThickness: 6, BorderThickness: 10 },
    ],
    Invalid: { Fill: color(T.alarmP1), Border: color(T.line), FillThickness: 6, BorderThickness: 10 },
    Path: { Commands: "ML", Data: data },
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
  };
}

/**
 * A pipe along an explicit path: points in screen units, anywhere in the box
 * or outside it, mapped into the product's 3072-unit square. This is what a
 * process view draws between two symbols - an elbow or two, never a diagonal.
 */
export function pipeRun(name: string, points: { x: number; y: number }[]): Part {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const width = Math.max(1, Math.max(...xs) - left);
  const height = Math.max(1, Math.max(...ys) - top);
  const data = points.map((p) => ({
    Location: {
      Left: Math.round(((p.x - left) / width) * 3072),
      Top: Math.round(((p.y - top) / height) * 3072),
    },
  }));
  return {
    Type: "Pipe",
    UniqueId: gid(),
    Name: name,
    States: [
      { Fill: color(T.panel), Border: color(T.line), FillThickness: 6, BorderThickness: 10 },
      { Fill: color(T.runningLine), Border: color(T.line), FillThickness: 6, BorderThickness: 10 },
    ],
    Invalid: { Fill: color(T.alarmP1), Border: color(T.line), FillThickness: 6, BorderThickness: 10 },
    Path: { Commands: "M" + "L".repeat(Math.max(1, points.length - 1)), Data: data },
    Location: { Left: left, Top: top },
    Width: width,
    Height: height,
  };
}

/** The panel clock, drawn like a numeric display. */
export function dateTimeDisplay(name: string, box: Box): Part {
  return {
    Type: "DateTimeDisplay",
    UniqueId: gid(),
    Name: name,
    IsInputModeEnabled: false,
    TextColor: color(INK),
    Font: { ...FONT, Size: 14 },
    Fill: color(WHITE),
    Border: color(DARK_GREY),
    Thickness: 1,
    TextLayout: { HorizontalAlignment: 2, VerticalAlignment: 64 },
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
  };
}

/** Channel colours, in the order an operator expects to tell them apart. */
const CHANNEL_COLOURS = [DEFAULT_THEME.tokens.trend1, DEFAULT_THEME.tokens.trend2, DEFAULT_THEME.tokens.trend3, DEFAULT_THEME.tokens.trend4];

function channels(tags: string[]) {
  const named = tags.length > 0 ? tags.slice(0, 16) : [""];
  return named.map((tag, i) => ({
    ...(tag ? { Variable: tag } : {}),
    Stroke: color(CHANNEL_COLOURS[i % CHANNEL_COLOURS.length]),
    UseGlobalRange: true,
    DisplayFormat: 1,
  }));
}

/** A line trend of the named tags; an empty list makes one unassigned channel. */
export function trendGraph(name: string, tags: string[], box: Box): Part {
  return {
    Type: "TrendGraph",
    UniqueId: gid(),
    Name: name,
    Channels: channels(tags),
    GraphType: 1,
    CursorLabelsEnabled: true,
    DisplayHistoricalData: true,
    Fill: color(WHITE),
    Border: color(DARK_GREY),
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
  };
}

/** A bar trend: the last `points` samples of each named tag, side by side. */
export function blockTrend(name: string, tags: string[], box: Box, points = 12): Part {
  return {
    Type: "BlockTrend",
    UniqueId: gid(),
    Name: name,
    Channels: channels(tags).map((c) => ({ ...c, NumberOfData: points })),
    NumberOfDataPoints: points,
    Fill: color(WHITE),
    Border: color(DARK_GREY),
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
  };
}

export function alarmSummary(name: string, box: Box): Part {
  return {
    Type: "AlarmSummary",
    UniqueId: gid(),
    Name: name,
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
  };
}

/** One of the shipped graphic objects, placed as path geometry. */
export function pathPart(
  name: string,
  symbol: { Commands: string; Points: string },
  box: Box,
  opts: { fill?: number; border?: number } = {},
): Part {
  // The product's own encoding (Demo 1.eote, every Path): `Path: {Commands,
  // Data}`, the points normalised to span 0..3072 on both axes and stretched
  // over Width x Height. The shipped .path files keep `Commands` and `Points`
  // at the top level in their own extent; written that way the licensed
  // editor ignores the geometry and draws its default callout shape
  // (scripts/ote-bench.ps1, 16 Oct 2026). So the points are rescaled, and the
  // box is narrowed to the symbol's own aspect, centred where it was asked
  // for, so the stretch never distorts it.
  const nums = symbol.Points.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    minX = Math.min(minX, nums[i]); maxX = Math.max(maxX, nums[i]);
    minY = Math.min(minY, nums[i + 1]); maxY = Math.max(maxY, nums[i + 1]);
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const data = nums.map((n, i) => Math.round(((n - (i % 2 === 0 ? minX : minY)) * 3072) / (i % 2 === 0 ? spanX : spanY))).join(",");
  const aspect = spanX / spanY;
  const width = Math.min(box.width, Math.round(box.height * aspect));
  const height = Math.min(box.height, Math.round(box.width / aspect));
  return {
    Type: "Path",
    UniqueId: gid(),
    Name: name,
    Path: { Commands: symbol.Commands, Data: data },
    Fill: color(opts.fill ?? GREY),
    Border: color(opts.border ?? DARK_GREY),
    Thickness: 1,
    Location: { Left: box.left + Math.round((box.width - width) / 2), Top: box.top + Math.round((box.height - height) / 2) },
    Width: width,
    Height: height,
  };
}

/** Wraps parts in the Screen -> ViewBox shape the product expects. */
export function screenOf(
  name: string,
  parts: Part[],
  size: { width: number; height: number },
): Screen {
  const view: ViewBox = {
    Type: "ViewBox",
    UniqueId: gid(),
    Name: "ViewBox",
    Options: 108,
    Width: size.width,
    Height: size.height,
    Children: parts,
  };
  return {
    Type: "Screen",
    UniqueId: gid(),
    Name: name,
    Children: [view],
  };
}
