/**
 * Screens first, tags later (docs/HANDOFF_SCREENS_FIRST.md): a project drawn
 * before its tags exist is valid and exports, the binder proposes tags for its
 * objects once the tags arrive, the chat binds one the same way, and the
 * export writes the variables before the bindings that name them.
 */

import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { dryRun } from "@/lib/ai/applier";
import { fillBar, lamp, numericDisplay } from "@/lib/ote/parts";
import { packageProject } from "@/lib/ote/packager";
import { readProject } from "@/lib/ote/reader";
import type { Part, Screen, Variable } from "@/lib/ote/schema";
import { proposeBindings } from "@/lib/tags/binder";
import { validateProject } from "@/lib/validation/rules";
import { createProjectStore } from "@/store/project";

const FILE = path.join(__dirname, "..", "..", "demo_project", "HMICopilot_PumpStation.eote");
const tag = (Name: string, DataType: Variable["DataType"]): Variable => ({ Name, DataType, Comments: "", DeviceAddress: "" }) as Variable;
const bar = (name: string, top: number) =>
  fillBar(name, { left: 20, top, width: 200, height: 24 }, { fill: 0, back: 0xffffff, border: 0, vertical: false });

/** The demo project's first screen, emptied and given these parts. */
async function drawn(parts: Part[]) {
  const read = await readProject(new Uint8Array(fs.readFileSync(FILE)));
  const screen: Screen = structuredClone(read.screens[0]);
  screen.Children[0].Children = parts;
  return { read, screen };
}

async function entry(zip: JSZip, name: string) {
  const key = Object.keys(zip.files).find((k) => k.toLowerCase().endsWith(name.toLowerCase()))!;
  return { key, bytes: await zip.files[key].async("uint8array") };
}

describe("a project with no tags yet", () => {
  it("exports three unbound bars with zero Bindings rows, and validates without errors", async () => {
    const { read, screen } = await drawn([bar("Ind_A_Bar", 100), bar("Ind_B_Bar", 140), bar("Ind_C_Bar", 180)]);
    const input = { name: read.name, target: read.target, screens: [screen], variables: [], alarms: [], wires: [] };

    const out = await packageProject(input, undefined, read.preserved);
    const graph = JSON.parse(new TextDecoder().decode((await entry(await JSZip.loadAsync(out), "Bindings.dat")).bytes).replace(/^﻿/, ""));
    expect(graph.Bindings).toEqual([]);
    expect(validateProject(input).filter((f) => f.severity === "error")).toEqual([]);
  });

  it("reports an unbound lamp as a status until tags exist, and a warning after", async () => {
    const { read, screen } = await drawn([lamp("Lamp_P_101_Run", "Off", "On", { left: 20, top: 100, width: 24, height: 24 })]);
    const input = { name: read.name, target: read.target, screens: [screen], variables: [] as Variable[], alarms: [], wires: [] };
    const unbound = (v: Variable[]) => validateProject({ ...input, variables: v }).find((f) => f.rule === "binding");
    expect(unbound([])?.severity).toBe("info");
    expect(unbound([tag("P_101_RUN", "BOOL")])?.severity).toBe("warning");
  });
});

