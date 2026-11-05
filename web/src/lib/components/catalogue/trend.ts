import { z } from "zod";
import { blockTrend, trendGraph } from "@/lib/ote/parts";
import type { ComponentDef } from "../types";
import { assembly, boxAt, label, stemOf } from "./shared";

const Props = z.object({ label: z.string().default("Trend") });

export const Trend: ComponentDef<z.infer<typeof Props>> = {
  kind: "Trend", variants: ["line", "sparkline", "block"],
  sizes: { S: { width: 96, height: 32 }, M: { width: 240, height: 120 }, L: { width: 480, height: 200 } },
  states: [], roles: [1, 2, 3, 4].map((n) => ({ role: `trend${n}`, dataType: "REAL" as const, required: n === 1 })),
  tokens: ["field", "line", "ink", "muted", "trend1", "trend2", "trend3", "trend4", "normalBand"],
  props: Props, backends: ["parts"],
  expand(use, box, theme) {
    const { parts, wires, add } = assembly();
    const stem = stemOf(use);
    const tags = [1, 2, 3, 4].map((n) => use.tags[`trend${n}`]).filter((tag): tag is string => !!tag);
    const spark = use.variant === "sparkline";
    if (!spark) add(label(`${stem}_Label`, use.props.label, boxAt(box, 0, 0, box.width, 20), theme));
    const part = use.variant === "block"
      ? blockTrend(`${stem}_Plot`, tags, boxAt(box, 0, 24, box.width, box.height - 24))
      : trendGraph(`${stem}_Plot`, tags, spark ? box : boxAt(box, 0, 24, box.width, box.height - 24));
    if (part.Type === "TrendGraph" || part.Type === "BlockTrend") {
      part.Channels = part.Channels.map((channel, i) => ({ ...channel, Stroke: { Color: { Value: theme.tokens[`trend${Math.min(i + 1, 4)}` as "trend1"] } } }));
      part.Fill = { Color: { Value: theme.tokens.field } };
      part.Border = { Type: 0 };
      if (part.Type === "TrendGraph") part.CursorLabelsEnabled = !spark;
    }
    add(part);
    return { parts, wires };
  },
};
