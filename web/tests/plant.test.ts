/**
 * The Plant Model. docs/ARCHITECTURE_SCREEN_QUALITY.md §3.1, Phase 3 item 3.
 *
 * Done when every sample plant models with at most one question and the
 * roles cover every faceplate tag - so the tests run the modeller over every
 * sample in the repository and over the demo files, and then check that
 * what the generator wires is what the model knows about.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { coveredTags, isAcyclic, modelPlant, PlantModel, rangeOf } from "@/lib/plant/model";
import { defaultRange, rangeFor, rangeInComment, unitOf } from "@/lib/plant/units";
import { parseTags } from "@/lib/tags/parse";
import { inferEquipment } from "@/lib/ai/infer";
import { fallbackPlan } from "@/lib/ai/plan";
import { layoutApplication } from "@/lib/ote/layout";
import { createProjectStore } from "@/store/project";
import { demoVariables } from "@/fixtures";

const PANEL = { model: "HMIGTO6310", width: 1024, height: 600 };

/** Every tag list in the repository: the eight samples and the demo files. */
function everyTagList(): { name: string; variables: ReturnType<typeof parseTags>["variables"] }[] {
  const out: { name: string; variables: ReturnType<typeof parseTags>["variables"] }[] = [];
  const samples = join(process.cwd(), "..", "samples");
  if (existsSync(samples)) {
    for (const slug of readdirSync(samples)) {
      const file = join(samples, slug, "tags.csv");
      if (existsSync(file)) out.push({ name: slug, variables: parseTags(readFileSync(file), "tags.csv").variables });
    }
  }
  const demo = join(process.cwd(), "public", "demo");
  for (const f of readdirSync(demo)) {
    if (/\.(csv|txt)$/i.test(f)) out.push({ name: f, variables: parseTags(readFileSync(join(demo, f)), f).variables });
  }
  return out;
}

describe("units and ranges from comments", () => {
  it("reads the unit an export writes in its comment", () => {
    expect(unitOf("Reactor 1 temperature (degC)", "value")).toBe("degC");
    expect(unitOf("Discharge flow m3/h", "flow")).toBe("m3/h");
    expect(unitOf("Storage tank 1 level percent", "level")).toBe("%");
    expect(unitOf("Pump 1 speed", "speed")).toBe("%");
  });

  it("reads a range an export states, and falls back to the class with a normal band inside it", () => {
    expect(rangeInComment("Boiler pressure 0-10 bar")).toEqual({ min: 0, max: 10 });
    expect(rangeInComment("Level 20..80 %")).toEqual({ min: 20, max: 80 });
    expect(rangeInComment("no numbers here")).toBeNull();
    const stated = rangeFor("Boiler pressure 0-10 bar", "value");
    expect(stated).toMatchObject({ min: 0, max: 10, units: "bar", source: "export" });
    expect(stated.normalLow).toBeGreaterThan(stated.min);
    expect(stated.normalHigh).toBeLessThan(stated.max);
    const fallback = rangeFor("Reactor 1 temperature (degC)", "value");
    expect(fallback).toMatchObject({ ...defaultRange("degC", "value"), source: "class" });
  });
});

describe("every sample plant models", () => {
  const lists = everyTagList();
  it("has the samples to model", () => {
    expect(lists.length).toBeGreaterThanOrEqual(8);
  });

  for (const { name, variables } of lists) {
    it(`${name}: a valid model, at most one question, every reading ranged, no cycle`, () => {
      const model = modelPlant(variables);
      expect(PlantModel.safeParse(model).success).toBe(true);
      expect(model.questions.length, `questions for ${name}`).toBeLessThanOrEqual(1);
      // Every numeric tag has a range with a unit or an honest empty unit, and a band inside it.
      for (const e of model.equipment) {
        for (const r of e.roles) {
          if (r.dataType === "BOOL" || r.dataType === "STRING") continue;
          const range = e.ranges[r.tag];
          expect(range, `${name}: ${r.tag} has no range`).toBeDefined();
          expect(range.min).toBeLessThan(range.max);
          expect(range.normalLow).toBeGreaterThanOrEqual(range.min);
          expect(range.normalHigh).toBeLessThanOrEqual(range.max);
        }
      }
      // Every connection joins two known pieces; the graph flows one way.
      const ids = new Set(model.equipment.map((e) => e.id));
      for (const c of model.connections) {
        expect(ids.has(c.from), c.from).toBe(true);
        expect(ids.has(c.to), c.to).toBe(true);
      }
      expect(isAcyclic(model)).toBe(true);
      // Every unit is in an area; every piece of equipment is in a unit.
      const areas = new Set(model.areas.map((a) => a.id));
      for (const u of model.units) expect(areas.has(u.area)).toBe(true);
      for (const e of model.equipment) expect(model.units.some((u) => u.id === e.unit && u.equipment.includes(e.id))).toBe(true);
      // Every tag is somewhere.
      const covered = coveredTags(model);
      for (const v of variables) expect(covered.has(v.Name), `${name}: ${v.Name} uncovered`).toBe(true);
    });
  }

  it("covers every tag the generator wires on a faceplate", () => {
    for (const { name, variables } of lists) {
      const model = modelPlant(variables);
      const equipment = inferEquipment(variables);
      const screens = layoutApplication(fallbackPlan("all", equipment).screens, equipment, PANEL);
      const covered = coveredTags(model);
      for (const laid of screens) for (const w of laid.wires) expect(covered.has(w.tag), `${name}: ${w.tag}`).toBe(true);
    }
  });

  it("re-models the same way with the same answers", () => {
    const model = modelPlant(demoVariables);
    expect(modelPlant(demoVariables, model.answers)).toEqual(model);
  });
});

