/**
 * Turning a drawn box into a part the packager can emit.
 *
 * One place, so the toolbar, the context menu, a library drop and the chat's
 * "add a numeric display" all produce the same JSON. Names are provisional -
 * the store makes them unique on insert, because bindings resolve by name.
 */

import {
  alarmSummary,
  barScale,
  blockTrend,
  dateTimeDisplay,
  lamp,
  nStateLamp,
  numericDisplay,
  pathPart,
  pipe,
  rectangle,
  stringDisplay,
  switchPart,
  textBox,
  toggleSwitch,
  trendGraph,
  type Box,
} from "@/lib/ote/parts";
import type { Part, PartType } from "@/lib/ote/schema";
import { COMPOSITES, type CompositeKind } from "@/lib/composites";

/** What the canvas can be armed to draw: a part, or a composite of parts. */
export type ToolType = PartType | CompositeKind;

/** Every tool the toolbar can arm, with the label and the key that arms it. */
export type ToolGroup = "Basic" | "Indicators" | "Controls" | "Displays" | "Data" | "Composites";

export const TOOLS: {
  type: ToolType;
  label: string;
  hint: string;
  key: string;
  group: ToolGroup;
}[] = [
  ...Object.values(COMPOSITES).map((def) => ({
    type: def.kind as ToolType,
    label: def.label,
    hint: def.hint,
    key: def.key,
    group: "Composites" as ToolGroup,
  })),
  { type: "Rectangle", label: "Rectangle", hint: "Panel or background", key: "r", group: "Basic" },
  { type: "Ellipse", label: "Ellipse", hint: "Circle or oval", key: "o", group: "Basic" },
  { type: "Line", label: "Line", hint: "Straight line, corner to corner of its box", key: "j", group: "Basic" },
  { type: "TextBox", label: "Text", hint: "Label or title", key: "t", group: "Basic" },
  { type: "Pipe", label: "Pipe", hint: "Line whose colour follows a state", key: "p", group: "Basic" },
  { type: "Lamp", label: "Lamp", hint: "Two-state indicator", key: "l", group: "Indicators" },
  { type: "N-StateLamp", label: "N-state lamp", hint: "One face per integer state", key: "m", group: "Indicators" },
  { type: "Switch", label: "Switch", hint: "Momentary touch target that writes a bit", key: "s", group: "Controls" },
  { type: "ToggleSwitch", label: "Toggle switch", hint: "Latching two-position switch", key: "k", group: "Controls" },
  { type: "NumericDisplay", label: "Numeric", hint: "Bound reading", key: "n", group: "Displays" },
  { type: "StringDisplay", label: "String", hint: "Bound text", key: "g", group: "Displays" },
  { type: "DateTimeDisplay", label: "Date and time", hint: "The panel clock", key: "d", group: "Displays" },
  { type: "BarScale", label: "Scale", hint: "Ticks and labels beside a level", key: "b", group: "Displays" },
  { type: "AlarmSummary", label: "Alarm summary", hint: "Active alarm grid", key: "a", group: "Data" },
  { type: "TrendGraph", label: "Trend", hint: "Line trend of up to sixteen tags", key: "e", group: "Data" },
  { type: "BlockTrend", label: "Block trend", hint: "Bar trend of the last samples", key: "w", group: "Data" },
];

/** The tools a hand reaches for most; the rest sit in the Insert menu. */
export const QUICK_TOOLS: PartType[] = ["Rectangle", "TextBox", "Lamp", "NumericDisplay", "Switch"];

/** A stem the store then makes unique, in the shape the pipeline already uses. */
const STEM: Record<PartType, string> = {
  Rectangle: "Panel",
  TextBox: "Lbl",
  Lamp: "Lamp",
  NumericDisplay: "Num",
  AlarmSummary: "AlarmBanner",
  Path: "Symbol",
  Switch: "Sw",
  "N-StateLamp": "State",
  StringDisplay: "Str",
  ToggleSwitch: "Tgl",
  BarScale: "Scale",
  Pipe: "Pipe",
  DateTimeDisplay: "Clock",
  TrendGraph: "Trend",
  BlockTrend: "Blocks",
  Ellipse: "Ellipse",
  Line: "Line",
  PolyLine: "PolyLine",
  Polygon: "Polygon",
  Bezier: "Bezier",
  Arc: "Arc",
  Pie: "Pie",
  Arch: "Arch",
  Doughnut: "Doughnut",
  ContentDisplay: "Content",
};

export function partFromTool(type: PartType, box: Box): Part {
  const name = STEM[type];
  switch (type) {
    case "Rectangle":
      return rectangle(name, box);
    case "TextBox":
      return textBox(name, "Label", box, { size: 14 });
    case "Lamp":
      return lamp(name, "OFF", "ON", box);
    case "NumericDisplay":
      return numericDisplay(name, box);
    case "AlarmSummary":
      return alarmSummary(name, box);
    case "Switch":
      return switchPart(name, "START", box);
    case "N-StateLamp":
      return nStateLamp(name, ["STOPPED", "RUNNING", "FAULT"], box);
    case "StringDisplay":
      return stringDisplay(name, box);
    case "ToggleSwitch":
      return toggleSwitch(name, "OFF", "ON", box);
    case "BarScale":
      return barScale(name, box);
    case "Pipe":
      return pipe(name, box);
    case "DateTimeDisplay":
      return dateTimeDisplay(name, box);
    case "TrendGraph":
      return trendGraph(name, [], box);
    case "BlockTrend":
      return blockTrend(name, [], box);
    case "Path":
      // A Path with no geometry would render as nothing; a library drop goes
      // through symbolPart instead, which has the geometry to give it.
      return rectangle(name, box);
    case "Ellipse":
      return { ...rectangle(name, box), Type: "Ellipse" } as Part;
    case "Line":
    case "PolyLine": {
      const { Fill: _f, Border: _b, ...rest } = rectangle(name, box) as Extract<Part, { Type: "Rectangle" }>;
      return { ...rest, Type: type, Stroke: { Color: { Value: 1 } }, Thickness: 2 } as Part;
    }
    case "Bezier": {
      const { Fill: _f, Border: _b, ...rest } = rectangle(name, box) as Extract<Part, { Type: "Rectangle" }>;
      return { ...rest, Type: "Bezier", Stroke: { Color: { Value: 1 } }, Thickness: 2, Path: { Commands: "MC", Data: "0,3072,0,0,3072,0,3072,3072" } } as Part;
    }
    case "Arc": {
      const { Fill: _f, Border: _b, ...rest } = rectangle(name, box) as Extract<Part, { Type: "Rectangle" }>;
      return { ...rest, Type: "Arc", Stroke: { Color: { Value: 1 } }, Thickness: 2 } as Part;
    }
    case "Pie":
    case "Arch":
    case "Doughnut":
      return { ...rectangle(name, box), Type: type } as Part;
    case "ContentDisplay": {
      const { Fill: _f, Border: _b, Thickness: _t, ...rest } = rectangle(name, box) as Extract<Part, { Type: "Rectangle" }>;
      return { ...rest, Type: "ContentDisplay", ScreenId: 1 } as Part;
    }
    case "Polygon":
      return { ...rectangle(name, box), Type: "Polygon", Path: { Commands: "MLLLz", Data: "1536,0,3072,1536,1536,3072,0,1536" } } as Part;
  }
}

/** A shipped graphic object, dropped from the library at its indexed size. */
export function symbolPart(
  symbol: { name: string; Commands: string; Points: string },
  box: Box,
): Part {
  return pathPart(
    symbol.name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "S$1"),
    symbol,
    box,
  );
}
