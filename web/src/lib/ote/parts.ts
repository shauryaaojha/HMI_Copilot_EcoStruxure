/**
 * Part factories. Every shape here was taken from a real object in a shipped
 * sample project (reference/part_examples.json), never invented - which is what
 * lets the product open what we write.
 *
 * Ported from tools/make_project.py. Phase 1 of docs/BUILD_PLAN.md.
 */

import {
  AMBER,
  DARK_GREEN,
  DARK_GREY,
  GREEN,
  GREY,
  INK,
  PAPER,
  RED,
  WHITE,
} from "./palette";
import type { Part, Screen, ViewBox } from "./schema";

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
    Off: face(off, INK, GREY, DARK_GREY),
    On: face(on, WHITE, GREEN, DARK_GREEN),
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
  };
}

/** Same part, red On face - a fault reads as an alarm, not a status. */
export function alarmLamp(name: string, off: string, on: string, box: Box): Part {
  return {
    Type: "Lamp",
    UniqueId: gid(),
    Name: name,
    Off: face(off, INK, GREY, DARK_GREY),
    On: face(on, WHITE, RED, DARK_GREY),
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
    Release: face(label, INK, WHITE, DARK_GREY),
    Press: face(label, WHITE, GREEN, DARK_GREEN),
    ClickTrigger: { OperationType: 1, Operation: 1 },
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
  };
}

/** Palette per state: grey, green, amber, red, then grey again. */
const STATE_FACES: [number, number, number][] = [
  [INK, GREY, DARK_GREY],
  [WHITE, GREEN, DARK_GREEN],
  [INK, AMBER, DARK_GREY],
  [WHITE, RED, DARK_GREY],
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
    Invalid: face("?", WHITE, DARK_GREY, DARK_GREY),
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
