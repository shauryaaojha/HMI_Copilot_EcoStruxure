/**
 * The op bugs a tester found through the connector (2026-11-12):
 *
 * - bindTag put a REAL tag on a Lamp, and only validate called it an error.
 * - setAction ignored its tag, so a button needed a second op to write a bit.
 * - duplicateObject ignored the name it was given, and dropped the copy 8 px
 *   off the original, on top of it.
 */
import { expect, it } from "vitest";
import { demoScreen, demoVariables } from "@/fixtures";
import { applyOps, type Op } from "@/core/ops";
import type { Screen } from "@/lib/ote/schema";
import { createProjectStore, DEFAULT_STANDARDS } from "@/store/project";

function storeOf(screens: Screen[]) {
  const store = createProjectStore();
  store.getState().hydrate({
    id: "p", name: "Tester", target: { model: "HMIST6500AWADI", width: 1024, height: 600 },
    screens: structuredClone(screens), activeScreenId: screens[0].UniqueId, variables: structuredClone(demoVariables),
    alarms: [], bindings: [], objectMeta: {}, screenPlacement: {}, standards: DEFAULT_STANDARDS, versions: [], chat: [], foreign: {},
  } as never);
  return store;
}
const parts = (store: ReturnType<typeof storeOf>) => store.getState().screens[0].Children[0].Children;

it("refuses a REAL tag on a lamp when it is bound, with what to use instead", () => {
  const store = storeOf([demoScreen]);
  const out = applyOps([{ op: "bindTag", target: "Lamp_PUMP1_RUN", tag: "FT_101_PV" } as Op], store);
  expect(out.applied).toEqual([]);
  expect(out.rejected[0].reason).toMatch(/Lamp and takes BOOL; FT_101_PV is REAL\. Use a NumericDisplay/);
  // A BOOL still binds.
  expect(applyOps([{ op: "bindTag", target: "Lamp_PUMP1_RUN", tag: "PMP_101_FLT" } as Op], store).applied).toHaveLength(1);
});

it("does not bind an addObject's tag that does not fit, and says so", () => {
  const store = storeOf([demoScreen]);
  const out = applyOps([{ op: "addObject", type: "Lamp", name: "Flow_Lamp", left: 560, top: 400, width: 40, height: 40, tag: "FT_101_PV" } as Op], store);
  expect(out.applied[0]).toMatch(/not bound: a Lamp takes BOOL and FT_101_PV is REAL/);
  const lamp = parts(store).find((p) => p.Name === "Flow_Lamp")!;
  expect(store.getState().bindings.some((b) => b.targetId === lamp.UniqueId)).toBe(false);
});

it("binds the bit a button writes when setAction names a tag, and refuses a tag that is not BOOL", () => {
  const store = storeOf([demoScreen]);
  applyOps([{ op: "addObject", type: "Switch", name: "Reset_Btn", left: 560, top: 400, width: 120, height: 44, text: "RESET" } as Op], store);
  const out = applyOps([{ op: "setAction", target: "Reset_Btn", action: "momentary", tag: "PMP_101_FLT" } as Op], store);
  expect(out.applied[0]).toContain("writing PMP_101_FLT");
  const btn = parts(store).find((p) => p.Name === "Reset_Btn")!;
  expect(store.getState().bindings.find((b) => b.targetId === btn.UniqueId)?.tag).toBe("PMP_101_FLT");
  expect(applyOps([{ op: "setAction", target: "Reset_Btn", action: "momentary", tag: "FT_101_PV" } as Op], store).rejected[0].reason).toMatch(/must be BOOL/);
});

it("names a duplicate as asked and puts it beside the original, not on top of it", () => {
  const store = storeOf([demoScreen]);
  applyOps([{ op: "addObject", type: "Lamp", name: "Run_Lamp", left: 560, top: 400, width: 40, height: 40 } as Op], store);
  const out = applyOps([{ op: "duplicateObject", target: "Run_Lamp", name: "Run_Lamp_2" } as Op], store);
  expect(out.rejected).toEqual([]);
  const copy = parts(store).find((p) => p.Name === "Run_Lamp_2")!;
  expect(copy).toBeDefined();
  // To its right, a gap away: not overlapping the original.
  expect(copy.Location).toEqual({ ...copy.Location, Left: 616, Top: 400 });
  // Placed where it was asked, when asked.
  applyOps([{ op: "duplicateObject", target: "Run_Lamp", name: "Run_Lamp_3", left: 700, top: 420 } as Op], store);
  expect(parts(store).find((p) => p.Name === "Run_Lamp_3")!.Location).toMatchObject({ Left: 700, Top: 420 });
});
