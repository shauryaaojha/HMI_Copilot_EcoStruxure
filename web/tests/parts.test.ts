/**
 * The part-coverage track: Switch, N-StateLamp, StringDisplay.
 *
 * Each new part has to: parse the product's own property names (from the
 * captured examples), be constructible, render on the canvas, and survive the
 * read-write round trip of an opened project. The exhaustive switch in
 * parts/index.tsx is what makes the canvas compile only once it can draw the
 * part; these tests hold the rest. docs/PLAN_PHASE1.md item 7.
 */

import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Part, PART_TYPES, Screen } from "@/lib/ote/schema";
import { nStateLamp, stringDisplay, switchPart } from "@/lib/ote/parts";
import { partFromTool } from "@/components/canvas/newPart";
import { ScreenRenderer } from "@/components/canvas/ScreenRenderer";
import { readProject } from "@/lib/ote/reader";
import { packageProject } from "@/lib/ote/packager";
import { validateProject } from "@/lib/validation/rules";
import { demoScreen } from "@/fixtures";

const EXAMPLES = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "reference", "part_examples.json"), "utf8"),
) as Record<string, { source: string; example: Record<string, unknown> }>;

const FILE = path.join(__dirname, "..", "..", "demo_project", "HMICopilot_PumpStation.eote");

/** The captured example, moved from a grid cell onto the canvas. */
const absolute = (example: Record<string, unknown>) => ({
  ...example,
  Location: { Left: 10, Top: 20 },
  Width: (example.Width as number | undefined) ?? 120,
  Height: (example.Height as number | undefined) ?? 40,
});

const box = { left: 40, top: 320, width: 120, height: 40 };

describe("the product's own property names parse", () => {
  it("Switch", () => {
    const parsed = Part.safeParse(absolute(EXAMPLES.Switch.example));
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    if (parsed.success && parsed.data.Type === "Switch") {
      expect(parsed.data.ClickTrigger?.OperationType).toBe(2);
      expect(parsed.data.Release.Text).toBeDefined();
    }
  });

  it("N-StateLamp", () => {
    const parsed = Part.safeParse(absolute(EXAMPLES["N-StateLamp"].example));
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    if (parsed.success && parsed.data.Type === "N-StateLamp") {
      expect(parsed.data.NumberOfStates).toBe(3);
      expect(parsed.data.States).toHaveLength(3);
    }
  });

  it("StringDisplay", () => {
    const parsed = Part.safeParse(absolute(EXAMPLES.StringDisplay.example));
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    if (parsed.success && parsed.data.Type === "StringDisplay") {
      expect(parsed.data.DisplayLength).toBe(20);
    }
  });

  it("are listed in PART_TYPES, so the model and the toolbar know them", () => {
    expect(PART_TYPES).toEqual(expect.arrayContaining(["Switch", "N-StateLamp", "StringDisplay"]));
  });
});

describe("constructors and the toolbar", () => {
  it("build parts the schema accepts", () => {
    for (const part of [
      switchPart("Sw_Start", "START", box),
      nStateLamp("State_Pump", ["STOPPED", "RUNNING", "FAULT"], box),
      stringDisplay("Str_Batch", box),
    ]) {
      expect(Part.safeParse(part).success).toBe(true);
    }
  });

  it("caps an N-state lamp at sixteen faces and floors it at two", () => {
    const many = nStateLamp("S", Array.from({ length: 20 }, (_, i) => `S${i}`), box);
    expect(many.Type === "N-StateLamp" && many.States.length).toBe(16);
    const few = nStateLamp("S", ["only"], box);
    expect(few.Type === "N-StateLamp" && few.States.length).toBe(2);
  });

  it("gives the toolbar a part for each new tool", () => {
    for (const type of ["Switch", "N-StateLamp", "StringDisplay"] as const) {
      const part = partFromTool(type, box);
      expect(part.Type).toBe(type);
      expect(Part.safeParse(part).success).toBe(true);
    }
  });
});

