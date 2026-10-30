/**
 * What we add to an opened project is drawn with the project's own objects.
 * On the Panel-1 rig a push button is a Pro-face Compound Object bound
 * through its exposed `CV`, not a Switch. lib/ote/exemplars.ts.
 */

import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readProject } from "@/lib/ote/reader";
import { harvest, nativise, partsOf } from "@/lib/ote/exemplars";
import { numericDisplay, screenOf, switchPart, toggleSwitch } from "@/lib/ote/parts";
import { OTE } from "@/lib/backend/ote";
import type { Wire } from "@/lib/ote/bindings";

const FILE = path.join(__dirname, "..", "..", "samples", "hmi-panel-1", "auto-manual.eote");
const rig = () => readProject(new Uint8Array(fs.readFileSync(FILE)), "auto-manual.eote");

const json = async (zip: JSZip, test: (name: string) => boolean) => {
  const f = Object.values(zip.files).filter((x) => test(x.name.replace(/\\/g, "/")));
  return Promise.all(f.map(async (x) => JSON.parse((await x.async("string")).replace(/^﻿/, ""))));
};

// The project is local only: it carries the rig's PLC connection.
describe.skipIf(!fs.existsSync(FILE))("the project's own objects", () => {
  it("are found by the role of the tag each is bound to, with how it is bound", async () => {
    const read = await rig();
    const own = harvest(read.preserved, read.variables);
    expect(own.pushbutton).toMatchObject({ tag: "Run_CMD", property: "CV", mode: 2, uses: 3 });
    expect(own.pushbutton!.raw.Type).toBe("CompoundObject.Switch_PB04");
    expect(own.toggle!.raw).toMatchObject({ Type: "ToggleSwitch", Off: { Text: "MANUAL" }, On: { Text: "AUTO" } });
    expect(own.reading!.raw).toMatchObject({ Type: "NumericDisplay", IsInputModeEnabled: false });
    expect(own.status!.raw.Type).toBe("StringDisplay");
  });

  it("draw what we add, bound the way the engineer binds them", async () => {
    const read = await rig();
    const panel = read.target;
    const start = switchPart("Start", "START", { left: 20, top: 20, width: 140, height: 44 });
    const volts = numericDisplay("Volts", { left: 20, top: 80, width: 90, height: 24 }, 1);
    const mode = toggleSwitch("Mode", "MANUAL", "AUTO", { left: 20, top: 120, width: 180, height: 36 });
    const screen = screenOf("Added", [start, volts, mode], panel);
    const wires: Wire[] = [
      { part: start, tag: "Run_CMD", property: "CurrentValue", screenId: screen.UniqueId },
      { part: volts, tag: "Motor_Voltage", property: "CurrentValue", screenId: screen.UniqueId },
      { part: mode, tag: "AUTOMAN", property: "CurrentValue", screenId: screen.UniqueId },
    ];
    const bytes = await OTE.write({ ...read, screens: [...read.screens, screen], wires: [...read.wires, ...wires] }, read.preserved);
    const zip = await JSZip.loadAsync(bytes);

    const [added] = await json(zip, (n) => n === `Screens/${screen.UniqueId}/Screen.dat`);
    const byName = Object.fromEntries(added.Children[0].Children.map((p: { Name: string }) => [p.Name, p]));
    expect(byName.Start).toMatchObject({ Type: "CompoundObject.Switch_PB04", OperationType: 3, Text: { OFF: "START", ON: "START" }, Width: 140 });
    expect(byName.Volts).toMatchObject({ Type: "NumericDisplay", IsInputModeEnabled: false, FloatDigits: 1, Font: { Attribute: { Bold: true } } });
    // The engineer's Font 24 is made to fit a 24 px row.
    expect(byName.Volts.Font.Size).toBeLessThanOrEqual(15);
    expect(byName.Mode).toMatchObject({ Type: "ToggleSwitch", Off: { Text: "MANUAL" }, On: { Text: "AUTO" } });

    const [graph] = await json(zip, (n) => n === "Bindings.dat");
    const target = graph.Targets.find((t: { ObjectId: string }) => t.ObjectId === start.UniqueId);
    const row = graph.Bindings.find((b: { Target: number }) => b.Target === target.ReferenceId);
    expect(target.SubType).toBe("CompoundObject.Switch_PB04");
    expect(row).toMatchObject({ TargetProperty: "CV", Mode: 2, BindingText: "MachineExpertEquipment1.Main.Run_CMD.Value" });
  });

  it("never change what the engineer drew", async () => {
    const read = await rig();
    const out = nativise(read, harvest(read.preserved, read.variables), partsOf(read.preserved));
    expect(out.written).toEqual([]);
    expect(out.input.screens).toEqual(read.screens);
  });
});

describe("a project with no examples", () => {
  it("keeps our parts as they are", () => {
    const part = switchPart("Start", "START", { left: 0, top: 0, width: 100, height: 40 });
    const input = {
      name: "P",
      target: { model: "HMIST6600", width: 1280, height: 800 },
      screens: [screenOf("S", [part], { width: 1280, height: 800 })],
      variables: [],
      alarms: [],
      wires: [{ part, tag: "Run_CMD", property: "CurrentValue" }],
    };
    expect(nativise(input, {}, new Set()).input).toBe(input);
  });
});
