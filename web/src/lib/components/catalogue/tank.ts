import { z } from "zod";
import type { ComponentDef } from "../types";
import { alarmIndicator } from "./alarmIndicator";
import { assembly, barParts, boxAt, equipmentBody, label, reading, stemOf } from "./shared";

const Props = z.object({ label: z.string().default("Tank"), min: z.number().default(0), max: z.number().default(100),
  normalLow: z.number().default(20), normalHigh: z.number().default(80), units: z.string().default("%") });

export const Tank: ComponentDef<z.infer<typeof Props>> = {
  kind: "Tank", variants: ["vertical", "coneBottom", "horizontal"],
  sizes: { S: { width: 64, height: 96 }, M: { width: 96, height: 144 }, L: { width: 128, height: 192 } },
  states: ["disabled", "unknown"], alarmSlot: "topRight",
  roles: [{ role: "level", dataType: "REAL", required: true }, { role: "high", dataType: "BOOL", required: false },
    { role: "low", dataType: "BOOL", required: false }, { role: "temperature", dataType: "REAL", required: false }],
  tokens: ["equipmentLine", "equipmentStopped", "field", "normalBand", "processValue", "alarmLimit", "ink", "muted", "line", "alarmP1", "alarmP2", "alarmP3", "alarmP4", "onAlarm"],
  props: Props, backends: ["parts"],
  expand(use, box, theme) {
    const { parts, wires, add } = assembly();
    const stem = stemOf(use);
    const hasLabel = use.props.label !== "";
    const alarmTag = use.tags.high ?? use.tags.low;
    const alarmSize = alarmTag ? (box.width < 88 ? 16 : 24) : 0;
    const bodyWidth = Math.floor((box.width - 8 - (alarmSize ? alarmSize + 4 : 0)) / 4) * 4;
    const bodyHeight = box.height - (hasLabel ? 44 : 24);
    add(equipmentBody(`${stem}_Body`, boxAt(box, 4, 0, bodyWidth, bodyHeight), theme));
    const level = barParts(`${stem}_Level`, boxAt(box, 12, 8, bodyWidth - 16, bodyHeight - 16), theme, {
      tag: use.tags.level, min: use.props.min, max: use.props.max, normalLow: use.props.normalLow, normalHigh: use.props.normalHigh, vertical: true,
    });
    const offset = parts.length;
    parts.push(...level.parts);
    wires.push(...level.wires.map((wire) => ({ ...wire, index: wire.index + offset })));
    let y = bodyHeight;
    if (hasLabel) { add(label(`${stem}_Label`, use.props.label, boxAt(box, 0, y, box.width, 20), theme, "small")); y += 20; }
    add(reading(`${stem}_Value`, boxAt(box, 0, y, box.width - 28, 24), theme), use.tags.level);
    add(label(`${stem}_Unit`, use.props.units, boxAt(box, box.width - 28, y + 4, 28, 20), theme, "small"));
    if (alarmTag) {
      const alarm = alarmIndicator(`${stem}_Alarm`, boxAt(box, 4 + bodyWidth + 4, 0, alarmSize, alarmSize), theme, { fault: alarmTag });
      const start = parts.length;
      parts.push(...alarm.parts);
      wires.push(...alarm.wires.map((wire) => ({ ...wire, index: wire.index + start })));
    }
    return { parts, wires };
  },
};
