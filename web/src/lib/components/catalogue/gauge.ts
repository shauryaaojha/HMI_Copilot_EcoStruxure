import { z } from "zod";
import type { ComponentDef } from "../types";
import { Bar, BarProps } from "./bar";

/** The arc stays a Bar until generated Arch parts have been benched. */
export const Gauge: ComponentDef<z.infer<typeof BarProps>> = {
  ...Bar, kind: "Gauge", variants: ["arc270", "arc180"],
  sizes: { S: { width: 64, height: 80 }, M: { width: 96, height: 120 }, L: { width: 144, height: 168 } },
  expand(use, box, theme, backend) {
    return Bar.expand({ ...use, kind: "Bar", variant: box.width < 96 ? "vertical" : "horizontal" }, box, theme, backend);
  },
};
