/**
 * lib/refs: the rules for renaming tag references and for removing objects.
 * The coverage test fills every store field that holds a tag, renames them, and
 * checks that no placeholder name is left anywhere in the state. A new field
 * that holds a tag should be added to that test, or the test is out of date.
 */
import { describe, expect, it } from "vitest";
import { retagEquipment, retagRefs, withoutObjects } from "@/lib/refs";
import { lamp, numericDisplay } from "@/lib/ote/parts";
import type { Variable } from "@/lib/ote/schema";
import { demoScreen } from "@/fixtures";
import { createProjectStore } from "@/store/project";

const v = (Name: string, DataType: Variable["DataType"], Comments = ""): Variable => ({ Name, DataType, Comments, DeviceAddress: "" });
const ASSUMED = { fileName: "Assumed", at: 0, corrections: [], skipped: [], summary: { total: 2 }, pending: true };

describe("retagRefs", () => {
  const renames = { PMP_101_RUN: "P1_RUN" };
  const dropped = new Set(["FT_101_PV"]);

  it("renames tag fields and leaves text alone", () => {
    const node = { label: "PMP_101_RUN", tag: "PMP_101_RUN", runTag: "PMP_101_RUN" };
    expect(retagRefs(node, renames, dropped)).toEqual({ label: "PMP_101_RUN", tag: "P1_RUN", runTag: "P1_RUN" });
  });

  it("removes an unmatched tag field and an unmatched list item", () => {
    const node = { tag: "FT_101_PV", kpis: [{ tag: "FT_101_PV" }, { tag: "PMP_101_RUN" }] };
    expect(retagRefs(node, renames, dropped)).toEqual({ kpis: [{ tag: "P1_RUN" }] });
  });
});

describe("retagEquipment", () => {
  it("renames the tags of a unit and drops the unmatched ones", () => {
    const unit = { id: "PMP_101", kind: "pump", label: "Pump 101", tags: ["PMP_101_RUN", "FT_101_PV"] };
    expect(retagEquipment([unit], { PMP_101_RUN: "P1_RUN" }, new Set(["FT_101_PV"]))).toEqual([
      { ...unit, tags: ["P1_RUN"] },
    ]);
  });
});

describe("withoutObjects", () => {
  it("drops bindings and composites that point at removed parts, and keeps the rest", () => {
    const composites = {
      gone: { id: "gone", kind: "KpiTile", name: "", props: {}, screenId: "s", partIds: ["a", "b"] },
      kept: { id: "kept", kind: "KpiTile", name: "", props: {}, screenId: "s", partIds: ["c"] },
    };
    const bindings = [
      { tag: "X", targetId: "a" },
      { tag: "Y", targetId: "c" },
    ];
    const result = withoutObjects(bindings, composites, new Set(["a"]));
    expect(result.bindings).toEqual([{ tag: "Y", targetId: "c" }]);
    expect(Object.keys(result.composites)).toEqual(["kept"]);
  });
});

describe("coverage: no placeholder name survives an adoption", () => {
  it("renames every store field that holds a tag", () => {
    const screen = structuredClone(demoScreen);
    const run = lamp("Lamp_PMP_101_Run", "Off", "On", { left: 20, top: 100, width: 24, height: 24 });
    const flow = numericDisplay("Num_FT_101", { left: 60, top: 100, width: 80, height: 24 });
    screen.Children[0].Children = [run, flow];
    const store = createProjectStore();
    store.getState().hydrate({
      id: "p", name: "Coverage", target: { model: "HMIGTO6310", width: 1024, height: 600 },
      screens: [screen], activeScreenId: screen.UniqueId,
      variables: [v("PMP_101_RUN", "BOOL", "Pump 1 running"), v("FT_101_PV", "REAL", "Flow 1")],
    });
    store.getState().importTags(store.getState().variables, ASSUMED);
    store.setState({
      bindings: [
        { tag: "PMP_101_RUN", targetId: run.UniqueId, targetName: run.Name, property: "CurrentValue" },
        { tag: "FT_101_PV", targetId: flow.UniqueId, targetName: flow.Name, property: "CurrentValue" },
      ],
      alarms: [{ Message: "Pump", Trigger: "PMP_101_RUN", AlarmType: 2, AlarmRecordType: 1, Severity: 5, Value: "" } as never],
      composites: { c1: { id: "c1", kind: "KpiTile", name: "Kpi", props: { tag: "PMP_101_RUN" }, screenId: screen.UniqueId, partIds: [] } as never },
      programs: { s1: { kpis: [{ label: "Run", tag: "PMP_101_RUN", units: "", decimals: 0, trend: false }] } as never },
      equipment: [{ id: "PMP_101", kind: "pump", label: "Pump 101", tags: ["PMP_101_RUN"] }] as never,
    });

    store.getState().adoptTags([v("P1_RUN_FB", "BOOL", "Pump 1 running")], { fileName: "real.csv", at: 1, corrections: [], skipped: [], summary: { total: 1 } }, {
      PMP_101_RUN: "P1_RUN_FB",
    });

    const s = store.getState();
    const everything = JSON.stringify({ bindings: s.bindings, alarms: s.alarms, composites: s.composites, programs: s.programs, equipment: s.equipment });
    expect(everything).not.toContain("PMP_101_RUN");
    expect(everything).toContain("P1_RUN_FB");
    // FT_101_PV matched nothing: its binding is gone and the object keeps it as an intent.
    expect(s.bindings.map((b) => b.tag)).toEqual(["P1_RUN_FB"]);
    expect(s.objectMeta[flow.UniqueId]?.bindIntent).toBe("Flow 1");
  });
});
