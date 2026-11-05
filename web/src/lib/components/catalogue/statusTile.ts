import { z } from "zod";
import { screenSwitch, surface } from "@/lib/ote/parts";
import type { ComponentDef } from "../types";
import { alarmIndicator } from "./alarmIndicator";
import { assembly, boxAt, equipmentBadge, label, reading, stemOf } from "./shared";

const Props = z.object({ label: z.string().default("Unit"), units: z.string().default(""), destination: z.string().optional(),
  words: z.tuple([z.string(), z.string()]).optional() });

export const StatusTile: ComponentDef<z.infer<typeof Props>> = {
  kind: "StatusTile", variants: ["state", "kpi", "alarmCount"],
  sizes: { S: { width: 120, height: 64 }, M: { width: 184, height: 96 }, L: { width: 240, height: 128 } },
  states: ["running", "stopped", "unknown"],
  roles: [{ role: "running", dataType: "BOOL", required: false }, { role: "fault", dataType: "BOOL", required: false }, { role: "value", dataType: "REAL", required: false },
    { role: "alarmCount", dataType: "INT", required: false }],
  tokens: ["field", "line", "ink", "muted", "processValue", "equipmentRunning", "equipmentStopped", "equipmentLine", "equipmentDisabled", "onDark", "alarmP1", "onAlarm"],
  props: Props, backends: ["parts"],
  expand(use, box, theme) {
    const { parts, wires, add } = assembly();
    const stem = stemOf(use);
    add(surface(stem, box, theme.tokens.field));
    const fault = use.tags.fault;
    add(label(`${stem}_Label`, use.props.label, boxAt(box, 8, 4, box.width - 16 - (fault ? 28 : 0), 24), theme));
    if (fault) {
      const alarm = alarmIndicator(`${stem}_FLT`, boxAt(box, box.width - 28, 4, 24, 24), theme, { fault });
      parts.push(...alarm.parts);
      wires.push(...alarm.wires.map((wire) => ({ ...wire, index: wire.index + parts.length - alarm.parts.length })));
    }
    const running = use.variant === "state" ? use.tags.running : undefined;
    let row = 32;
    const rowHeight = Math.min(24, Math.floor((box.height - row) / 4) * 4);
    if (running && rowHeight >= 16) {
      add(equipmentBadge(`${stem}_RUN`, boxAt(box, 8, row, box.width - 16, rowHeight), theme, use.props.words), running);
      row += 28;
    }
    const role = use.variant === "alarmCount" ? "alarmCount" : "value";
    const tag = use.tags[role];
    if (tag && row + 24 <= box.height) {
      const unitWidth = use.props.units ? 40 : 0;
      add(reading(`${stem}_Value`, boxAt(box, 8, row, box.width - 16 - unitWidth, 24), theme, 1), tag);
      if (use.props.units) add(label(`${stem}_Unit`, use.props.units, boxAt(box, box.width - 44, row + 4, 36, 20), theme, "small"));
    }
    if (use.props.destination) add(screenSwitch(`${stem}_Open`, use.props.destination, box));
    return { parts, wires };
  },
};