describe("the question, and answering it", () => {
  /** Pumps in one loop range, the only tank in another: who feeds the pumps? */
  const tags = parseTags(
    Buffer.from(
      [
        "Name,DataType,Comment",
        "TNK_101_LEVEL,Real,Break tank level percent",
        "PMP_201_RUN,Bool,Transfer pump 1 running",
        "PMP_201_FLT,Bool,Transfer pump 1 fault",
        "PMP_202_RUN,Bool,Transfer pump 2 running",
        "FT_201_PV,Real,Transfer flow m3/h",
      ].join("\n"),
      "utf8",
    ),
    "tags.csv",
  ).variables;

  it("asks what feeds the movers, offering the sources it knows", () => {
    const model = modelPlant(tags);
    expect(model.questions).toHaveLength(1);
    expect(model.questions[0]).toMatchObject({ kind: "feeds", about: "2xx", options: ["TNK_101"] });
    expect(model.connections.some((c) => c.from === "TNK_101")).toBe(false);
  });

  it("turns the answer into engineer-confidence connections and stops asking", () => {
    const first = modelPlant(tags);
    const answered = modelPlant(tags, { [first.questions[0].id]: "TNK_101" });
    expect(answered.questions).toEqual([]);
    const fed = answered.connections.filter((c) => c.from === "TNK_101");
    expect(fed.map((c) => c.to).sort()).toEqual(["PMP_201", "PMP_202"]);
    for (const c of fed) expect(c).toMatchObject({ confidence: 1, source: "engineer" });
  });

  it("in the store: answers, ranges and connections survive a rebuild", () => {
    const store = createProjectStore();
    store.getState().hydrate({ id: "p", name: "Plant", target: PANEL, screens: [], variables: tags });
    store.getState().setPlant(modelPlant(tags));
    const q = store.getState().plant!.questions[0];
    // The flow meter's loop is the pump's, so the pump owns the reading.
    const owner = store.getState().plant!.equipment.find((e) => e.ranges["FT_201_PV"])!;
    expect(owner.id).toBe("PMP_201");
    store.getState().setRange(owner.id, "FT_201_PV", { max: 250, units: "m3/h" });
    store.getState().connect("PMP_202", "PMP_201");
    store.getState().answerQuestion(q.id, "TNK_101");
    const plant = store.getState().plant!;
    expect(plant.questions).toEqual([]);
    expect(rangeOf(plant, "FT_201_PV")).toMatchObject({ max: 250, source: "engineer" });
    expect(plant.connections.some((c) => c.from === "PMP_202" && c.to === "PMP_201" && c.source === "engineer")).toBe(true);
    store.getState().disconnect("PMP_202", "PMP_201");
    expect(store.getState().plant!.connections.some((c) => c.from === "PMP_202" && c.to === "PMP_201")).toBe(false);
  });
});

describe("the model's ranges reach the indicators", () => {
  it("a range the export states is the indicator's range", () => {
    const variables = parseTags(
      Buffer.from(["Name,DataType,Comment", "BLR_1_RUN,Bool,Boiler running", "PT_1_PV,Real,Boiler pressure 0-10 bar"].join("\n"), "utf8"),
      "tags.csv",
    ).variables;
    const model = modelPlant(variables);
    const equipment = inferEquipment(variables).map((u) => ({ ...u, ranges: model.equipment.find((e) => e.id === u.id)?.ranges }));
    const screens = layoutApplication(fallbackPlan("boiler", equipment).screens, equipment, PANEL);
    const indicator = screens.flatMap((s) => s.composites).find((c) => c.props.tag === "PT_1_PV");
    expect(indicator).toBeDefined();
    expect(indicator!.props).toMatchObject({ min: 0, max: 10, units: "bar" });
  });
});
