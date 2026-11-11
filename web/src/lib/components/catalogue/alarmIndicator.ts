import { nStateLamp, type Box } from "@/lib/ote/parts";
import type { Theme } from "../theme";
import { assembly, INDICATOR, merge, shapedLamp } from "./shared";

/** A fault is a diamond that is only there while the fault is; a priority is a numbered square. `ground` is what it stands on. */
export function alarmIndicator(name: string, box: Box, theme: Theme, tags: { fault?: string; priority?: string }, ground?: number) {
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
    merge({ parts, wires }, shapedLamp(name, INDICATOR.fault(), box, theme, { tag: tags.fault, on: theme.tokens.alarmP1, ground }));
  }
  return { parts, wires };
}
