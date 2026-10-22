/**
 * The screens-first workflow end to end, without a model: placeholder tags
 * drafted from a description, the ordinary generator building on them, the
 * export leaving them out, and the real export rebinding the screens when it
 * arrives. The model's answers for both calls are checked here too, since
 * they are only ever kept after that check.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coerceDraft, coerceMatches, draftByRules } from "@/lib/ai/draft";
import { inferEquipment } from "@/lib/ai/infer";
import { runPipeline } from "@/lib/ai/pipeline";
import { packageInputOf } from "@/lib/collab/package";
import { lamp, numericDisplay } from "@/lib/ote/parts";
import type { Variable } from "@/lib/ote/schema";
import { parseTagsFile } from "@/lib/tags/parse";
import { matchByRules } from "@/lib/tags/binder";
import { demoScreen } from "@/fixtures";
import { createProjectStore } from "@/store/project";
import type { GenerationEvent } from "@/types/events";

const INTENT = "A transfer pump station with two duty pumps, a break tank and a discharge flow meter";
const v = (Name: string, DataType: Variable["DataType"], Comments = ""): Variable => ({ Name, DataType, Comments, DeviceAddress: "" });

describe("drafting placeholder tags", () => {
  it("reads the units and their counts from the description", () => {
    const names = draftByRules(INTENT).map((t) => t.Name);
    expect(names.filter((n) => n.endsWith("_RUN"))).toEqual(["PMP_101_RUN", "PMP_102_RUN"]);
    expect(names).toContain("LT_101_PV");
    expect(names).toContain("FT_101_PV");
    expect(names.some((n) => n.startsWith("XV_"))).toBe(false);
  });

  it("names them the way the inference reads them", () => {
    const kinds = inferEquipment(draftByRules(INTENT)).map((e) => e.kind);
    expect(kinds.filter((k) => k === "pump")).toHaveLength(2);
  });

  it("keeps only legal, unique names from the model", () => {
    const kept = coerceDraft({
      tags: [
        { name: "PMP_101_RUN", dataType: "BOOL", comment: "Pump 1 running" },
        { name: "pmp_101_run", dataType: "BOOL", comment: "duplicate" },
        { name: "2ND PUMP", dataType: "BOOL", comment: "illegal name" },
        { name: "LT_101_PV", dataType: "STRINGY", comment: "unknown type" },
      ],
    });
    expect(kept.map((t) => t.Name)).toEqual(["PMP_101_RUN"]);
    expect(coerceDraft("not an object")).toEqual([]);
  });

  it("is enough for the ordinary generator to build bound screens", async () => {
    const events: GenerationEvent[] = [];
    for await (const e of runPipeline({ intent: INTENT, variables: draftByRules(INTENT) })) events.push(e);
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(events.filter((e) => e.type === "binding").length).toBeGreaterThan(0);
  });
});

describe("matching placeholders to the real export", () => {
  it("finds every drafted tag in a real export that uses the same convention", async () => {
    const file = fs.readFileSync(path.join(__dirname, "..", "public", "demo", "Transfer_Pumps.csv"));
    const { variables } = await parseTagsFile(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), "Transfer_Pumps.csv");
    const drafted = draftByRules(INTENT);
    const renames = matchByRules(drafted, variables);
    expect(renames.PMP_101_RUN).toBe("PMP_101_RUN");
    expect(renames.PMP_102_FLT).toBe("PMP_102_FLT");
    expect(renames.LT_101_PV).toBe("LT_101_PV");
    expect(renames.FT_101_PV).toBe("FT_101_PV");
  });

  it("renames across a different convention by comment, and leaves a tie alone", () => {
    const placeholders = [v("PMP_101_RUN", "BOOL", "Pump 1 running"), v("PMP_101_FLT", "BOOL", "Pump 1 fault"), v("XV_101_OPEN", "BOOL", "Valve 1 open")];
    const real = [
      v("P1_RUN_FB", "BOOL", "Transfer pump 1 running"), v("P1_FAULT", "BOOL", "Transfer pump 1 fault"),
      v("P2_RUN_FB", "BOOL", "Transfer pump 2 running"), v("VA_ZSO", "BOOL", "Inlet valve A open"), v("VB_ZSO", "BOOL", "Outlet valve B open"),
    ];
    expect(matchByRules(placeholders, real)).toEqual({ PMP_101_RUN: "P1_RUN_FB", PMP_101_FLT: "P1_FAULT" });
  });

  it("keeps a model's match only when the tag exists and the type fits", () => {
    const placeholders = [v("PMP_101_RUN", "BOOL"), v("FT_101_PV", "REAL"), v("LT_101_PV", "REAL")];
    const real = [v("P1_RUN", "BOOL"), v("F1_FLOW", "REAL")];
    const kept = coerceMatches(
      { matches: [{ placeholder: "PMP_101_RUN", tag: "P1_RUN" }, { placeholder: "FT_101_PV", tag: "P1_RUN" }, { placeholder: "LT_101_PV", tag: "INVENTED" }] },
      placeholders,
      real,
    );
    expect(kept).toEqual({ PMP_101_RUN: "P1_RUN" });
    expect(coerceMatches({}, placeholders, real)).toBeNull();
  });
});

describe("a project drawn against placeholders", () => {
  function drawn() {
    const screen = structuredClone(demoScreen);
    const run = lamp("Lamp_PMP_101_Run", "Off", "On", { left: 20, top: 100, width: 24, height: 24 });
    const flow = numericDisplay("Num_FT_101", { left: 60, top: 100, width: 80, height: 24 });
    screen.Children[0].Children = [run, flow];
    const store = createProjectStore();
    store.getState().hydrate({
      id: "p", name: "Screens first", target: { model: "HMIGTO6310", width: 1024, height: 600 },
      screens: [screen], activeScreenId: screen.UniqueId,
      variables: [v("PMP_101_RUN", "BOOL", "Pump 1 running"), v("FT_101_PV", "REAL", "Flow 1"), v("LT_101_HI", "BOOL", "Tank level 1 high")],
    });
    store.getState().importTags(store.getState().variables, { fileName: "Assumed", at: 0, corrections: [], skipped: [], summary: { total: 3 }, pending: true });
    store.setState({
      bindings: [
        { tag: "PMP_101_RUN", targetId: run.UniqueId, targetName: run.Name, property: "CurrentValue" },
        { tag: "FT_101_PV", targetId: flow.UniqueId, targetName: flow.Name, property: "CurrentValue" },
      ],
      alarms: [{ Message: "Tank high", Trigger: "LT_101_HI", AlarmType: 2, AlarmRecordType: 1, Severity: 5, Value: "" } as never],
    });
    return { store, run, flow };
  }

  it("exports the screens without the placeholders", () => {
    const { store } = drawn();
    const input = packageInputOf(store.getState());
    expect(input.variables).toEqual([]);
    expect(input.wires).toEqual([]);
    expect(input.alarms).toEqual([]);
    expect(input.screens[0].Children[0].Children).toHaveLength(2);
  });

  it("is rebound to the real tags on import, and what matched nothing is unbound with an intent", () => {
    const { store, run, flow } = drawn();
    const real = [v("P1_RUN_FB", "BOOL", "Pump 1 running"), v("TANK_HI", "BOOL", "Tank high")];
    store.getState().adoptTags(real, { fileName: "real.csv", at: 1, corrections: [], skipped: [], summary: { total: 2 } }, { PMP_101_RUN: "P1_RUN_FB", LT_101_HI: "TANK_HI" });

    const s = store.getState();
    expect(s.variables).toEqual(real);
    expect(s.tagImport?.pending).toBeUndefined();
    expect(s.bindings).toEqual([{ tag: "P1_RUN_FB", targetId: run.UniqueId, targetName: run.Name, property: "CurrentValue" }]);
    expect(s.alarms.map((a) => a.Trigger)).toEqual(["TANK_HI"]);
    expect(s.objectMeta[flow.UniqueId]?.bindIntent).toBe("Flow 1");
    // Now the export carries them.
    expect(packageInputOf(s).wires.map((w) => w.tag)).toEqual(["P1_RUN_FB"]);
  });
});
