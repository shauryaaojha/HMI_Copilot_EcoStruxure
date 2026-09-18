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
    Font: bold ? { ...FONT, Size: size, Bold: true } : { ...FONT, Size: size },
    TextLayout: { HorizontalAlignment: 1, VerticalAlignment: 64 },
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
  };
}

export function rectangle(
  name: string,
  box: Box,
  opts: { fill?: number; border?: number } = {},
): Part {
  const { fill = PAPER, border = GREY } = opts;
  return {
    Type: "Rectangle",
    UniqueId: gid(),
    Name: name,
    Fill: color(fill),
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
    Off: face(off, T.ink, T.equipmentFill, T.equipmentLine),
    On: { ...face(on, T.ink, T.white, T.runningLine), Thickness: 2 },
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
    Off: face(off, T.ink, T.equipmentFill, T.equipmentLine),
    On: face(on, T.onAlarm, T.alarmP1, T.alarmP1),
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
  };
}

export function numericDisplay(name: string, box: Box, decimals = 1): Part {
  return {
    Type: "NumericDisplay",
    UniqueId: gid(),
    Name: name,
    CurrentValue: 0,
    DecimalDigits: decimals,
    TextColor: color(INK),
    Font: { ...FONT, Size: 20 },
    Fill: color(WHITE),
    Border: color(DARK_GREY),
    Thickness: 1,
    TextLayout: { HorizontalAlignment: 4, VerticalAlignment: 64 },
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
  };
}

/**
 * A momentary switch: a grey face at rest, the brand green while pressed.
 * OperationType 1 with Operation 1 is the bit operation the shipped demo uses
 * on its own switch-lamps; which bit is decided by the binding.
 */
export function switchPart(name: string, label: string, box: Box): Part {
  return {
    Type: "Switch",
    UniqueId: gid(),
    Name: name,
    Release: face(label, T.ink, T.white, T.line),
    Press: face(label, T.pressedInk, T.pressedFill, T.pressedFill),
    ClickTrigger: { OperationType: 1, Operation: 1 },
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
const CHANNEL_COLOURS = [GREEN, AMBER, BLUE, RED, TEAL, DARK_GREY];

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
  return {
    Type: "Path",
    UniqueId: gid(),
    Name: name,
    Commands: symbol.Commands,
    Points: symbol.Points,
    Fill: color(opts.fill ?? GREY),
    Border: color(opts.border ?? DARK_GREY),
    Thickness: 1,
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
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
