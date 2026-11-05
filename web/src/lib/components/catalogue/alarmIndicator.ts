import { lamp, nStateLamp, type Box } from "@/lib/ote/parts";
import type { Theme } from "../theme";
import { assembly } from "./shared";

/** A square priority badge. Shape layers stay gated until Polygon and Ellipse are benched. */
export function alarmIndicator(name: string, box: Box, theme: Theme, tags: { fault?: string; priority?: string }) {
  const { parts, wires, add } = assembly();
  if (tags.priority) {
    const part = nStateLamp(name, ["", "1", "2", "3", "4"], box);
    if (part.Type === "N-StateLamp") {
      part.States = part.States.map((state, i) => ({ ...state,
        TextColor: { Color: { Value: i === 1 || i === 4 ? theme.tokens.onAlarm : theme.tokens.ink } },
        Fill: i === 0 ? { Type: 0 } : { Color: { Value: theme.tokens[`alarmP${i}` as "alarmP1"] } },
        Border: i === 0 ? { Type: 0 } : { Color: { Value: theme.tokens.ink } },
        Thickness: i === 0 ? 0 : 1,
      }));
    }
    add(part, tags.priority);
  } else if (tags.fault) {
    const part = lamp(name, "", "1", box);
    if (part.Type === "Lamp") {
      part.Off = { ...part.Off, Fill: { Type: 0 }, Border: { Type: 0 }, Thickness: 0 };
      part.On = { ...part.On, Fill: { Color: { Value: theme.tokens.alarmP1 } }, Border: { Color: { Value: theme.tokens.ink } }, TextColor: { Color: { Value: theme.tokens.onAlarm } }, Thickness: 1 };
    }
    add(part, tags.fault);
  }
  return { parts, wires };
}
