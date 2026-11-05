/**
 * S5-04: lib/backend/panels.ts offers HMISTU855 (320x240). layoutApplication
 * on it puts parts outside the panel, where SVG clips them and OTE shows them
 * cut off: the header title is 620 wide (lib/ote/layout.ts:284), the footer
 * label 500 wide (layout.ts:320) and a level 2 card 162 tall from y=84
 * (layout.ts:116, 148) on a 240-high panel. Measured: 8 parts on 3 screens.
 */
import { describe, expect, it } from "vitest";
import { inferEquipment } from "@/lib/ai/infer";
import { fallbackPlan } from "@/lib/ai/plan";
import { layoutApplication } from "@/lib/ote/layout";
import { PANELS } from "@/lib/backend/panels";
import type { Variable } from "@/lib/ote/schema";

const tag = (Name: string, DataType: Variable["DataType"] = "BOOL"): Variable => ({ Name, DataType, Comments: "", DeviceAddress: "" });

describe("S5-04 generated screens on every offered panel", () => {
  const variables = [101, 102, 103, 104, 105, 106, 107].flatMap((i) => [tag(`PMP_${i}_RUN`), tag(`PMP_${i}_FLT`), tag(`FT_${i}_PV`, "REAL"), tag(`PT_${i}_PV`, "REAL")]);
  const equipment = inferEquipment(variables);
  for (const panel of PANELS) {
    it(`keeps every part inside ${panel.model} ${panel.width}x${panel.height}`, () => {
      const built = layoutApplication(fallbackPlan("plant", equipment).screens, equipment, panel);
      const outside = built.flatMap((b) => b.parts).filter((p) =>
        p.Location.Left < 0 || p.Location.Top < 0 || p.Location.Left + (p.Width ?? 0) > panel.width || p.Location.Top + (p.Height ?? 0) > panel.height,
      );
      expect(outside.map((p) => `${p.Name} ${p.Location.Left},${p.Location.Top} ${p.Width}x${p.Height}`)).toEqual([]);
    });
  }
});
