/**
 * The generate bugs a tester found through the connector (2026-11-12):
 *
 * - "one tank, one valve, one flow" drafted as three zero counts, and an
 *   energy meter was dropped as "no matching kind".
 * - A confirmed brief of five units built two pumps: every kind is numbered
 *   from 101, so read by name the tank, valve, flow and meter all folded into
 *   pump 101 (15 objects to pump 102's 9).
 * - Two rows of one kind both started at 101, and the second row's tags were
 *   dropped as duplicates.
 * - The overview and the unit screen held the same units.
 * - "validate failed", then "package done: ready to export".
 */
import { describe, expect, it, vi } from "vitest";
import { Brief, placeholderImport, requestFromBrief } from "@/lib/brief/brief";
import { coerceBrief } from "@/lib/brief/draft";
import { inferEquipment } from "@/lib/ai/infer";
import { runPipeline } from "@/lib/ai/pipeline";

const plant = Brief.parse({
  plant: { name: "Water feed skid" },
  units: [
    { id: "u1", kind: "pump", label: "Feed pump", count: 2, signals: ["RUN", "FLT", "START", "STOP"] },
    { id: "u2", kind: "tank", label: "Feed tank", count: 1, signals: ["PV", "HI", "LO"] },
    { id: "u3", kind: "valve", label: "Inlet valve", count: 1, signals: ["OPEN", "CLOSED", "FLT"] },
    { id: "u4", kind: "flow", label: "Feed flow", count: 1, signals: ["PV"] },
    { id: "u5", kind: "custom", label: "Energy meter", count: 1, signals: [], customSignals: [{ id: "KWH", type: "REAL" }] },
  ],
});

describe("a drafted brief", () => {
  it("reads 'one' and 'an' as counts the model left out, and keeps equipment outside the catalogue", () => {
    const said = "A skid with one tank, one valve, one flow meter and an energy meter";
    const brief = coerceBrief(
      {
        plant: { name: "Skid", purpose: "" },
        units: [
          { kind: "tank", label: "Tank", signals: ["PV"] },
          { kind: "valve", label: "Valve", signals: ["OPEN"] },
          { kind: "flow", label: "Flow", signals: ["PV"] },
          { kind: "custom", label: "Energy meter", signals: [], customSignals: [{ id: "kwh", type: "REAL", what: "energy" }] },
        ],
      },
      said,
    )!;
    expect(brief.units.map((u) => [u.kind, u.count])).toEqual([["tank", 1], ["valve", 1], ["flow", 1], ["custom", 1]]);
    expect(brief.units[3].customSignals).toEqual([{ id: "KWH", type: "REAL", what: "energy" }]);
  });
});

describe("a confirmed brief", () => {
  it("keeps every unit it confirmed as its own equipment", () => {
    const { variables, tagImport } = placeholderImport(plant, "form");
    const units = inferEquipment(variables, tagImport.structure);
    expect(units.map((u) => u.id)).toEqual(["PMP_101", "PMP_102", "LT_101", "XV_101", "FT_101", "ENE_101"]);
    expect(units.find((u) => u.id === "PMP_101")!.tags).toHaveLength(4);
  });

  it("numbers a second row of the same kind on from the first, so none of its tags are lost", () => {
    const two = Brief.parse({ ...plant, units: [plant.units[0], { id: "u6", kind: "pump", label: "Transfer pump", count: 1, signals: ["RUN", "FLT"] }] });
    const { variables } = placeholderImport(two, "form");
    expect(variables.filter((v) => v.Name.startsWith("PMP_103_")).map((v) => v.Name)).toEqual(["PMP_103_RUN", "PMP_103_FLT"]);
  });

  it("builds every unit, no screen twice, and does not call a build with errors ready to export", async () => {
    for (const k of ["AI_PROVIDER", "OPENAI_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY"]) vi.stubEnv(k, "");
    const { variables, tagImport } = placeholderImport(plant, "form");
    const screens: { name: string; faceplates: string[] }[] = [];
    const steps: Record<string, string> = {};
    for await (const e of runPipeline({ intent: requestFromBrief(plant), variables, structure: tagImport.structure, panel: { model: "HMIST6500AWADI", width: 1024, height: 600 } })) {
      if (e.type === "program") screens.push({ name: e.program.name, faceplates: e.program.faceplates ?? [] });
      if (e.type === "step" && e.detail) steps[e.step] = e.detail;
    }
    vi.unstubAllEnvs();
    expect(steps.select).toContain("6 of 6 units");
    const sets = screens.filter((s) => s.faceplates.length).map((s) => [...s.faceplates].sort().join(","));
    expect(new Set(sets).size).toBe(sets.length);
    expect(steps.package).toBe(steps.validate.startsWith("0 errors") ? "ready to export" : expect.stringContaining("to fix before export"));
  });
});
