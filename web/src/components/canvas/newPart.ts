/**
 * Turning a drawn box into a part the packager can emit.
 *
 * One place, so the toolbar, the context menu, a library drop and the chat's
 * "add a numeric display" all produce the same JSON. Names are provisional -
 * the store makes them unique on insert, because bindings resolve by name.
 */

import {
  alarmSummary,
  lamp,
  numericDisplay,
  pathPart,
  rectangle,
  textBox,
  type Box,
} from "@/lib/ote/parts";
import type { Part, PartType } from "@/lib/ote/schema";

/** Every tool the toolbar can arm, with the label and the key that arms it. */
export const TOOLS: {
  type: PartType;
  label: string;
  hint: string;
  key: string;
}[] = [
  { type: "Rectangle", label: "Rectangle", hint: "Panel or background", key: "r" },
  { type: "TextBox", label: "Text", hint: "Label or title", key: "t" },
  { type: "Lamp", label: "Lamp", hint: "Two-state indicator", key: "l" },
  { type: "NumericDisplay", label: "Numeric", hint: "Bound reading", key: "n" },
  { type: "AlarmSummary", label: "Alarm summary", hint: "Active alarm grid", key: "a" },
];

/** A stem the store then makes unique, in the shape the pipeline already uses. */
const STEM: Record<PartType, string> = {
  Rectangle: "Panel",
  TextBox: "Lbl",
  Lamp: "Lamp",
  NumericDisplay: "Num",
  AlarmSummary: "AlarmBanner",
  Path: "Symbol",
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
    case "Path":
      // A Path with no geometry would render as nothing; a library drop goes
      // through symbolPart instead, which has the geometry to give it.
      return rectangle(name, box);
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
