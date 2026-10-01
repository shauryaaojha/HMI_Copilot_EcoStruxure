/**
 * The live bar: a Rectangle with Animation.FillLevel, bound through a Scale
 * converter from the reading's range onto the 0-100 a fill takes - the
 * product's own recipe (Help/en/featureguide/bar_metergraph/fs01.htm), in the
 * row shapes the template corpus carries. docs/PLAN_PHASE5.md §5.
 */

import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { AnalogIndicator } from "@/lib/composites";
import { applyScale, scaleName, syncConverters } from "@/lib/ote/converters";
import { buildGraph } from "@/lib/ote/bindings";
import { readProject } from "@/lib/ote/reader";
import { packageProject, type PackageInput } from "@/lib/ote/packager";
import { Part } from "@/lib/ote/schema";
import { objectValues, tagValues } from "@/lib/sim/alarms";
import { validateProject } from "@/lib/validation/rules";

const FILE = path.join(__dirname, "..", "..", "demo_project", "HMICopilot_PumpStation.eote");
const demo = () => new Uint8Array(fs.readFileSync(FILE));

const indicator = (box = { left: 20, top: 100, width: 232, height: 64 }) =>
  AnalogIndicator.expand({ label: "Tank level", tag: "TNK_101_LEVEL", units: "m", min: 0, max: 6, normalLow: 1, normalHigh: 5, decimals: 1 }, box, "Ind_TNK");

async function entry(zip: Uint8Array, name: string) {
  const z = await JSZip.loadAsync(zip);
  const key = Object.keys(z.files).find((k) => k.toLowerCase() === name.toLowerCase())!;
  return z.files[key].async("uint8array");
}

describe("the indicator's bar", () => {
  it("is a Rectangle with FillLevel, empty at design time, with the band framed on it", () => {
    const { parts } = indicator();
    const bar = parts.find((p) => p.Name === "Ind_TNK_Bar")!;
    expect(bar.Type).toBe("Rectangle");
    expect(Part.parse(bar)).toMatchObject({ Animation: { FillLevel: { Enable: true, HorizontalFill: 0 } } });
    const band = parts.find((p) => p.Name === "Ind_TNK_Band")!;
    expect(band.Type === "Rectangle" && band.Fill).toEqual({ Type: 0 });
    // The band sits on the bar, from normalLow to normalHigh of its width.
    expect(band.Location.Top).toBe(bar.Location.Top);
    expect(band.Location.Left).toBeGreaterThan(bar.Location.Left);
    expect(band.Location.Left + band.Width).toBeLessThan(bar.Location.Left + bar.Width);
  });

  it("binds the value and the fill, the fill through a scale over the indicator's range", () => {
    const { parts, wires } = indicator();
    const fill = wires.find((w) => w.property === "Animation.FillLevel.HorizontalFill")!;
    expect(parts[fill.index].Name).toBe("Ind_TNK_Bar");
    expect(fill.converter).toEqual({ min: 0, max: 6 });
    expect(wires.some((w) => w.property === "CurrentValue" && parts[w.index].Name === "Ind_TNK_Val")).toBe(true);
  });

  it("fills a tall indicator from the bottom", () => {
    const { wires } = indicator({ left: 0, top: 0, width: 144, height: 184 });
    expect(wires.some((w) => w.property === "Animation.FillLevel.VerticalFill")).toBe(true);
  });

  it("keeps the bar and drops the scale when the box is short", () => {
    const short = indicator({ left: 0, top: 0, width: 300, height: 56 }).parts.map((p) => p.Name);
    expect(short).toContain("Ind_TNK_Bar");
    expect(short).not.toContain("Ind_TNK_Scale");
    const tall = indicator({ left: 0, top: 0, width: 300, height: 96 }).parts.map((p) => p.Name);
    expect(tall).toContain("Ind_TNK_Scale");
  });
});

describe("the converter", () => {
  it("is the runtime's arithmetic: a range onto 0-100, clamped", () => {
    expect(applyScale({ min: 0, max: 6 }, 3)).toBe(50);
    expect(applyScale({ min: 0, max: 6 }, 9)).toBe(100);
    expect(applyScale({ min: -50, max: 150 }, 0)).toBe(25);
    expect(scaleName({ min: -50, max: 1.5 })).toBe("HMIC_Scale_m50_1p5");
  });

  it("writes one Converters.db row per range, in the corpus's shape, and reuses it", async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('CREATE TABLE "Converters" ("UniqueId" TEXT NOT NULL PRIMARY KEY, "Name" TEXT NOT NULL, "Order" INTEGER NOT NULL, "ConverterType" TEXT NOT NULL, "Description" TEXT NULL, "Data" TEXT NULL)');
    db.run('CREATE UNIQUE INDEX "IX_Converters_Name" ON "Converters" ("Name")');
    db.run('CREATE UNIQUE INDEX "IX_Converters_Order" ON "Converters" ("Order")');
    const first = syncConverters(db, [{ min: 0, max: 6 }, { min: 0, max: 6 }, { min: 0, max: 16 }]);
    expect(first.inserted).toBe(2);
    const rows = db.exec('SELECT "Name", "Order", "ConverterType", "Data" FROM Converters ORDER BY "Order"')[0].values;
    expect(rows.map((r) => r[0])).toEqual(["HMIC_Scale_0_6", "HMIC_Scale_0_16"]);
    expect(rows[0][2]).toBe("Scale");
    expect(JSON.parse(String(rows[0][3]))).toMatchObject({ Type: "Converter", SubType: "Scale", Name: "HMIC_Scale_0_6", Order: 1, FromMin: 0, FromMax: 6, ToMin: 0, ToMax: 100 });
    const again = syncConverters(db, [{ min: 0, max: 6 }]);
    expect(again.inserted).toBe(0);
    expect(again.ids.HMIC_Scale_0_6).toBe(first.ids.HMIC_Scale_0_6);
  });

  it("is named on the binding row, one way, and refused when it was never written", () => {
    const { parts, wires } = indicator();
    const w = wires.map((x) => ({ part: parts[x.index], tag: x.tag, property: x.property, converter: x.converter }));
    const graph = buildGraph("SCREEN", w, { TNK_101_LEVEL: "VAR-1" }, [], { HMIC_Scale_0_6: "conv-1" });
    const row = graph.Bindings.find((b) => b.TargetProperty === "Animation.FillLevel.HorizontalFill")!;
    expect(row).toMatchObject({ ConverterId: "conv-1", ConverterName: "HMIC_Scale_0_6", Mode: 1, BindingText: "TNK_101_LEVEL.Value" });
    expect(graph.Bindings.find((b) => b.TargetProperty === "CurrentValue")).toMatchObject({ ConverterId: null, Mode: 2 });
    expect(() => buildGraph("SCREEN", w, { TNK_101_LEVEL: "VAR-1" })).toThrow(/HMIC_Scale_0_6/);
  });
});

