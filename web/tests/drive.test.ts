/**
 * One machine named for what it is: the HMI Panel-1 rig's tags (an M251
 * running one ATV340), which follow no ISA-5.1 loop and used to come out as
 * twenty-one "instruments" over four overflow screens, START and STOP bits
 * on different pages, buttons that wrote nothing and readings an operator
 * could type into. samples/hmi-panel-1/README.md.
 */

import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { inferEquipment } from "@/lib/ai/infer";
import { fallbackPlan, finishPlan } from "@/lib/ai/plan";
import { buildGraph } from "@/lib/ote/bindings";
import { numericDisplay, screenSwitch, switchPart, BIT_OPERATION } from "@/lib/ote/parts";
import { linkScreens, packageProject } from "@/lib/ote/packager";
import { screenOf } from "@/lib/ote/parts";
import { readProject } from "@/lib/ote/reader";
import type { Variable } from "@/lib/ote/schema";

const CSV = path.join(__dirname, "..", "..", "samples", "hmi-panel-1", "tags.csv");
const rig: Variable[] = fs
  .readFileSync(CSV, "utf8")
  .split(/\r?\n/)
  .slice(1)
  .filter(Boolean)
  .map((line) => {
    const [Name, type] = line.split(",");
    const DataType = type === "Bool" ? "BOOL" : type === "String" ? "STRING" : "INT";
    return { Name, DataType, Comments: "", DeviceAddress: "" } as Variable;
  });
const v = (Name: string, DataType: Variable["DataType"] = "INT") => ({ Name, DataType, Comments: "", DeviceAddress: "" }) as Variable;

describe("a small machine's tags", () => {
  const units = inferEquipment(rig);
  const role = (tag: string) => units[0].roles.find((r) => r.tag === tag)?.role;

  it("are one variable speed drive, because a motor with a frequency is on one", () => {
    expect(units).toHaveLength(1);
    expect(units[0].kind).toBe("drive");
    expect(units[0].tags).toHaveLength(rig.length);
  });

  it("are read for what each signal does", () => {
    expect(role("Run_CMD")).toBe("command");
    expect(role("Stop_CMD")).toBe("command");
    expect(role("Flt_Reset")).toBe("reset");
    expect(role("AUTOMAN")).toBe("mode");
    expect(role("Running")).toBe("running");
    expect(role("Fault")).toBe("fault");
    expect(role("Frequency_Set")).toBe("setpoint");
    // Read back from the drive, never typed into.
    expect(role("Reference_Freq")).toBe("reference");
    expect(role("Drive_Thermal_State")).toBe("thermal");
    expect(role("Status_Reg")).toBe("word");
    expect(role("Ready_To_SwitchOn")).toBe("ready");
  });

  it("make one screen, the drive's faceplate", () => {
    const plan = fallbackPlan("drive screens", units);
    expect(plan.screens).toHaveLength(1);
    expect(plan.screens[0]).toMatchObject({ level: 3, include: [units[0].id] });
  });

  it("and a model's plan that splits the drive over three screens is merged back", () => {
    const unit = units[0];
    const tags = unit.roles.map((r) => r.tag);
    const plan = finishPlan({
      scope: "whole",
      rationale: "model",
      screens: [
        { screenName: "Overview", title: "Overview", level: 1, include: [unit.id], sections: ["status"] },
        { screenName: "Controls", title: "Controls", level: 2, include: [unit.id], sections: ["status"], readings: [tags[0]] },
        { screenName: "Trends", title: "Trends", level: 2, include: [unit.id], sections: ["process"], readings: [tags[1], "NOT_A_TAG"] },
      ],
    }, units);
    expect(plan.screens).toHaveLength(1);
    expect(plan.screens[0]).toMatchObject({ level: 3, include: [unit.id], readings: [tags[0], tags[1]] });
  });

  it("but two machines with no loop numbers stay two machines", () => {
    const plant = inferEquipment([v("Pump_Speed"), v("Pump_Run", "BOOL"), v("Fan_Speed"), v("Fan_Run", "BOOL"), v("Tank_Level")]);
    expect(plant.length).toBeGreaterThan(1);
  });

  it("and an ISA list is read by its loops as before", () => {
    const isa = inferEquipment([v("PMP_101_RUN", "BOOL"), v("PMP_101_SPD"), v("FT_101_PV"), v("TNK_102_LEVEL")]);
    expect(isa.map((u) => u.id).sort()).toEqual(["PMP_101", "TNK_102"]);
  });
});

describe("what an operator touches", () => {
  it("a push button is momentary and writes its bit through its click action", () => {
    const start = switchPart("Start", "START", { left: 0, top: 0, width: 100, height: 40 });
    expect(start.Type === "Switch" && start.ClickTrigger).toEqual({ OperationType: 1, Operation: BIT_OPERATION.momentary });
    const graph = buildGraph("s", [{ part: start, tag: "Run_CMD", property: "CurrentValue" }], { Run_CMD: "id" });
    expect(graph.Bindings[0]).toMatchObject({ TargetProperty: "ClickTrigger.Destination", Mode: 1, BindingText: "Run_CMD.Value" });
  });

  it("a reading cannot be typed into; a setpoint can", () => {
    expect(numericDisplay("Read", { left: 0, top: 0, width: 80, height: 24 })).toMatchObject({ IsInputModeEnabled: false });
    expect(numericDisplay("Set", { left: 0, top: 0, width: 80, height: 24 }, 0, true)).not.toHaveProperty("IsInputModeEnabled");
  });

  it("and a reading stays read-only when its project is opened again", async () => {
    const panel = { model: "HMIST6600", width: 1280, height: 800 };
    const screen = screenOf("Drive", [numericDisplay("Read", { left: 0, top: 0, width: 80, height: 24 })], panel);
    const back = await readProject(await packageProject({ name: "RO", target: panel, screens: [screen], variables: [], alarms: [], wires: [] }), "ro.eote");
    expect(JSON.stringify(back.screens[0])).toContain('"IsInputModeEnabled":false');
  });

  it("a navigation chip changes to its screen by the number the packager gave it", async () => {
    const box = { left: 0, top: 0, width: 100, height: 30 };
    const panel = { model: "HMIST6600", width: 1280, height: 800 };
    const a = screenOf("Drive", [screenSwitch("NavGo_Drive_1", "Alarms", box)], panel);
    const b = screenOf("Alarms", [screenSwitch("NavGo_Alarms_0", "Drive", box)], panel);
    expect(linkScreens(a, new Map([["Alarms", 7]])).Children[0].Children[0]).toMatchObject({ ClickTrigger: { OperationType: 4, Operation: 1, Screen: 7 } });

    const zip = await JSZip.loadAsync(await packageProject({ name: "Nav", target: panel, screens: [a, b], variables: [], alarms: [], wires: [] }));
    const read = async (id: string, file: string) => {
      const entry = Object.values(zip.files).find((f) => f.name.replace(/\\/g, "/").toLowerCase() === `screens/${id}/${file}`.toLowerCase())!;
      return JSON.parse((await entry.async("string")).replace(/^﻿/, ""));
    };
    const touch = (await read(a.UniqueId, "Screen.dat")).Children[0].Children[0];
    expect(touch.ClickTrigger).toEqual({ OperationType: 4, Operation: 1, Screen: (await read(b.UniqueId, "Metadata.dat")).Id });
  });
});
