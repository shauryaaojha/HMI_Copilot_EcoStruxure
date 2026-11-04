/**
 * S4: Plant > "Rebuild from tags" throws away the ranges the engineer typed.
 *
 * The button's title says "Rebuild from the tag list, keeping your answers and your
 * ranges" (src/components/plant/PlantScreen.tsx:305), but its onClick (line 306) is
 *   setPlant(modelPlant(variables, plant.answers, structure))
 * which keeps the answers only. answerQuestion (store/slices/tags.ts:43-59) has the
 * code that keeps engineer ranges and connections; the button does not use it.
 */
import { describe, expect, it } from "vitest";
import { createProjectStore } from "@/store/project";
import { modelPlant } from "@/lib/plant/model";
import { demoVariables } from "@/fixtures";

describe("rebuilding the plant model", () => {
  it("keeps a range the engineer set", () => {
    const store = createProjectStore();
    const s = () => store.getState();
    s().hydrate({ id: "p", name: "P", screens: [], variables: structuredClone(demoVariables) });
    s().setPlant(modelPlant(s().variables, {}));
    const e = s().plant!.equipment.find((x) => Object.keys(x.ranges).length > 0);
    expect(e, "fixture has no equipment with a range").toBeDefined();
    const tag = Object.keys(e!.ranges)[0];
    s().setRange(e!.id, tag, { max: 4321 });
    expect(s().plant!.equipment.find((x) => x.id === e!.id)!.ranges[tag].max).toBe(4321);

    // Exactly PlantScreen's "Rebuild from tags" onClick.
    s().setPlant(modelPlant(s().variables, s().plant!.answers, s().tagImport?.structure));

    const after = s().plant!.equipment.find((x) => x.id === e!.id)!.ranges[tag];
    expect(after.max, `"Rebuild from tags" promised to keep the range; ${tag}.max went from 4321 back to ${after.max} (${after.source})`).toBe(4321);
  });
});
