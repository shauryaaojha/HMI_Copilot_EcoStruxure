/**
 * S4: undoing the delete of a composite (an indicator, a KPI tile) brings its parts
 * back as loose parts; the composite record is gone for good.
 *
 * removeObjects (store/slices/objects.ts:421-436) deletes the composite through
 * withoutObjects, but the undo snapshot (EditSnapshot, store/state.ts:61-76;
 * editable_slice, store/internals.ts:22-34) does not hold `composites`. Undo restores
 * the parts, their objectMeta and bindings, and not the instance, so the inspector can
 * no longer edit it as an indicator and setCompositeProps no longer re-expands it.
 */
import { describe, expect, it } from "vitest";
import { createProjectStore } from "@/store/project";
import { demoScreen } from "@/fixtures";

describe("undo after deleting a composite", () => {
  it("restores the composite, not just its parts", () => {
    const store = createProjectStore();
    const s = () => store.getState();
    s().hydrate({ id: "c", name: "C", screens: [structuredClone(demoScreen)], activeScreenId: demoScreen.UniqueId });
    const screenId = s().screens[0].UniqueId;
    const id = s().addComposite(screenId, "AnalogIndicator", {}, { left: 40, top: 40, width: 200, height: 60 });
    const parts = s().composites[id].partIds;
    expect(parts.length).toBeGreaterThan(0);

    s().removeObjects(parts);
    expect(s().composites[id]).toBeUndefined();
    s().undo();

    const back = s().screens[0].Children[0].Children.filter((p) => parts.includes(p.UniqueId)).length;
    expect(back).toBe(parts.length);
    expect(s().composites[id], "the parts came back but the composite instance did not").toBeDefined();
  });
});
