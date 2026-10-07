/**
 * The ISA-18.2 rationalisation table, drafted from the machine library and
 * checked as a whole. The alarms are the ones the generator proposes for a
 * real sample plant, so the table is what an engineer would actually review.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inferEquipment, proposeAlarms } from "@/lib/ai/infer";
import { parseTags } from "@/lib/tags/parse";
import { DISTRIBUTION_MIN, rationalise } from "@/lib/alarms/rationalise";
import type { Alarm, Variable } from "@/lib/ote/schema";

const v = (Name: string, DataType: Variable["DataType"] = "BOOL", Comments = ""): Variable => ({ Name, DataType, Comments, DeviceAddress: "" });
const alarmsOf = (variables: Variable[]): Alarm[] =>
  proposeAlarms(inferEquipment(variables)).map((p) => ({ Message: p.message, Trigger: p.trigger, AlarmType: p.level, AlarmRecordType: p.kind === "bit" ? 1 : 2, Severity: p.severity, Value: p.value }));

describe("rationalising alarms", () => {
  it("drafts priority, consequence and action from the class's standard alarm", () => {
    const vars = [v("PMP_101_RUN"), v("PMP_101_FLT", "BOOL", "Pump 1 fault"), v("TNK_1_LEVEL", "REAL")];
    const r = rationalise(alarmsOf(vars), inferEquipment(vars));
    const fault = r.rows.find((x) => x.trigger === "PMP_101_FLT")!;
    expect(fault).toMatchObject({ on: "bit", priority: "high", source: "library", klass: "pump", suggestedSeverity: 7 });
    expect(fault.action).toMatch(/standby/);
    const hihi = r.rows.find((x) => x.trigger === "TNK_1_LEVEL" && x.on === "hihi")!;
    expect(hihi).toMatchObject({ priority: "high", source: "library" });
    expect(hihi.consequence).toMatch(/Overflow/);
    expect(r.rows.find((x) => x.trigger === "TNK_1_LEVEL" && x.on === "hi")?.priority).toBe("medium");
  });

  it("says when it cannot draft a record, instead of inventing one", () => {
    const alarms: Alarm[] = [{ Message: "Mystery", Trigger: "ZZZ_1", AlarmType: 2, AlarmRecordType: 1, Severity: 5, Value: "0" }];
    const r = rationalise(alarms, []);
    expect(r.rows[0]).toMatchObject({ source: "none", action: "", priority: "medium" });
    expect(r.findings[0]).toMatchObject({ severity: "warning", trigger: "ZZZ_1" });
    expect(r.findings[0].message).toMatch(/no defined operator action/);
  });

  it("flags a duplicate alarm and a severity its priority does not suggest", () => {
    const vars = [v("PMP_2_RUN"), v("PMP_2_FLT")];
    const alarms = alarmsOf(vars);
    const r = rationalise([...alarms, alarms[0]], inferEquipment(vars));
    expect(r.findings.some((f) => /raises the same bit alarm 2 times/.test(f.message))).toBe(true);
    expect(r.findings.some((f) => f.severity === "info" && /suggests 7/.test(f.message))).toBe(true);
  });

  it("checks the priority distribution only for a system large enough to have one", () => {
    const vars = Array.from({ length: DISTRIBUTION_MIN }, (_, i) => [v(`PMP_${i}_RUN`), v(`PMP_${i}_FLT`)]).flat();
    const big = rationalise(alarmsOf(vars), inferEquipment(vars));
    expect(big.distribution.total).toBe(DISTRIBUTION_MIN);
    expect(big.distribution.shares.high).toBe(1);
    expect(big.findings.some((f) => /100% of alarms are high priority/.test(f.message))).toBe(true);
    const small = rationalise(alarmsOf(vars.slice(0, 4)), inferEquipment(vars.slice(0, 4)));
    expect(small.findings.some((f) => /high priority/.test(f.message))).toBe(false);
  });

  it("drafts a table for a real sample plant", () => {
    const vars = parseTags(readFileSync(join(__dirname, "..", "public", "demo", "Plant_Tags.csv")), "Plant_Tags.csv").variables;
    const r = rationalise(alarmsOf(vars), inferEquipment(vars));
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.filter((x) => x.source === "library").length).toBeGreaterThan(0);
    expect(r.distribution.high + r.distribution.medium + r.distribution.low).toBe(r.rows.length);
  });
});

describe("the sign-off report", () => {
  it("carries the rationalisation table, labelled as a draft", async () => {
    const { renderReport } = await import("@/lib/validation/report");
    const vars = [v("PMP_101_RUN"), v("PMP_101_FLT", "BOOL", "Pump 1 fault")];
    const html = renderReport({
      project: { name: "P", target: { model: "M", width: 1024, height: 768 }, screens: [], variables: vars, alarms: alarmsOf(vars), wires: [] },
      findings: [],
    });
    expect(html).toContain("Alarm rationalisation (draft for sign-off)");
    expect(html).toMatch(/<td>PMP_101_FLT<\/td><td>high<\/td>/);
    expect(html).toMatch(/standby/);
  });
});
