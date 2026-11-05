import { z } from "zod";
import type { ComponentDef } from "../types";
import { assembly, barParts, boxAt, label, reading, stemOf } from "./shared";

export const BarProps = z.object({ label: z.string().default("Value"), units: z.string().default("%"),
  min: z.number().default(0), max: z.number().default(100), normalLow: z.number().optional(), normalHigh: z.number().optional(),
  setpoint: z.number().optional(), decimals: z.number().int().min(0).max(6).default(1) });

export const Bar: ComponentDef<z.infer<typeof BarProps>> = {
  kind: "Bar", variants: ["vertical", "horizontal", "deviation"],
  sizes: { S: { width: 48, height: 128 }, M: { width: 64, height: 184 }, L: { width: 96, height: 240 } },
  states: [], roles: [{ role: "value", dataType: "REAL", required: true }, { role: "setpoint", dataType: "REAL", required: false }],
  tokens: ["field", "line", "normalBand", "processValue", "alarmLimit", "setpoint", "ink", "muted"],
  props: BarProps, backends: ["parts"],
  expand(use, box, theme) {
    const { parts, wires, add } = assembly();
    const stem = stemOf(use);
    const vertical = use.variant === "vertical";
    add(label(`${stem}_Label`, use.props.label, boxAt(box, 0, 0, vertical ? box.width : box.width - 64, 20), theme, "small"));
    const track = vertical ? boxAt(box, 8, 24, box.width - 16, box.height - 52) : boxAt(box, 4, box.height - 12, box.width - 8, 12);
    const expanded = barParts(stem, track, theme, {
      tag: use.tags.value, min: use.props.min, max: use.props.max, normalLow: use.props.normalLow,
      normalHigh: use.props.normalHigh, setpoint: use.props.setpoint, vertical,
    });
    const start = parts.length;
    parts.push(...expanded.parts);
    wires.push(...expanded.wires.map((wire) => ({ ...wire, index: wire.index + start })));
    const value = vertical ? boxAt(box, 0, box.height - 24, box.width, 24) : boxAt(box, box.width - 64, 0, 64, 20);
    add(reading(`${stem}_Value`, value, theme, use.props.decimals), use.tags.value);
    return { parts, wires };
  },
};