describe("the binder", () => {
  const tags = [
    tag("TNK_101_LEVEL", "REAL"), tag("TNK_101_TEMP", "REAL"), tag("TNK_102_LEVEL", "REAL"),
    tag("P_101_RUN", "BOOL"), tag("P_101_FAULT", "BOOL"), tag("P_101_START", "BOOL"),
    tag("P_102_RUN", "BOOL"), tag("P_102_FAULT", "BOOL"), tag("FT_201_FLOW", "REAL"),
    tag("PT_301_PRESSURE", "REAL"), tag("V_401_OPEN", "BOOL"), tag("V_402_OPEN", "BOOL"),
  ];
  const box = (top: number) => ({ left: 300, top, width: 60, height: 24 });

  it("proposes the four clear matches of twelve tags and leaves the two ambiguous objects unbound", async () => {
    const parts = [
      bar("Ind_TNK_101_Bar", 100),
      lamp("Lamp_P_101_Run", "Off", "On", box(100)),
      numericDisplay("Num_FT_201_Flow", box(140)),
      lamp("Lamp_Pump_B", "Off", "On", box(180)), // named by its intent only
      bar("Ind_TNK_Bar", 140), // two tanks have a level
      lamp("Lamp_Valve_Open", "Off", "On", box(220)), // two valves are open
    ];
    const { screen } = await drawn(parts);
    const intent = { [parts[3].UniqueId]: { bindIntent: "p_102_fault" } };

    const proposals = proposeBindings({ screens: [screen], variables: tags, bindings: [], objectMeta: intent });
    const picked = Object.fromEntries(proposals.filter((p) => p.tag).map((p) => [p.targetName, p.tag]));
    expect(picked).toEqual({
      Ind_TNK_101_Bar: "TNK_101_LEVEL",
      Lamp_P_101_Run: "P_101_RUN",
      Num_FT_201_Flow: "FT_201_FLOW",
      Lamp_Pump_B: "P_102_FAULT",
    });
    const left = proposals.filter((p) => !p.tag);
    expect(left.map((p) => p.targetName).sort()).toEqual(["Ind_TNK_Bar", "Lamp_Valve_Open"]);
    expect(left.every((p) => p.confidence === "low")).toBe(true);
    // A bar binds its fill, a lamp its value.
    expect(proposals.find((p) => p.targetName === "Ind_TNK_101_Bar")?.property).toBe("Animation.FillLevel.HorizontalFill");
  });

  it("proposes nothing before tags exist, and skips what is already bound", async () => {
    const parts = [lamp("Lamp_P_101_Run", "Off", "On", box(100))];
    const { screen } = await drawn(parts);
    expect(proposeBindings({ screens: [screen], variables: [], bindings: [], objectMeta: {} })).toEqual([]);
    const bound = [{ tag: "P_101_RUN", targetId: parts[0].UniqueId, targetName: "Lamp_P_101_Run", property: "CurrentValue" }];
    expect(proposeBindings({ screens: [screen], variables: tags, bindings: bound, objectMeta: {} })).toEqual([]);
  });
});

describe("binding from the chat", () => {
  it("binds a bar's fill and replaces an earlier tag, through the ordinary applier", async () => {
    const parts = [bar("Ind_TNK_Bar", 100)];
    const { screen } = await drawn(parts);
    const store = createProjectStore();
    store.getState().hydrate({
      id: "p", name: "Screens first", target: { model: "HMIGTO6310", width: 1024, height: 600 },
      screens: [screen], activeScreenId: screen.UniqueId,
      variables: [tag("TNK_101_LEVEL", "REAL"), tag("TNK_102_LEVEL", "REAL")],
    });
    const first = dryRun([{ op: "bindTag", target: "Ind_TNK_Bar", tag: "TNK_101_LEVEL", note: "n" }], store);
    expect(first.outcome.problems).toEqual([]);
    expect(first.patch.bindings).toEqual([
      { tag: "TNK_101_LEVEL", targetId: parts[0].UniqueId, targetName: "Ind_TNK_Bar", property: "Animation.FillLevel.HorizontalFill" },
    ]);
    store.setState({ bindings: first.patch.bindings });
    const again = dryRun([{ op: "bindTag", target: "Ind_TNK_Bar", tag: "TNK_102_LEVEL", note: "n" }], store);
    expect(again.patch.bindings.map((b) => b.tag)).toEqual(["TNK_102_LEVEL"]);
  });
});

describe("a screens-first export", () => {
  it("writes Variables.db before the Bindings that name its rows, one row per bound tag", async () => {
    const parts = [bar("Ind_A_Bar", 100), bar("Ind_B_Bar", 140), bar("Ind_C_Bar", 180)];
    const { read, screen } = await drawn(parts);
    const variables = [tag("A_LEVEL", "REAL"), tag("B_LEVEL", "REAL"), tag("C_LEVEL", "REAL")];
    const wires = parts.map((part, i) => ({ part, tag: variables[i].Name, property: "Animation.FillLevel.HorizontalFill", screenId: screen.UniqueId }));

    const zip = await JSZip.loadAsync(await packageProject({ name: read.name, target: read.target, screens: [screen], variables, alarms: [], wires }, undefined, read.preserved));
    const order = Object.keys(zip.files);
    const vars = await entry(zip, "Variables.db");
    const graph = await entry(zip, "Bindings.dat");
    expect(order.indexOf(vars.key)).toBeLessThan(order.indexOf(graph.key));

    const SQL = await initSqlJs();
    const db = new SQL.Database(vars.bytes);
    const ids = new Set((db.exec('SELECT "UniqueId" FROM Variables')[0]?.values ?? []).map(([id]) => String(id).toLowerCase()));
    const rows = JSON.parse(new TextDecoder().decode(graph.bytes).replace(/^﻿/, ""));
    expect(rows.Bindings).toHaveLength(3);
    expect(rows.Sources).toHaveLength(3);
    for (const source of rows.Sources) expect(ids.has(String(source.ObjectId).toLowerCase())).toBe(true);
  });
});
