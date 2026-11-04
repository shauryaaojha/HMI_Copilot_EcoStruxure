/**
 * S5-02: the toolbar's Align buttons (CanvasToolbar.tsx:259-276) act on every
 * selected PART. Clicking a composite selects its whole family
 * (ScreenRenderer.tsx:522-529), so "Align left" on two analogue indicators
 * moves every label, value, scale and band of both to one x: the composites
 * are taken apart. store/slices/objects.ts:187-202 + store/edits.ts:53-92 align
 * part by part; nothing moves a composite (or a card with its contents) as a
 * unit, which is what lib/ote/tidy.ts moveSetOf already knows how to do.
 */
import { describe, expect, it } from "vitest";
import { inferEquipment } from "@/lib/ai/infer";
import { fallbackPlan } from "@/lib/ai/plan";
import { layoutApplication } from "@/lib/ote/layout";
import type { Screen, Variable } from "@/lib/ote/schema";
import { createProjectStore } from "@/store/project";

const PANEL = { width: 1024, height: 600 };
const tag = (Name: string, DataType: Variable["DataType"] = "BOOL"): Variable => ({ Name, DataType, Comments: "", DeviceAddress: "" });

describe("S5-02 align on a selection of whole composites", () => {
  it("moves each composite rigidly instead of stacking its members", () => {
    const variables = [101, 102, 103, 104, 105, 106, 107].flatMap((i) => [tag(`PMP_${i}_RUN`), tag(`PMP_${i}_FLT`), tag(`FT_${i}_PV`, "REAL")]);
    const equipment = inferEquipment(variables);
    const built = layoutApplication(fallbackPlan("plant", equipment).screens, equipment, PANEL);
    const store = createProjectStore();
    const screens: Screen[] = built.map((b) => b.screen);
    const at = built.findIndex((b) => b.composites.length >= 2);
    expect(at).toBeGreaterThanOrEqual(0);
    store.getState().hydrate({ id: "t", name: "T", target: { model: "HMIST6500AWADI", width: 1024, height: 600 }, screens, activeScreenId: screens[at].UniqueId, variables });
    for (const c of built.flatMap((b) => b.composites)) store.getState().registerComposite(c);

    const pair = built[at].composites.slice(0, 2);
    expect(pair.length).toBe(2);
    const ids = pair.flatMap((c) => c.partIds);
    const view = () => store.getState().screens[at].Children[0].Children;
    const offsets = (list: ReturnType<typeof view>) =>
      pair.map((c) => {
        const members = list.filter((p) => c.partIds.includes(p.UniqueId));
        const left = Math.min(...members.map((p) => p.Location.Left));
        return members.map((p) => p.Location.Left - left).join(",");
      });
    const before = offsets(view());

    // What a click on the first and a shift-click on the second select, then "Align left".
    store.getState().select(ids);
    store.getState().align(ids, "left");

    expect(offsets(view()), "each composite keeps its members' layout").toEqual(before);
  });
});
