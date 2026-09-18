/**
 * The Screen Program and the process view. docs/ARCHITECTURE_SCREEN_QUALITY.md
 * §3.4, Phase 3 item 4. The worked example in §7: the transfer pump station,
 * from twenty tags, as a process screen in flow order.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { modelPlant } from "@/lib/plant/model";
import { architectPrograms, ScreenProgram } from "@/lib/program/program";
import { layerOf, orderLayers, placeGraph } from "@/lib/program/topology";
import { compileProgram, specOf } from "@/lib/program/compile";
import { lintPack } from "@/lib/standard/lint";
import { parseTags } from "@/lib/tags/parse";
import { runPipeline } from "@/lib/ai/pipeline";
import { Part } from "@/lib/ote/schema";
import type { GenerationEvent } from "@/types/events";

const PANEL = { model: "HMIGTO6310", width: 1024, height: 600 };
const station = () =>
  parseTags(readFileSync(join(process.cwd(), "..", "samples", "transfer-pump-station", "tags.csv")), "tags.csv").variables;

describe("topology", () => {
  const nodes = ["TNK", "P1", "P2", "FT"];
  const edges = [
    { from: "TNK", to: "P1" },
    { from: "TNK", to: "P2" },
    { from: "P1", to: "FT" },
    { from: "P2", to: "FT" },
  ];

  it("layers by longest path from the source", () => {
    const layers = layerOf(nodes, edges);
    expect([...layers.entries()]).toEqual([["TNK", 0], ["P1", 1], ["P2", 1], ["FT", 2]]);
  });

  it("orders a layer by what feeds it and is deterministic", () => {
    expect(orderLayers(nodes, edges)).toEqual([["TNK"], ["P1", "P2"], ["FT"]]);
    expect(orderLayers([...nodes].reverse(), edges)).toEqual([["TNK"], ["P1", "P2"], ["FT"]]);
  });

  it("survives a cycle without looping", () => {
    expect(() => layerOf(["A", "B"], [{ from: "A", to: "B" }, { from: "B", to: "A" }])).not.toThrow();
  });

  it("places columns left to right on the grid with nothing overlapping", () => {
    const placed = placeGraph(nodes, edges, { left: 28, top: 92, width: 968, height: 400 }, { width: 176, height: 128 }, { column: 272, row: 208 });
    const byId = new Map(placed.map((p) => [p.id, p]));
    expect(byId.get("TNK")!.left).toBeLessThan(byId.get("P1")!.left);
    expect(byId.get("P1")!.left).toBeLessThan(byId.get("FT")!.left);
    expect(byId.get("P1")!.left).toBe(byId.get("P2")!.left);
    expect(byId.get("P1")!.top).toBeLessThan(byId.get("P2")!.top);
    for (const p of placed) {
      expect(p.left % 8).toBe(0);
      expect(p.top % 8).toBe(0);
    }
    for (let i = 0; i < placed.length; i += 1)
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i], b = placed[j];
        const apart = a.left + 176 <= b.left || b.left + 176 <= a.left || a.top + 128 <= b.top || b.top + 128 <= a.top;
        expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
      }
  });
});

describe("the architect", () => {
  it("writes one process program for the transfer pump station, in words", () => {
    const model = modelPlant(station(), Object.fromEntries(modelPlant(station()).questions.map((q) => [q.id, q.options[0]])));
    const programs = architectPrograms(model);
    for (const p of programs) expect(ScreenProgram.safeParse(p).success).toBe(true);
    const process = programs.filter((p) => p.process);
    expect(process.length).toBeGreaterThanOrEqual(1);
    const p = process[0];
    expect(p.process!.nodes.length).toBeGreaterThanOrEqual(2);
    expect(p.process!.edges.length).toBeGreaterThanOrEqual(1);
    // No coordinates anywhere in a program.
    expect(JSON.stringify(p)).not.toMatch(/"left"|"top"|"Left"|"Top"/);
  });

  it("declines a process view for a unit with nothing to connect", () => {
    const lonely = parseTags(Buffer.from("Name,DataType,Comment\nMTR_1_RUN,Bool,Motor running\nMTR_2_RUN,Bool,Motor 2 running", "utf8"), "t.csv").variables;
    expect(architectPrograms(modelPlant(lonely)).filter((p) => p.process)).toEqual([]);
  });
});

describe("the compiler", () => {
  const compiled = () => {
    const first = modelPlant(station());
    const model = modelPlant(station(), Object.fromEntries(first.questions.map((q) => [q.id, q.options[0]])));
    const programs = architectPrograms(model).filter((p) => p.process);
    const nav = programs.map(specOf);
    return { model, program: programs[0], laid: compileProgram(programs[0], model, PANEL, nav) };
  };

  it("draws every node as a symbol, every edge as a pipe, every reading as a callout, all inside the panel", () => {
    const { program, laid } = compiled();
    for (const p of laid.parts) {
      expect(Part.safeParse(p).success, p.Name).toBe(true);
      expect(p.Location.Left).toBeGreaterThanOrEqual(0);
      expect(p.Location.Top).toBeGreaterThanOrEqual(0);
      expect(p.Location.Left + p.Width).toBeLessThanOrEqual(PANEL.width);
      expect(p.Location.Top + p.Height).toBeLessThanOrEqual(PANEL.height);
    }
    const symbols = laid.composites.filter((c) => c.kind === "EquipmentSymbol");
    const indicators = laid.composites.filter((c) => c.kind === "AnalogIndicator");
    const pipes = laid.parts.filter((p) => p.Type === "Pipe");
    expect(symbols).toHaveLength(program.process!.nodes.length);
    expect(pipes).toHaveLength(program.process!.edges.length);
    // Callouts are the first thing given up to fit; when kept, every one is drawn.
    const kept = laid.notes?.some((n) => /callouts left off/.test(n)) ? 0 : program.process!.callouts.length;
    expect(indicators).toHaveLength(kept);
    // Symbols carry the running and fault tags; callouts are bound.
    const running = symbols.filter((s) => s.props.runTag);
    expect(running.length).toBeGreaterThan(0);
    if (kept > 0) for (const c of program.process!.callouts) expect(laid.wires.some((w) => w.tag === c.tag)).toBe(true);
  });

  it("puts the pipe between the two symbols it joins, left to right", () => {
    const { program, laid } = compiled();
    const edge = program.process!.edges[0];
    const from = laid.composites.find((c) => c.kind === "EquipmentSymbol" && c.name === `Sym_${edge.from.replace(/[^A-Za-z0-9]/g, "")}`)!;
    const to = laid.composites.find((c) => c.kind === "EquipmentSymbol" && c.name === `Sym_${edge.to.replace(/[^A-Za-z0-9]/g, "")}`)!;
    const partOf = (id: string) => laid.parts.find((p) => p.UniqueId === id)!;
    const a = partOf(from.partIds[0]);
    const b = partOf(to.partIds[0]);
    const pipe = laid.parts.find((p) => p.Type === "Pipe" && p.Name.includes(edge.from.replace(/[^A-Za-z0-9]/g, "")))!;
    expect(a.Location.Left).toBeLessThan(b.Location.Left);
    expect(pipe.Location.Left).toBeGreaterThanOrEqual(a.Location.Left + a.Width - 1);
    expect(pipe.Location.Left + pipe.Width).toBeLessThanOrEqual(b.Location.Left + 1);
  });

  it("lints clean on the pack and shares the frame", () => {
    const { laid } = compiled();
    const findings = lintPack({ name: "t", target: PANEL, screens: [laid.screen], variables: [], alarms: [], wires: [] });
    expect(findings.filter((f) => f.rule === "colour.abnormalOnly" || f.rule === "text.fontFloor")).toEqual([]);
    expect(laid.parts[0].Name).toMatch(/^Ground_/);
    expect(laid.parts.some((p) => p.Name.startsWith("Hdr_"))).toBe(true);
  });
});

describe("the pipeline, without a key", () => {
  it("adds the process view after the faceplates and lists it on every strip", async () => {
    const events: GenerationEvent[] = [];
    for await (const e of runPipeline({ intent: "transfer pump station", variables: station() })) events.push(e);
    const objects = events.filter((e): e is Extract<GenerationEvent, { type: "object" }> => e.type === "object");
    const screens = [...new Set(objects.map((o) => o.screenName))];
    const process = screens.filter((s) => /Process$/.test(s ?? ""));
    expect(process.length).toBeGreaterThanOrEqual(1);
    // Every screen's navigation strip names the process screen.
    for (const name of screens) {
      const labels = objects.filter((o) => o.screenName === name && o.part.Type === "TextBox" && o.part.Name.startsWith("NavLbl_")).map((o) => (o.part as { Text: string }).Text);
      expect(labels).toEqual(expect.arrayContaining(process));
    }
    const composites = events.filter((e) => e.type === "composite");
    expect(composites.some((c) => c.type === "composite" && c.kind === "EquipmentSymbol")).toBe(true);
    expect(events.some((e) => e.type === "plant")).toBe(true);
  });
});
