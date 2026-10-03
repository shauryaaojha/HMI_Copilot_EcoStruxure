/**
 * One Screen Program for every screen, one panel from request to validation,
 * and the arithmetic the review found wrong. docs/PLAN_PHASE5.md.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { runPipeline } from "@/lib/ai/pipeline";
import { fallbackPlan, fitToLimits, limitsFor, readingsFromIntent } from "@/lib/ai/plan";
import { inferEquipment, proposeAlarms } from "@/lib/ai/infer";
import { capacityOf, gridFor, type ScreenSpec } from "@/lib/ote/layout";
import { syncVariables } from "@/lib/ote/databases";
import { modelPlant } from "@/lib/plant/model";
import { rangeFor } from "@/lib/plant/units";
import { orderReadings } from "@/lib/plant/classes";
import { architectPrograms, programOf } from "@/lib/program/program";
import { parseTags } from "@/lib/tags/parse";
import type { Variable } from "@/lib/ote/schema";
import type { GenerationEvent } from "@/types/events";

const sample = (name: string) =>
  parseTags(readFileSync(join(process.cwd(), "..", "samples", name, "tags.csv")), "tags.csv").variables;

async function run(intent: string, variables: Variable[], panel?: { model: string; width: number; height: number }) {
  const events: GenerationEvent[] = [];
  for await (const e of runPipeline({ intent, variables, panel })) events.push(e);
  const objects = events.filter((e): e is Extract<GenerationEvent, { type: "object" }> => e.type === "object");
  const logs = events.filter((e): e is Extract<GenerationEvent, { type: "log" }> => e.type === "log").map((e) => e.message);
  return { events, objects, logs };
}

describe("one reading order everywhere", () => {
  const roles = [
    { tag: "P_HRS", role: "hours" },
    { tag: "P_CUR", role: "current" },
    { tag: "P_FLOW", role: "flow" },
    { tag: "P_SPD", role: "speed" },
  ];

  it("leads with what the class leads with, then the declared order", () => {
    expect(orderReadings(roles, "pump").map((r) => r.tag)).toEqual(["P_FLOW", "P_SPD", "P_CUR", "P_HRS"]);
    expect(orderReadings(roles, "unknown-class").map((r) => r.tag)).toEqual(["P_HRS", "P_CUR", "P_FLOW", "P_SPD"]);
  });

  it("puts what the engineer asked for ahead of the class", () => {
    expect(orderReadings(roles, "pump", ["P_CUR", "P_HRS"]).map((r) => r.tag)).toEqual(["P_CUR", "P_HRS", "P_FLOW", "P_SPD"]);
  });

  it("reads the readings a sentence names, in the order it names them", () => {
    const units = inferEquipment(sample("transfer-pump-station"));
    const asked = readingsFromIntent("show the run hours and the discharge flow", units);
    expect(asked[0]).toMatch(/_HRS$/);
    expect(asked).toContain("FT_101_PV");
    expect(asked.indexOf("FT_101_PV")).toBeGreaterThan(asked.findIndex((t) => /_HRS$/.test(t)));
  });

  it("lets the request choose the process view's headline, not only the class", () => {
    const plant = modelPlant(sample("transfer-pump-station"));
    const plain = architectPrograms(plant).find((p) => p.process)!;
    const asked = architectPrograms(plant, { readings: ["PMP_101_HRS"] }).find((p) => p.process)!;
    const callout = (p: typeof plain) => p.process!.callouts.find((c) => c.equipment === "PMP_101")?.tag;
    expect(callout(asked)).toBe("PMP_101_HRS");
    expect(asked.readings).toEqual(["PMP_101_HRS"]);
    expect(plain.readings).toBeUndefined();
  });
});

describe("alarms are proposals in the reading's own units", () => {
  const tank = inferEquipment([
    { Name: "TNK_101_LEVEL", DataType: "REAL", Comments: "Tank level 0-6 m", DeviceAddress: "" },
  ]);

  it("puts Hi and HiHi at 85% and 95% of the range, not at the numbers 85 and 95", () => {
    const proposals = proposeAlarms(tank, () => ({ min: 0, max: 6 }));
    expect(proposals.map((p) => p.value)).toEqual(["5.1", "5.7"]);
  });

  it("keeps 85 and 95 on a percentage", () => {
    expect(proposeAlarms(tank).map((p) => p.value)).toEqual(["85", "95"]);
  });

  it("says proposed, not configured, in the build log", async () => {
    const { logs, events } = await run("transfer pump station", sample("transfer-pump-station"));
    expect(logs.some((m) => /^Proposed \d+ alarms/.test(m) && /confirmed/.test(m))).toBe(true);
    expect(logs.some((m) => /^Configured \d+ alarms/.test(m))).toBe(false);
    const step = events.find((e) => e.type === "step" && e.step === "alarms" && e.state === "done");
    expect(step && step.type === "step" ? step.detail : "").toMatch(/proposed$/);
  });
});

describe("a normal band nobody stated is marked", () => {
  it("is assumed on an export range and on a class default", () => {
    expect(rangeFor("Discharge pressure 0-16 bar", "pressure")).toMatchObject({ source: "export", band: "assumed", min: 0, max: 16 });
    expect(rangeFor("Discharge pressure bar", "pressure")).toMatchObject({ source: "class", band: "assumed" });
  });

  it("is listed as an assumption on the Plant Model", () => {
    const plant = modelPlant([{ Name: "PT_101_PV", DataType: "REAL", Comments: "Header pressure 0-16 bar", DeviceAddress: "" }]);
    expect(plant.assumptions.some((a) => /assumed normal band/.test(a) && a.includes("PT_101_PV"))).toBe(true);
  });
});

describe("a carried variable is never duplicated", () => {
  it("binds to the carried row instead of inserting a second one with its name", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run(
      'CREATE TABLE Variables ("UniqueId" TEXT PRIMARY KEY, "Name" TEXT, "DataType" TEXT, "Type" INT, "IsArray" INT, "Dimension" TEXT, "EnableVariableLength" INT, "Size" INT, "InitialValue" TEXT, "InputRange" INT, "Min" TEXT, "Max" TEXT, "Comments" TEXT, "Value" TEXT, "Order" INT, "ParentId" TEXT, "id" INT, "FolderId" TEXT, "RootParentId" TEXT, "Retentive" INT, "DataSharing" INT, "StringEncode" INT, "DeviceAddress" TEXT, "BaseAddress" INT, "IsSymbolVariable" INT)',
    );
    // An array the reader could not model, carried as it was.
    db.run(`INSERT INTO Variables ("UniqueId","Name","DataType","Order","IsArray") VALUES ('CARRIED-1','Recipe','INT',1,1)`);
    const ids = syncVariables(
      db,
      [
        { Name: "Recipe", DataType: "INT", Comments: "", DeviceAddress: "" },
        { Name: "PMP_101_RUN", DataType: "BOOL", Comments: "", DeviceAddress: "" },
      ],
      {},
    );
    const names = db.exec('SELECT "Name" FROM Variables')[0].values.map((r) => r[0]);
    expect(names.filter((n) => n === "Recipe")).toHaveLength(1);
    expect(ids.Recipe).toBe("CARRIED-1");
    expect(db.exec(`SELECT "IsArray" FROM Variables WHERE "Name" = 'Recipe'`)[0].values[0][0]).toBe(1);
    expect(names).toContain("PMP_101_RUN");
  });
});

describe("the panel is one object, request to validation", () => {
  const small = { model: "HMIGTO5310", width: 800, height: 480 };

  it("narrows the grid to the panel instead of running off its edge", () => {
    for (const level of [1, 2, 3] as const) {
      const grid = gridFor(level, small, true);
      expect(12 + grid.columns * grid.width + (grid.columns - 1) * 16).toBeLessThanOrEqual(small.width - 12);
    }
    expect(capacityOf(2, { width: 1024, height: 600 })).toBe(3);
    expect(capacityOf(2, { width: 1024, height: 768 })).toBe(6);
    expect(gridFor(2, { width: 320, height: 240 }, false).width).toBeLessThanOrEqual(296);
  });

  it("splits a screen that holds more than its level holds, keeping the name of the first", () => {
    const spec: ScreenSpec = { screenName: "Pumps", title: "Pumps", level: 2, include: ["a", "b", "c", "d", "e"], sections: ["status"] };
    const out = fitToLimits([spec], { 1: 12, 2: 2, 3: 1 });
    expect(out.map((s) => s.screenName)).toEqual(["Pumps", "Pumps_2", "Pumps_3"]);
    expect(out.flatMap((s) => s.include)).toEqual(spec.include);
  });

  it("builds every screen at the panel's size and validates as that panel", async () => {
    const { events, objects } = await run("transfer pump station", sample("transfer-pump-station"), small);
    for (const o of objects) {
      expect(o.part.Location.Left + (o.part.Width ?? 0)).toBeLessThanOrEqual(small.width);
      expect(o.part.Location.Top + (o.part.Height ?? 0)).toBeLessThanOrEqual(small.height);
    }
    const findings = events.filter((e) => e.type === "finding").map((e) => (e.type === "finding" ? e.message : ""));
    expect(findings.some((m) => /falls outside the screen area|larger than the/.test(m))).toBe(false);
    expect(findings.some((m) => m.includes("HMIST6500AWADI"))).toBe(false);
  });

  it("places every unit somewhere: the demo panel's three-card rows no longer drop the rest", async () => {
    const variables = sample("water-treatment");
    const units = inferEquipment(variables);
    const { objects, logs } = await run("water treatment", variables, { model: "HMIST6500AWADI", width: 1024, height: 600 });
    const names = new Set(objects.map((o) => o.part.Name));
    for (const unit of units) {
      const key = unit.id.replace(/[^A-Za-z0-9]/g, "");
      expect([...names].some((n) => n === `Card_${key}` || n === `Tile_${key}` || n === `Detail_${key}`), unit.id).toBe(true);
    }
    expect(logs.some((m) => /do not fit .* were left off/.test(m))).toBe(false);
  });
});

describe("every screen is a program", () => {
  it("carries the planner's decision whole", () => {
    const spec: ScreenSpec = { screenName: "Detail", title: "Pump 101", level: 3, include: ["PMP_101"], sections: ["status", "process"], readings: ["PMP_101_HRS"] };
    expect(programOf(spec)).toMatchObject({ name: "Detail", level: 3, faceplates: ["PMP_101"], sections: ["status", "process"], readings: ["PMP_101_HRS"], kpis: [] });
  });

  it("builds a level 3 detail when the sentence asks for one, with pushbuttons for start and stop", async () => {
    const variables = sample("transfer-pump-station");
    const plan = fallbackPlan("faceplate for PMP_101", inferEquipment(variables), limitsFor({ width: 1024, height: 768 }));
    const detail = plan.screens.find((s) => s.level === 3);
    expect(detail?.include).toEqual(["PMP_101"]);

    const { objects } = await run("faceplate for PMP_101", variables, { model: "HMIGTO6310", width: 1024, height: 768 });
    const on = objects.filter((o) => o.screenName === detail!.screenName).map((o) => o.part);
    expect(on.some((p) => p.Name === "Detail_PMP101")).toBe(true);
    const commands = on.filter((p) => p.Name.startsWith("DetailCmd_PMP101"));
    expect(commands.map((p) => p.Type)).toEqual(["Switch", "Switch"]);
    expect(commands.map((p) => (p.Type === "Switch" ? p.Release.Text : ""))).toEqual(["START", "STOP"]);
    expect(on.some((p) => p.Type === "TrendGraph" || p.Name.startsWith("DetailInd_"))).toBe(true);
    expect(on.some((p) => p.Name === "HdrLevel_" + detail!.screenName && p.Type === "TextBox" && /UNIT DETAIL/.test(p.Text))).toBe(true);
  });

  it("keeps the overview KPIs the architect found, instead of discarding them", async () => {
    // Two connected units: the architect finds a KPI overview. The fallback
    // plans its own overview for a plant this size, so the KPIs lead it.
    const variables = sample("boiler-house");
    expect(architectPrograms(modelPlant(variables)).find((p) => p.level === 1)?.kpis.length).toBeGreaterThan(0);
    const { objects, logs } = await run("boiler house", variables, { model: "HMIGTO6310", width: 1024, height: 768 });
    const kpiTiles = objects.filter((o) => o.part.Name.startsWith("Kpi_") && o.part.Type === "Rectangle");
    expect(kpiTiles.length).toBeGreaterThan(0);
    expect(new Set(kpiTiles.map((o) => o.screenName)).size).toBe(1);
    expect(logs.some((m) => /leads with \d+ KPI/.test(m))).toBe(true);
    // And never a second overview beside the planned one.
    const overviews = new Set(objects.filter((o) => o.part.Type === "TextBox" && /PLANT OVERVIEW/.test((o.part as { Text: string }).Text)).map((o) => o.screenName));
    expect(overviews.size).toBe(1);
  });

  it("puts the KPIs on a full overview and continues its tiles rather than dropping either", async () => {
    const variables = sample("water-treatment");
    const { objects } = await run("water treatment", variables, { model: "HMIST6500AWADI", width: 1024, height: 600 });
    const on = (screen: string) => objects.filter((o) => o.screenName === screen).map((o) => o.part.Name);
    expect(on("PlantOverview").some((n) => n.startsWith("Kpi_"))).toBe(true);
    const tiles = (screen: string) => on(screen).filter((n) => /^Tile_[A-Za-z0-9]+$/.test(n));
    expect(tiles("PlantOverview_2").length).toBeGreaterThan(0);
    expect(tiles("PlantOverview").length + tiles("PlantOverview_2").length).toBe(12);
  });
});
