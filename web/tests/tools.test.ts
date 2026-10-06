/**
 * The tools a model may call, and the router that calls them first.
 *
 * What is held here is what makes a tool layer trustworthy rather than
 * merely present: every tool is strict, read-only and bounded; a bad call
 * answers as text instead of throwing; the same call gives the same answer;
 * and the router picks the right tool from plain requests without a model.
 */

import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { TOOLS, TOOL_GUIDE, describeTool, prepare, routeTools, routedContext, runTool, type PreparedContext } from "@/lib/ai/tools";
import { scanProject } from "@/lib/knowledge/scan";
import { PART_TYPES } from "@/lib/ote/schema";
import type { ProjectKnowledge } from "@/lib/knowledge/scan";

const tags = [
  { name: "PMP_101_RUN", dataType: "BOOL", comment: "Transfer pump 1 running" },
  { name: "PMP_101_FLT", dataType: "BOOL", comment: "Transfer pump 1 fault" },
  { name: "LT_101_PV", dataType: "REAL", comment: "Break tank level" },
  { name: "VLV_202_POS", dataType: "REAL", comment: "Outlet valve position" },
  { name: "MIX_301_RUN", dataType: "BOOL", comment: "Agitator running" },
];
const objects = [{ handle: "o4", name: "Lamp_PMP101_RUN", type: "Lamp", screen: "s1", tag: "PMP_101_RUN" }];

let knowledge: ProjectKnowledge[] = [];
let ctx: PreparedContext;
beforeAll(async () => {
  const demo = path.join(__dirname, "..", "..", "demo_project");
  knowledge = await Promise.all(["HMICopilot_PumpStation.eote", "HMICopilot_Bars.eote"].map((n) => scanProject(new Uint8Array(fs.readFileSync(path.join(demo, n))), n)));
  ctx = prepare({ tags, objects, knowledge, targetParts: PART_TYPES, targetName: "OTE 4.4" });
});

describe("the registry", () => {
  it("gives every tool a strict, closed schema and a when-not as well as a when", () => {
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
    for (const t of TOOLS) {
      expect(t.schema.additionalProperties).toBe(false);
      expect(t.schema.required.sort()).toEqual(Object.keys(t.schema.properties).sort());
      expect(t.not.length, t.name).toBeGreaterThan(20);
      expect(describeTool(t)).toMatch(/Use when: .* Do not use: /);
      expect(TOOL_GUIDE).toContain(t.name);
    }
  });

  it("answers a bad call as text, never by throwing", () => {
    expect(runTool("delete_everything", {}, ctx)).toMatchObject({ isError: true, text: expect.stringMatching(/no tool called/) });
    expect(runTool("get_equipment", {}, ctx)).toMatchObject({ isError: true, text: "get_equipment needs id" });
    expect(runTool("find_tags", null, ctx).isError).toBe(true);
  });

  it("is deterministic and leaves the context untouched", () => {
    const before = JSON.stringify(ctx.tags) + JSON.stringify(ctx.objects);
    for (const t of TOOLS) {
      const input = Object.fromEntries(Object.entries(t.schema.properties).map(([k, p]) => [k, p.type === "array" ? [] : "pump"]));
      expect(runTool(t.name, input, ctx)).toEqual(runTool(t.name, input, ctx));
    }
    expect(JSON.stringify(ctx.tags) + JSON.stringify(ctx.objects)).toBe(before);
  });

  it("caps what one call can return", () => {
    const many = prepare({ tags: Array.from({ length: 300 }, (_, i) => ({ name: `PMP_${i}_RUN`, dataType: "BOOL", comment: "pump running" })), objects: [] });
    expect(runTool("find_tags", { query: "pump running" }, many).text.split("\n").length).toBeLessThanOrEqual(26);
  });
});

describe("each tool", () => {
  it("get_equipment describes a unit with its roles and the class's standard alarms", () => {
    const r = runTool("get_equipment", { id: "Pump 101" }, ctx).text;
    expect(r).toMatch(/^PMP_101: pump "Pump 101"/);
    expect(r).toContain("PMP_101_FLT = fault (BOOL)");
    expect(r).toMatch(/standard alarm: "Pump 101 fault" on fault, high priority/);
  });

  it("machine_class answers by plain name and lists the classes for an unknown one", () => {
    expect(runTool("machine_class", { kind: "control valve" }, ctx).text).toMatch(/^Control valve \(control-valve\)/);
    expect(runTool("machine_class", { kind: "filler" }, ctx).text).toMatch(/PackML/);
    expect(runTool("machine_class", { kind: "time machine" }, ctx).text).toMatch(/Classes: .*pump/);
  });

  it("binding_precedent reports support from the knowledge base, and says when there is none", () => {
    expect(runTool("binding_precedent", { tag: "PMP_777_RUN" }, ctx).text).toMatch(/Lamp\.CurrentValue: \d+ bindings in 2 projects/);
    expect(runTool("binding_precedent", { tag: "X" }, prepare({ tags: [], objects: [] })).text).toMatch(/knowledge base is empty/);
  });

  it("target_capabilities says yes and no", () => {
    expect(runTool("target_capabilities", { partType: "Lamp" }, ctx).text).toMatch(/^Lamp: yes/);
    expect(runTool("target_capabilities", { partType: "Hologram" }, ctx).text).toMatch(/^Hologram: no/);
  });

  it("example_screens finds finished screens by part type", () => {
    expect(runTool("example_screens", { partTypes: ["Lamp"], equipment: ["pump"] }, ctx).text).toMatch(/HMICopilot_/);
  });
});

describe("routing without a model", () => {
  const names = (request: string) => routeTools(request, ctx).map((c) => `${c.name}:${Object.values(c.input).join(",")}`);

  it("looks up equipment the request names", () => {
    expect(names("move the pump 101 card to the left")).toContain("get_equipment:PMP_101");
  });

  it("looks up a class the request wants to add, preferring the longer name", () => {
    const n = names("add a control valve faceplate for the outlet");
    expect(n).toContain("machine_class:control-valve");
    expect(n).not.toContain("machine_class:valve");
  });

  it("asks for precedent when a tag is to be shown", () => {
    expect(names("show VLV_202_POS on the overview")).toContain("binding_precedent:VLV_202_POS");
  });

  it("does nothing for a request that needs nothing", () => {
    expect(routeTools("make the title bigger", ctx)).toEqual([]);
  });

  it("renders its results as context lines with the reason", () => {
    const { lines } = routedContext("what alarms for Pump 101?", ctx);
    expect(lines[0]).toMatch(/^Looked up get_equipment\("PMP_101"\) because the request names Pump 101:/);
  });
});
