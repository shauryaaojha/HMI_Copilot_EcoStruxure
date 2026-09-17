/**
 * The part-coverage track, second batch: ToggleSwitch, BarScale, Pipe,
 * DateTimeDisplay, TrendGraph, BlockTrend.
 *
 * Same contract as parts.test.ts: the product's own property names parse, a
 * constructor builds each one, the canvas draws it, validation knows what may
 * drive it, and it survives the round trip of an opened project - including
 * the nested configuration the schema does not model, which a trend carries
 * by the dozen. docs/PLAN_PHASE1.md, the list after item 7.
 */

import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Part, PART_TYPES, Screen } from "@/lib/ote/schema";
import {
  barScale,
  blockTrend,
  dateTimeDisplay,
  pipe,
  toggleSwitch,
  trendGraph,
} from "@/lib/ote/parts";
import { partFromTool, TOOLS } from "@/components/canvas/newPart";
import { ScreenRenderer } from "@/components/canvas/ScreenRenderer";
import { DESIGN_TIME } from "@/components/canvas/parts/DataParts";
import { readProject } from "@/lib/ote/reader";
import { packageProject } from "@/lib/ote/packager";
import { validateProject } from "@/lib/validation/rules";
import { demoScreen } from "@/fixtures";

const EXAMPLES = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "reference", "part_examples.json"), "utf8"),
) as Record<string, { source: string; example: Record<string, unknown> }>;

const FILE = path.join(__dirname, "..", "..", "demo_project", "HMICopilot_PumpStation.eote");

const NEW = ["ToggleSwitch", "BarScale", "Pipe", "DateTimeDisplay", "TrendGraph", "BlockTrend"] as const;

/** The captured example, moved from a grid cell onto the canvas. */
const absolute = (example: Record<string, unknown>) => ({
  ...example,
  Location: { Left: 10, Top: 20 },
  Width: (example.Width as number | undefined) ?? 120,
  Height: (example.Height as number | undefined) ?? 40,
});

const box = { left: 40, top: 320, width: 120, height: 40 };

