import { z } from "zod";
import { fillBar } from "@/lib/ote/parts";
import { arcBand, fit, maskPart, ring, shapePart } from "@/lib/ote/shapes";
import type { ComponentDef } from "../types";
import { Bar, BarProps } from "./bar";
import { assembly, boxAt, label, reading, stemOf } from "./shared";

/**
 * A ring that fills. The product animates one thing that grows, a Rectangle's
 * fill level, so the ring is that rectangle seen through a ring-shaped cut:
 * the value rises around it, and the number sits in the middle. Below 64 px
 * there is no room for a number in a ring, and it is a bar.
 */
export const Gauge: ComponentDef<z.infer<typeof BarProps>> = {
  ...Bar, kind: "Gauge", variants: ["arc270", "arc180", "ring"],
  sizes: { S: { width: 64, height: 80 }, M: { width: 96, height: 120 }, L: { width: 144, height: 168 } },
  tokens: [...Bar.tokens, "ground", "equipmentLine"],
  expand(use, box, theme, backend) {
    if (box.width < 64 || box.height < 80) return Bar.expand({ ...use, kind: "Bar", variant: "vertical" }, box, theme, backend);
    const { parts, wires, add } = assembly();
    const stem = stemOf(use);
    const min = use.props.min, max = use.props.max;
    const band = use.variant === "arc180" ? arcBand(180, 360, 0.7) : use.variant === "ring" ? ring(0.72) : arcBand(135, 405, 0.72);
    add(label(`${stem}_Label`, use.props.label, boxAt(box, 0, 0, box.width, 20), theme, "small"));
    const dial = fit(band, boxAt(box, 0, 24, box.width, box.height - 24));
    const middle = ((use.props.normalLow ?? min) + (use.props.normalHigh ?? max)) / 2;
    const fill = fillBar(`${stem}_Fill`, dial, { fill: theme.tokens.processValue, back: theme.tokens.field, border: theme.tokens.line, vertical: true,
      designValue: Math.max(0, Math.min(100, ((middle - min) / (max - min || 1)) * 100)) });
    if (fill.Type === "Rectangle") fill.Thickness = 0;
    add(fill, use.tags.value, "Animation.FillLevel.VerticalFill", { min, max });
    add(maskPart(`${stem}_Plate`, band, dial, { fill: theme.tokens.ground, inset: 0 }));
    add(shapePart(`${stem}_Ring`, band, dial, { border: theme.tokens.equipmentLine, thickness: theme.stroke.hairline }));
    // The number in the opening, on the ground it is cut from.
    const half = use.variant === "arc180";
    const value = reading(`${stem}_Value`, boxAt(dial, dial.width * 0.2, half ? dial.height - 24 : dial.height / 2 - 16, dial.width * 0.6, 24), theme, use.props.decimals);
    if (value.Type === "NumericDisplay") {
      value.Fill = { Color: { Value: theme.tokens.ground } };
      value.Font = { ...value.Font, Size: dial.width >= 120 ? theme.type.regular.value : theme.type.regular.label };
      value.TextLayout = { HorizontalAlignment: 2, VerticalAlignment: 64 };
    }
    add(value, use.tags.value);
    if (!half && dial.height >= 88) {
      const unit = label(`${stem}_Unit`, use.props.units, boxAt(dial, dial.width * 0.25, dial.height / 2 + 8, dial.width * 0.5, 16), theme, "small");
      if (unit.Type === "TextBox") { unit.TextLayout = { HorizontalAlignment: 2, VerticalAlignment: 64 }; unit.TextColor = { Color: { Value: theme.tokens.muted } }; }
      add(unit);
    }
    return { parts, wires };
  },
};
