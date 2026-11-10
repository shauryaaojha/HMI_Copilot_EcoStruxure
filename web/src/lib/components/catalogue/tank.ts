import { z } from "zod";
import type { ComponentDef } from "../types";
import { drum, maskPart, shapePart, vessel } from "@/lib/ote/shapes";
import { assembly, barParts, boxAt, INDICATOR, label, merge, reading, shapedLamp, stemOf } from "./shared";

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
    // The level is the product's own filling rectangle, seen through the vessel's outline.
    const body = boxAt(box, 4, 0, bodyWidth, bodyHeight);
    const outline = use.variant === "horizontal" ? drum(body.width / body.height) : vessel(body.width / body.height, use.variant === "coneBottom" ? "cone" : "dome");
    merge({ parts, wires }, barParts(`${stem}_Level`, body, theme, {
      tag: use.tags.level, min: use.props.min, max: use.props.max, normalLow: use.props.normalLow, normalHigh: use.props.normalHigh, vertical: true,
    }));
    add(maskPart(`${stem}_Plate`, outline, body, { fill: theme.tokens.ground, inset: 0 }));
    add(shapePart(`${stem}_Body`, outline, body, { border: theme.tokens.equipmentLine, thickness: theme.stroke.equipment }));
    let y = bodyHeight;
    if (hasLabel) { add(label(`${stem}_Label`, use.props.label, boxAt(box, 0, y, box.width, 20), theme, "small")); y += 20; }
    add(reading(`${stem}_Value`, boxAt(box, 0, y, box.width - 28, 24), theme), use.tags.level);
    add(label(`${stem}_Unit`, use.props.units, boxAt(box, box.width - 28, y + 4, 28, 20), theme, "small"));
    // A high limit points up at the top of the vessel, a low one points down at its foot.
    if (alarmSize && use.tags.high) merge({ parts, wires }, shapedLamp(`${stem}_Alarm`, INDICATOR.high(), boxAt(box, 4 + bodyWidth + 4, 0, alarmSize, alarmSize), theme, { tag: use.tags.high, on: theme.tokens.alarmP1 }));
    if (alarmSize && use.tags.low) merge({ parts, wires }, shapedLamp(use.tags.high ? `${stem}_AlarmLow` : `${stem}_Alarm`, INDICATOR.low(), boxAt(box, 4 + bodyWidth + 4, bodyHeight - alarmSize, alarmSize, alarmSize), theme, { tag: use.tags.low, on: theme.tokens.alarmP1 }));
    return { parts, wires };
  },
};
