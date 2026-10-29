/**
 * Adopting real tags into a project drawn against placeholders: the rename must
 * touch tag references only, and the whole path must survive a write and a
 * reopen of the .eote file, not only the store.
 */
import { describe, expect, it } from "vitest";
import { packageInputOf } from "@/lib/collab/package";
import { packageProject } from "@/lib/ote/packager";
import { readProject } from "@/lib/ote/reader";
import { lamp, numericDisplay } from "@/lib/ote/parts";
import type { Variable } from "@/lib/ote/schema";
import { demoScreen } from "@/fixtures";
import { createProjectStore } from "@/store/project";

const v = (Name: string, DataType: Variable["DataType"], Comments = ""): Variable => ({ Name, DataType, Comments, DeviceAddress: "" });
const ASSUMED = { fileName: "Assumed", at: 0, corrections: [], skipped: [], summary: { total: 2 }, pending: true };
const REAL = { fileName: "real.csv", at: 1, corrections: [], skipped: [], summary: { total: 2 } };

function drawn() {
  const screen = structuredClone(demoScreen);
  const run = lamp("Lamp_PMP_101_Run", "Off", "On", { left: 20, top: 100, width: 24, height: 24 });
  const flow = numericDisplay("Num_FT_101", { left: 60, top: 100, width: 80, height: 24 });
  screen.Children[0].Children = [run, flow];
  const store = createProjectStore();
  store.getState().hydrate({
    id: "p", name: "Screens first", target: { model: "HMIGTO6310", width: 1024, height: 600 },
    screens: [screen], activeScreenId: screen.UniqueId,
    variables: [v("PMP_101_RUN", "BOOL", "Pump 1 running"), v("FT_101_PV", "REAL", "Flow 1")],
  });
  store.getState().importTags(store.getState().variables, ASSUMED);
  store.setState({
    bindings: [
      { tag: "PMP_101_RUN", targetId: run.UniqueId, targetName: run.Name, property: "CurrentValue" },
      { tag: "FT_101_PV", targetId: flow.UniqueId, targetName: flow.Name, property: "CurrentValue" },
    ],
  });
  return { store, run, flow };
}

describe("adopting tags renames references, not text", () => {
  it("leaves a display string alone even when it equals a placeholder name", () => {
    const { store } = drawn();
    store.setState({
      composites: { c1: { id: "c1", kind: "KpiTile", name: "Kpi", props: { tag: "FT_101_PV", label: "FT_101_PV" }, screenId: "s", partIds: [] } as never },
    });
    store.getState().adoptTags([v("F1_FLOW", "REAL")], REAL, { FT_101_PV: "F1_FLOW" });
    const composite = store.getState().composites.c1 as unknown as { props: Record<string, string> };
    expect(composite.props.tag).toBe("F1_FLOW");
    expect(composite.props.label).toBe("FT_101_PV");
  });

  it("removes a reference whose placeholder matched nothing, rather than blanking it", () => {
    const { store } = drawn();
    store.setState({
      composites: { c1: { id: "c1", kind: "KpiTile", name: "Kpi", props: { tag: "FT_101_PV", label: "Flow" }, screenId: "s", partIds: [] } as never },
    });
    store.getState().adoptTags([v("TANK_HI", "BOOL")], REAL, {});
    const composite = store.getState().composites.c1 as unknown as { props: Record<string, unknown> };
    expect(composite.props).toEqual({ label: "Flow" });
  });

  it("renames equipment tags and drops the ones that matched nothing", () => {
    const { store } = drawn();
    store.setState({ equipment: [{ id: "PMP_101", kind: "pump", label: "Pump 101", tags: ["PMP_101_RUN", "FT_101_PV"] }] as never });
    store.getState().adoptTags([v("P1_RUN_FB", "BOOL")], REAL, { PMP_101_RUN: "P1_RUN_FB" });
    expect(store.getState().equipment).toEqual([{ id: "PMP_101", kind: "pump", label: "Pump 101", tags: ["P1_RUN_FB"] }]);
  });

  it("takes an unmatched reading out of a program's list and keeps the rest", () => {
    const { store } = drawn();
    const program = { kpis: [{ label: "Flow", tag: "FT_101_PV", units: "m3/h", decimals: 1, trend: true }, { label: "Run", tag: "PMP_101_RUN", units: "", decimals: 0, trend: false }] };
    store.setState({ programs: { s1: program } as never });
    store.getState().adoptTags([v("P1_RUN_FB", "BOOL")], REAL, { PMP_101_RUN: "P1_RUN_FB" });
    const kept = (store.getState().programs.s1 as unknown as { kpis: { tag: string }[] }).kpis;
    expect(kept.map((k) => k.tag)).toEqual(["P1_RUN_FB"]);
  });
});

describe("the placeholder path survives a write and a reopen", () => {
  it("assumed tags never reach the file, and the real export binds the screens after a reopen", async () => {
    const { store, run } = drawn();

    // 1. Written while the tags are still assumed.
    const first = await packageProject(packageInputOf(store.getState()));
    const reopened = await readProject(first, "drawn.eote");
    expect(reopened.variables).toEqual([]);
    expect(reopened.wires).toEqual([]);

    // 2. The real export arrives and the placeholders are matched.
    store.getState().adoptTags([v("P1_RUN_FB", "BOOL", "Pump 1 running")], REAL, { PMP_101_RUN: "P1_RUN_FB" });
    const second = await packageProject(packageInputOf(store.getState()));
    const bound = await readProject(second, "drawn.eote");

    expect(bound.variables.map((x) => x.Name)).toEqual(["P1_RUN_FB"]);
    expect(bound.wires.map((w) => w.tag)).toEqual(["P1_RUN_FB"]);
    expect(store.getState().objectMeta[run.UniqueId]).toBeUndefined();
  });
});
