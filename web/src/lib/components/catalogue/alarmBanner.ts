import { z } from "zod";
import { alarmSummary, screenSwitch, surface } from "@/lib/ote/parts";
import type { ComponentDef } from "../types";
import { assembly, boxAt, stemOf } from "./shared";

const Props = z.object({ destination: z.string().optional() });

export const AlarmBanner: ComponentDef<z.infer<typeof Props>> = {
  kind: "AlarmBanner", variants: ["line", "table"],
  sizes: { S: { width: 320, height: 32 }, M: { width: 640, height: 32 }, L: { width: 1024, height: 40 } },
  states: [], roles: [], tokens: ["field", "line", "ink", "muted", "alarmP1", "alarmP2", "alarmP3", "alarmP4", "onAlarm"],
  props: Props, backends: ["parts"],
  expand(use, box, theme) {
    const { parts, wires, add } = assembly();
    const stem = stemOf(use);
    add(surface(`${stem}_Band`, box, theme.tokens.field));
    add(alarmSummary(`${stem}`, boxAt(box, 4, 0, box.width - 8, box.height)));
    if (use.props.destination) add(screenSwitch(`${stem}_Open`, use.props.destination, box));
    return { parts, wires };
  },
};