describe("the canvas draws them", () => {
  const screenWith = (...parts: Part[]): Screen => {
    const screen = structuredClone(demoScreen);
    screen.Children[0].Children = [screen.Children[0].Children[0], ...parts];
    return screen;
  };
  const render = (screen: Screen, values?: Record<string, number | boolean | string>) =>
    renderToStaticMarkup(createElement(ScreenRenderer, { screen, selectedIds: [], values }));

  it("a switch at rest shows its Release face, pressed its Press face", () => {
    const sw = switchPart("Sw_Start", "START", box);
    const screen = screenWith(sw);
    expect(render(screen)).toContain("START");
    expect(render(screen, { Sw_Start: true })).toContain("START");
  });

  it("an N-state lamp shows the face the value picks", () => {
    const lamp = nStateLamp("State_Pump", ["STOPPED", "RUNNING", "FAULT"], box);
    const screen = screenWith(lamp);
    expect(render(screen)).toContain("STOPPED");
    expect(render(screen, { State_Pump: 2 })).toContain("FAULT");
    expect(render(screen, { State_Pump: 2 })).not.toContain("STOPPED");
    // Out of range: the Invalid face.
    expect(render(screen, { State_Pump: 9 })).toContain(">?<");
  });

  it("a string display shows the bound text, cut to its display length", () => {
    const str = stringDisplay("Str_Batch", box, 5);
    const screen = screenWith(str);
    expect(render(screen, { Str_Batch: "BATCH-2026-09" })).toContain("BATCH");
    expect(render(screen, { Str_Batch: "BATCH-2026-09" })).not.toContain("2026");
  });
});

describe("validation knows what drives them", () => {
  const variables = [
    { Name: "B", DataType: "BOOL" as const, Comments: "", DeviceAddress: "" },
    { Name: "I", DataType: "INT" as const, Comments: "", DeviceAddress: "" },
    { Name: "S", DataType: "STRING" as const, Comments: "", DeviceAddress: "" },
  ];
  const project = (part: Part, tag: string) => ({
    name: "t",
    target: { model: "x", width: 1024, height: 600 },
    screens: [{ ...structuredClone(demoScreen), Children: [{ ...demoScreen.Children[0], Children: [part] }] } as Screen],
    variables,
    alarms: [],
    wires: [{ part, tag, property: "CurrentValue" }],
  });

  const mismatches = (p: ReturnType<typeof project>) =>
    validateProject(p).filter((f) => f.rule === "type-mismatch").length;

  it("accepts the right type and flags the wrong one", () => {
    const sw = switchPart("Sw", "GO", box);
    expect(mismatches(project(sw, "B"))).toBe(0);
    expect(mismatches(project(sw, "S"))).toBeGreaterThan(0);

    const str = stringDisplay("Str", box);
    expect(mismatches(project(str, "S"))).toBe(0);
    expect(mismatches(project(str, "I"))).toBeGreaterThan(0);
  });
});

describe("they survive the round trip of an opened project", () => {
  it("come back equal after export and re-read", async () => {
    const read = await readProject(new Uint8Array(fs.readFileSync(FILE)));
    const added = [
      switchPart("Sw_Start", "START", { left: 40, top: 320, width: 120, height: 40 }),
      nStateLamp("State_Pump", ["STOPPED", "RUNNING", "FAULT"], { left: 180, top: 320, width: 160, height: 40 }),
      stringDisplay("Str_Batch", { left: 360, top: 320, width: 200, height: 36 }),
    ];
    read.screens[0].Children[0].Children.push(...added);
    const out = await packageProject(
      { name: read.name, target: read.target, screens: read.screens, variables: read.variables, alarms: read.alarms, wires: read.wires },
      undefined,
      read.preserved,
    );
    const again = await readProject(out);
    const back = again.screens[0].Children[0].Children;
    for (const part of added) {
      const found = back.find((p) => p.UniqueId === part.UniqueId);
      expect(found, part.Name).toEqual(Part.parse(part));
    }
    expect(again.carried.opaqueParts).toBe(0);
  });
});
