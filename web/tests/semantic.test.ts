/**
 * Semantic validation: whether the screen says what the plant is.
 * docs/PLAN_PHASE5.md §4.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lamp, numericDisplay, screenOf, textBox } from "@/lib/ote/parts";
import type { Part, Variable } from "@/lib/ote/schema";
import type { PackageInput } from "@/lib/ote/packager";
import { validateSemantics } from "@/lib/validation/semantic";
import { validateProject } from "@/lib/validation/rules";
import { runPipeline } from "@/lib/ai/pipeline";
import { parseTags } from "@/lib/tags/parse";
import { modelPlant } from "@/lib/plant/model";
import type { GenerationEvent } from "@/types/events";

const v = (Name: string, DataType: Variable["DataType"], Comments = ""): Variable => ({ Name, DataType, Comments, DeviceAddress: "" });

const VARIABLES = [
  v("PMP_101_RUN", "BOOL"),
  v("PMP_101_FLT", "BOOL"),
  v("PMP_101_START", "BOOL"),
  v("PMP_101_FLOW", "REAL", "Pump 1 flow LPM"),
  v("PMP_102_RUN", "BOOL"),
  v("TNK_201_LEVEL", "REAL", "Tank level percent"),
];

function project(parts: { part: Part; tag?: string }[], extra: Partial<PackageInput> = {}): PackageInput {
  const screen = screenOf("S1", parts.map((p) => p.part), { width: 1024, height: 768 });
  return {
    name: "t",
    target: { model: "HMIGTO6310", width: 1024, height: 768 },
    screens: [screen],
    variables: VARIABLES,
    alarms: [],
    wires: parts.flatMap(({ part, tag }) => (tag ? [{ part, tag, property: "CurrentValue", screenId: screen.UniqueId }] : [])),
    ...extra,
  };
}

const box = { left: 20, top: 100, width: 120, height: 24 };

describe("semantic validation", () => {
  it("catches the wrong measurement under the right number", () => {
    const findings = validateSemantics(
      project([
        { part: textBox("Ind_A_Lbl", "Tank 201 flow", box) },
        { part: numericDisplay("Ind_A_Val", { ...box, left: 200 }), tag: "TNK_201_LEVEL" },
      ]),
    );
    const metric = findings.filter((f) => f.rule === "semantic.metric");
    expect(metric).toHaveLength(1);
    expect(metric[0].message).toMatch(/TNK_201_LEVEL, which is a level, not a flow/);
  });

  it("leaves a label that names the right measurement alone", () => {
    const findings = validateSemantics(
      project([
        { part: textBox("Lbl_X", "Level", box) },
        { part: numericDisplay("Num_X", { ...box, left: 200 }), tag: "TNK_201_LEVEL" },
      ]),
    );
    expect(findings.filter((f) => f.rule === "semantic.metric")).toEqual([]);
  });

  it("catches one machine's lamp driven by another machine's tag", () => {
    const findings = validateSemantics(project([{ part: lamp("Lamp_PMP101_RUN", "STOPPED", "RUNNING", box), tag: "PMP_102_RUN" }]));
    const wrong = findings.filter((f) => f.rule === "semantic.wrongEquipment");
    expect(wrong).toHaveLength(1);
    expect(wrong[0].message).toMatch(/Lamp_PMP101_RUN belongs to Pump 101 but is driven by PMP_102_RUN/);
  });

  it("catches equipment on screen whose fault is shown nowhere and raises nothing", () => {
    const shown = project([{ part: lamp("Lamp_PMP101_RUN", "STOPPED", "RUNNING", box), tag: "PMP_101_RUN" }]);
    expect(validateSemantics(shown).some((f) => f.rule === "semantic.missingState" && f.tag === "PMP_101_FLT" && f.severity === "warning")).toBe(true);

    const alarmed: PackageInput = { ...shown, alarms: [{ Message: "Pump 101 fault", Trigger: "PMP_101_FLT", AlarmType: 1, AlarmRecordType: 1, Severity: 5, Value: "0" }] };
    expect(validateSemantics(alarmed).some((f) => f.tag === "PMP_101_FLT")).toBe(false);
  });

  it("says once, not per unit, which commands no screen controls", () => {
    const findings = validateSemantics(project([{ part: lamp("Lamp_PMP101_RUN", "STOPPED", "RUNNING", box), tag: "PMP_101_RUN" }]));
    const commands = findings.filter((f) => f.rule === "semantic.missingCommand");
    expect(commands).toHaveLength(1);
    expect(commands[0].message).toMatch(/1 unit has commands no screen controls: Pump 101/);
  });

  it("runs inside validateProject, headline check included, and uses the engineer's model when given", () => {
    const valve = [v("VLV_301_CMD", "BOOL"), v("PT_301_PV", "REAL", "Valve inlet pressure bar")];
    const shown = project([{ part: numericDisplay("Num_PT301", box), tag: "PT_301_PV" }], { variables: valve });
    expect(validateProject(shown).some((f) => f.rule === "model.classHeadline" && f.tag === "PT_301_PV")).toBe(true);
    // The engineer says it is a filter, which does lead with pressure.
    const corrected = modelPlant(valve);
    corrected.equipment = corrected.equipment.map((e) => (e.id === "VLV_301" ? { ...e, class: "filter" } : e));
    expect(validateProject({ ...shown, plant: corrected }).some((f) => f.rule === "model.classHeadline")).toBe(false);
  });

  it("finds nothing wrong with what the product generates", async () => {
    const variables = parseTags(readFileSync(join(process.cwd(), "..", "samples", "transfer-pump-station", "tags.csv")), "tags.csv").variables;
    const events: GenerationEvent[] = [];
    for await (const e of runPipeline({ intent: "transfer pump station", variables })) events.push(e);
    const warnings = events.filter((e) => e.type === "finding" && e.severity !== "info" && /is shown over|but is driven by|shown nowhere/.test(e.message));
    expect(warnings).toEqual([]);
  });
});