describe("a bar in an opened project", () => {
  async function withBar() {
    const read = await readProject(demo());
    const screen = read.screens[0];
    const { parts, wires } = indicator();
    screen.Children[0].Children.push(...parts);
    const input: PackageInput = {
      name: read.name,
      target: read.target,
      screens: read.screens,
      variables: [...read.variables, { Name: "TNK_101_LEVEL", DataType: "REAL", Comments: "Tank level 0-6 m", DeviceAddress: "" }],
      alarms: read.alarms,
      wires: [...read.wires, ...wires.map((w) => ({ part: parts[w.index], tag: w.tag, property: w.property, screenId: screen.UniqueId, ...(w.converter ? { converter: w.converter } : {}) }))],
    };
    return { read, input, out: await packageProject(input, undefined, read.preserved) };
  }

  it("writes the converter into the file's own Converters.db and names it on the row", async () => {
    const { out } = await withBar();
    const SQL = await initSqlJs();
    const db = new SQL.Database(await entry(out, "Converters.db"));
    const [id, name] = db.exec('SELECT "UniqueId", "Name" FROM Converters')[0].values[0] as string[];
    expect(name).toBe("HMIC_Scale_0_6");
    const graph = JSON.parse(new TextDecoder().decode(await entry(out, "Bindings.dat")).replace(/^﻿/, ""));
    const row = graph.Bindings.find((b: { ConverterId: string | null }) => b.ConverterId);
    expect(row).toMatchObject({ ConverterId: id, ConverterName: "HMIC_Scale_0_6", TargetProperty: "Animation.FillLevel.HorizontalFill" });
    const target = graph.Targets[row.Target];
    expect(target).toMatchObject({ SubType: "Rectangle", ObjectFullName: "Ind_TNK_Bar" });
  });

  it("reads back as a bar, and writes back unchanged when nothing changed", async () => {
    const { out } = await withBar();
    const again = await readProject(out);
    const fill = again.wires.find((w) => w.property === "Animation.FillLevel.HorizontalFill")!;
    expect(fill.converter).toMatchObject({ min: 0, max: 6, toMin: 0, toMax: 100, name: "HMIC_Scale_0_6" });
    const bar = again.screens[0].Children[0].Children.find((p) => p.Name === "Ind_TNK_Bar")!;
    expect(bar.Type === "Rectangle" && bar.Animation?.FillLevel?.Enable).toBe(true);

    const third = await packageProject(
      { name: again.name, target: again.target, screens: again.screens, variables: again.variables, alarms: again.alarms, wires: again.wires },
      undefined,
      again.preserved,
    );
    for (const name of ["Converters.db", "Bindings.dat"]) {
      expect(Buffer.from(await entry(third, name)).equals(Buffer.from(await entry(out, name))), name).toBe(true);
    }
  });

  it("validates clean, and refuses a fill driven by a BOOL", async () => {
    const { input } = await withBar();
    expect(validateProject(input).filter((f) => f.severity === "error")).toEqual([]);
    const bool = { ...input, variables: input.variables.map((v) => (v.Name === "TNK_101_LEVEL" ? { ...v, DataType: "BOOL" as const } : v)) };
    expect(validateProject(bool).some((f) => f.rule === "type-mismatch" && /a fill takes a number/.test(f.message))).toBe(true);
  });
});

describe("the simulator", () => {
  const bindings = [
    { tag: "TNK_101_LEVEL", targetId: "a", targetName: "Ind_TNK_Val", property: "CurrentValue" },
    { tag: "TNK_101_LEVEL", targetId: "b", targetName: "Ind_TNK_Bar", property: "Animation.FillLevel.HorizontalFill", converter: { min: 0, max: 6 } },
  ];

  it("pushes the reading to the value and the percentage to the bar", () => {
    expect(objectValues(bindings, { TNK_101_LEVEL: 4.5 })).toEqual({ Ind_TNK_Val: 4.5, Ind_TNK_Bar: 75 });
  });

  it("never reads a percentage back as the tag", () => {
    expect(tagValues(bindings, { Ind_TNK_Bar: 75 })).toEqual({});
    expect(tagValues(bindings, { Ind_TNK_Val: 4.5, Ind_TNK_Bar: 75 })).toEqual({ TNK_101_LEVEL: 4.5 });
  });
});