describe("the product's own property names parse", () => {
  for (const type of NEW) {
    it(type, () => {
      const parsed = Part.safeParse(absolute(EXAMPLES[type].example));
      expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
      expect(parsed.success && parsed.data.Type).toBe(type);
    });
  }

  it("a trend keeps the scale configuration the schema does not model", () => {
    const parsed = Part.parse(absolute(EXAMPLES.TrendGraph.example));
    expect((parsed as Record<string, unknown>).DataScalesFull).toEqual(
      EXAMPLES.TrendGraph.example.DataScalesFull,
    );
    // The channel's Fill is {Type, Color} - the product's typed paint with the
    // colour beside the type - and comes back exactly as written.
    if (parsed.Type === "TrendGraph") {
      expect(parsed.Channels[0].Fill).toEqual({ Type: 1, Color: { Value: 4 } });
    }
  });

  it("a pipe's geometry is a list of locations, not a string", () => {
    const parsed = Part.parse(absolute(EXAMPLES.Pipe.example));
    if (parsed.Type === "Pipe") {
      expect(parsed.Path.Data).toHaveLength(2);
      expect(parsed.States).toHaveLength(2);
    }
  });

  it("are listed in PART_TYPES and each has a tool", () => {
    expect(PART_TYPES).toEqual(expect.arrayContaining([...NEW]));
    for (const type of NEW) expect(TOOLS.some((t) => t.type === type), type).toBe(true);
    // Every tool key is unique, or two tools fight for one key.
    const keys = TOOLS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("constructors and the toolbar", () => {
  it("build parts the schema accepts", () => {
    for (const part of [
      toggleSwitch("Tgl_Mode", "AUTO", "MANUAL", box),
      barScale("Scale_LT", { ...box, width: 40, height: 160 }, 250),
      pipe("Pipe_Suction", { ...box, width: 200, height: 12 }),
      pipe("Pipe_Riser", { ...box, width: 12, height: 200 }),
      dateTimeDisplay("Clock", box),
      trendGraph("Trend_Flow", ["FT_101_PV", "PT_101_PV"], { ...box, width: 400, height: 200 }),
      blockTrend("Blocks_Flow", ["FT_101_PV"], { ...box, width: 400, height: 200 }),
    ]) {
      const parsed = Part.safeParse(part);
      expect(parsed.success, part.Name + " " + JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    }
  });

  it("a pipe runs along the longer side of its box", () => {
    const header = pipe("H", { left: 0, top: 0, width: 200, height: 12 });
    const riser = pipe("V", { left: 0, top: 0, width: 12, height: 200 });
    if (header.Type === "Pipe" && riser.Type === "Pipe") {
      expect(header.Path.Data[0].Location.Top).toBe(header.Path.Data[1].Location.Top);
      expect(riser.Path.Data[0].Location.Left).toBe(riser.Path.Data[1].Location.Left);
    }
  });

  it("a trend names its tags inline and caps at sixteen channels", () => {
    const t = trendGraph("T", Array.from({ length: 20 }, (_, i) => `TAG_${i}`), box);
    if (t.Type === "TrendGraph") {
      expect(t.Channels).toHaveLength(16);
      expect(t.Channels[0].Variable).toBe("TAG_0");
    }
    const empty = trendGraph("E", [], box);
    if (empty.Type === "TrendGraph") {
      expect(empty.Channels).toHaveLength(1);
      expect(empty.Channels[0].Variable).toBeUndefined();
    }
  });

  it("gives the toolbar a part for each new tool", () => {
    for (const type of NEW) {
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

  it("a toggle shows Off at rest and On when the bit is set", () => {
    const screen = screenWith(toggleSwitch("Tgl", "AUTO", "MANUAL", box));
    expect(render(screen)).toContain("AUTO");
    expect(render(screen)).not.toContain("MANUAL");
    expect(render(screen, { Tgl: true })).toContain("MANUAL");
  });

  it("a scale labels its major ticks from zero to Max", () => {
    const html = render(screenWith(barScale("S", { ...box, width: 40, height: 160 }, 250)));
    for (const label of ["0", "50", "100", "150", "200", "250"]) expect(html).toContain(`>${label}<`);
    // Too narrow for labels: ticks only.
    const narrow = render(screenWith(barScale("N", { ...box, width: 15, height: 160 }, 250)));
    expect(narrow).not.toContain(">250<");
  });

  it("a pipe draws its state's colour and swaps on the bound value", () => {
    const screen = screenWith(pipe("P", { ...box, width: 200, height: 12 }));
    const rest = render(screen);
    const flowing = render(screen, { P: 1 });
    expect(rest).toContain("<polyline");
    expect(rest).not.toEqual(flowing);
    // Out of range: the Invalid state (red).
    expect(render(screen, { P: 7 })).toContain("#f77a84");
  });

  it("the clock shows the same instant on every render", () => {
    const screen = screenWith(dateTimeDisplay("Clock", box));
    expect(render(screen)).toContain(DESIGN_TIME);
    expect(render(screen)).toEqual(render(screen));
  });

  it("a trend draws one line per channel and names the tag in its legend", () => {
    const html = render(screenWith(trendGraph("T", ["FT_101_PV", "PT_101_PV"], { ...box, width: 400, height: 200 })));
    expect(html.match(/<polyline/g)).toHaveLength(2);
    expect(html).toContain("FT_101_PV");
    expect(html).toContain("PT_101_PV");
  });

  it("a block trend draws NumberOfDataPoints bars per channel", () => {
    const html = render(screenWith(blockTrend("B", ["FT_101_PV"], { ...box, width: 400, height: 200 }, 12)));
    // 12 bars, plus the frame and the legend swatch.
    expect(html.match(/<rect/g)!.length).toBeGreaterThanOrEqual(14);
  });
});

describe("validation knows what drives them", () => {
  const variables = [
    { Name: "B", DataType: "BOOL" as const, Comments: "", DeviceAddress: "" },
    { Name: "R", DataType: "REAL" as const, Comments: "", DeviceAddress: "" },
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

  it("a toggle takes a bit, a pipe takes a bit or an integer, neither takes a string", () => {
    const tgl = toggleSwitch("T", "OFF", "ON", box);
    expect(mismatches(project(tgl, "B"))).toBe(0);
    expect(mismatches(project(tgl, "R"))).toBeGreaterThan(0);
    const p = pipe("P", box);
    expect(mismatches(project(p, "B"))).toBe(0);
    expect(mismatches(project(p, "S"))).toBeGreaterThan(0);
  });
});

describe("they survive the round trip of an opened project", () => {
  it("come back equal after export and re-read, nested configuration included", async () => {
    const read = await readProject(new Uint8Array(fs.readFileSync(FILE)));
    const captured = Part.parse(absolute(EXAMPLES.TrendGraph.example));
    const added = [
      toggleSwitch("Tgl_Mode", "AUTO", "MANUAL", { left: 40, top: 320, width: 140, height: 56 }),
      barScale("Scale_LT", { left: 200, top: 320, width: 40, height: 160 }, 250),
      pipe("Pipe_Suction", { left: 260, top: 320, width: 200, height: 12 }),
      dateTimeDisplay("Clock", { left: 480, top: 320, width: 180, height: 32 }),
      trendGraph("Trend_Flow", ["FT_101_PV"], { left: 40, top: 400, width: 400, height: 180 }),
      blockTrend("Blocks_Flow", ["FT_101_PV"], { left: 460, top: 400, width: 400, height: 180 }),
      { ...captured, UniqueId: crypto.randomUUID(), Name: "Trend_Captured" } as Part,
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
