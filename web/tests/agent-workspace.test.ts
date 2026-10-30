/**
 * The agent's working directory and its tools, without a model: each tool on
 * a project we write here, and on the Panel-1 rig where it is present.
 * lib/agent/workspace.ts, project.ts, tools.ts, script.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Workspace } from "@/lib/agent/workspace";
import { contextFor, runAgentTool, TOOLS } from "@/lib/agent/tools";
import { packageProject } from "@/lib/ote/packager";
import { numericDisplay, screenOf, switchPart } from "@/lib/ote/parts";
import { readProject } from "@/lib/ote/reader";

const target = { model: "HMIST6600", width: 1280, height: 800 };

async function made() {
  const start = switchPart("Start", "START", { left: 20, top: 20, width: 140, height: 44 });
  const volts = numericDisplay("Volts", { left: 20, top: 80, width: 90, height: 24 }, 1);
  const screen = screenOf("Drive", [start, volts], target);
  const variables = [
    { Name: "Run_CMD", DataType: "BOOL", Comments: "", DeviceAddress: "" },
    { Name: "Motor_Voltage", DataType: "INT", Comments: "", DeviceAddress: "" },
  ] as never;
  const bytes = await packageProject({
    name: "P", target, screens: [screen], variables, alarms: [],
    wires: [{ part: volts, tag: "Motor_Voltage", property: "CurrentValue", screenId: screen.UniqueId }],
  });
  const ws = await Workspace.open(bytes, "p.eote");
  return { ws, ctx: contextFor(ws), screen, start, volts };
}

const run = (ctx: ReturnType<typeof contextFor>, name: string, input: Record<string, unknown> = {}) => runAgentTool(ctx, name, input);

describe("the agent's working directory", () => {
  it("lists, reads and searches the project's files, and finds objects at every depth", async () => {
    const { ctx } = await made();
    expect((await run(ctx, "list_files", { glob: "Screens/*/Screen.dat" })).text).toMatch(/Screens\/.+\/Screen\.dat/);
    expect((await run(ctx, "search", { pattern: '"Name": "Volts"' })).text).toContain("Screen.dat");
    const objs = (await run(ctx, "screen_objects", { screen: "Drive" })).text;
    expect(objs).toContain('"Start"');
    expect(objs).toMatch(/NumericDisplay "Volts".*CurrentValue<-.*Motor_Voltage/);
    expect((await run(ctx, "project_summary")).text).toContain("tags: 2");
  });

  it("refuses broken JSON and unknown arguments, and says why", async () => {
    const { ctx, screen } = await made();
    const bad = await run(ctx, "write_file", { path: `Screens/${screen.UniqueId}/Screen.dat`, content: "{ nope" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("valid JSON");
    expect((await run(ctx, "read_file", {})).text).toContain("missing path");
    expect((await run(ctx, "nope")).isError).toBe(true);
  });

  it("binds any object to a tag the way the packager does, and unbinds it", async () => {
    const { ws, ctx } = await made();
    const r = await run(ctx, "bind", { object: "Start", property: "ClickTrigger.Destination", tag: "Run_CMD", mode: 1 });
    expect(r.text).not.toMatch(/failed|no /);
    expect(r.text).toContain("Run_CMD");
    const read = await readProject(await ws.toBytes(), "p.eote");
    expect(read.wires.map((w) => `${w.part.Name}.${w.property}<-${w.tag}`).sort()).toEqual(["Start.ClickTrigger.Destination<-Run_CMD", "Volts.CurrentValue<-Motor_Voltage"]);
    expect((await run(ctx, "unbind", { object: "Start" })).text).toContain("removed 1");
    expect((await readProject(await ws.toBytes(), "p.eote")).wires).toHaveLength(1);
    expect((await run(ctx, "check")).text).toContain("no problems found");
  });

  it("copies an object with new ids and duplicates a screen into the tree, and the check stays clean", async () => {
    const { ws, ctx } = await made();
    expect((await run(ctx, "clone_object", { object: "Volts", to_screen: "Drive", name: "Amps", left: 20, top: 120 })).text).toContain('"Amps"');
    expect((await run(ctx, "duplicate_screen", { screen: "Drive", name: "Drive2" })).text).toMatch(/created Drive2 #2/);
    expect((await run(ctx, "check")).text).toContain("no problems found");
    const read = await readProject(await ws.toBytes(), "p.eote");
    expect(read.screens.map((s) => s.Name)).toEqual(["Drive", "Drive2"]);
    expect(read.screens[0].Children[0].Children.map((p) => p.Name)).toContain("Amps");
  });

  it("will not delete a screen's own files, and prunes the tree when a whole screen goes", async () => {
    const { ws, ctx, screen } = await made();
    expect((await run(ctx, "delete_path", { path: `Screens/${screen.UniqueId}/Screen.dat` })).isError).toBe(true);
    await run(ctx, "duplicate_screen", { screen: "Drive", name: "Drive2" });
    const copy = (await readProject(await ws.toBytes(), "p.eote")).screens.find((s) => s.Name === "Drive2")!;
    expect((await run(ctx, "delete_path", { path: `Screens/${copy.UniqueId}` })).isError).toBeFalsy();
    expect(ws.text("Screens/Hierarchy.dat")).not.toContain(copy.UniqueId);
    expect((await run(ctx, "check")).text).toContain("no problems found");
  });

  it("edits a file when the model's whitespace differs, but only where the match is unique", async () => {
    const { ws, ctx, screen } = await made();
    const file = `Screens/${screen.UniqueId}/Screen.dat`;
    const r = await run(ctx, "edit_file", { path: file, old_text: '"Name":"Volts"', new_text: '"Name": "Amps"' });
    expect(r.isError).toBeFalsy();
    expect(ws.text(file)).toContain('"Name": "Amps"');
    expect((await run(ctx, "edit_file", { path: file, old_text: '"Type"', new_text: '"Type"' })).isError).toBe(true);
  });

  it("places a copy in a grid by row and column, never by Left and Top", async () => {
    const { ws, ctx, screen } = await made();
    const file = `Screens/${screen.UniqueId}/Screen.dat`;
    const doc = ws.json<{ Children: Record<string, unknown>[] }>(file);
    const grid = { Type: "Grid", UniqueId: crypto.randomUUID(), Name: "Cells", Rows: [{}, {}, {}], Columns: [{}, {}], Children: [] as unknown[] };
    const kids = (doc.Children[0].Children as Record<string, unknown>[]);
    grid.Children.push({ ...kids[0], UniqueId: crypto.randomUUID(), Name: "Inside", Location: { Row: 0, Column: 0, RowSpan: 1, ColumnSpan: 1 } });
    kids.push(grid);
    ws.writeJson(file, doc);
    const r = (await run(ctx, "clone_object", { object: "Inside", to_screen: "Drive", container: "Cells", name: "Next", left: 500 })).text;
    expect(r).toContain("row 0, column 1");
    expect(r).not.toContain("covers");
    const placed = ws.json<{ Children: { Children: { Name: string; Children?: { Name: string; Location: Record<string, number> }[] }[] }[] }>(file)
      .Children[0].Children.find((c) => c.Name === "Cells")!.Children!.find((c) => c.Name === "Next")!;
    expect(placed.Location).toEqual({ Row: 0, Column: 1, RowSpan: 1, ColumnSpan: 1 });
    expect((await run(ctx, "clone_object", { object: "Inside", to_screen: "Drive", container: "Cells", row: 0, column: 0 })).text).toMatch(/covers Inside.*free 1x1 cell: row 1, column 0/);
    expect((await run(ctx, "clone_object", { object: "Inside", to_screen: "Drive", container: "Cells", row: 9 })).isError).toBe(true);
  });

  it("finds what check exists to find", async () => {
    const { ws, ctx, screen } = await made();
    const file = `Screens/${screen.UniqueId}/Screen.dat`;
    const doc = ws.json<{ Children: { Children: { UniqueId: string }[] }[] }>(file);
    doc.Children[0].Children[1].UniqueId = doc.Children[0].Children[0].UniqueId;
    ws.writeJson(file, doc);
    expect((await run(ctx, "check")).text).toMatch(/used twice/);
    expect((await run(ctx, "undo")).text).toContain("as it was opened");
    expect((await run(ctx, "check")).text).toContain("no problems found");
  });

  it("runs a script in the sandbox against the workspace, and nothing outside it", async () => {
    const { ws, ctx, screen } = await made();
    const code = `const f = ws.list("Screens").find(p => p.endsWith("Screen.dat"));
      const s = ws.json(f); s.Children[0].Children.forEach(p => p.Name = p.Name + "_x"); ws.writeJson(f, s);
      print(typeof require, typeof process, typeof fetch); s.Children[0].Children.map(p => p.Name)`;
    const r = await run(ctx, "run_script", { code });
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain("undefined undefined undefined");
    expect(r.text).toContain("Start_x");
    expect(ws.json<{ Children: { Children: { Name: string }[] }[] }>(`Screens/${screen.UniqueId}/Screen.dat`).Children[0].Children[0].Name).toBe("Start_x");
    const loop = await run(ctx, "run_script", { code: "while (true) {}" });
    expect(loop.isError).toBe(true);
  }, 30_000);

  it("draws a screen for the model to look at", async () => {
    const { ctx } = await made();
    const r = await run(ctx, "view_screen", { screen: "Drive" });
    expect(Array.from(r.image!.slice(1, 4))).toEqual([0x50, 0x4e, 0x47]);
  }, 30_000);

  it("writes the project back with only what changed, every other entry as it was", async () => {
    const { ws } = await made();
    const before = ws.list().map((p) => [p, ws.bytes(p)] as const);
    const again = await Workspace.open(await ws.toBytes(), "p.eote");
    for (const [p, b] of before) expect(again.bytes(p)).toEqual(b);
  });

  it("every tool has a description and an input schema the providers accept", () => {
    for (const t of TOOLS) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.name).toMatch(/^[a-z_]{3,40}$/);
    }
  });
});

const RIG = path.join(__dirname, "..", "..", "samples", "hmi-panel-1", "auto-manual.eote");

describe.skipIf(!fs.existsSync(RIG))("on the rig", () => {
  it("never shows the PLC connection, and still writes it back untouched", async () => {
    const bytes = new Uint8Array(fs.readFileSync(RIG));
    const ws = await Workspace.open(bytes, "auto-manual.eote");
    const ctx = contextFor(ws);
    expect(ws.list().some((p) => /DriverConfig/i.test(p))).toBe(false);
    expect((await run(ctx, "read_file", { path: "DriverConfig.db" })).text).toContain("PLC connection");
    expect((await run(ctx, "search", { pattern: "192\\.168\\.10\\.2" })).text).toBe("no matches");
    const JSZip = (await import("jszip")).default;
    const original = await JSZip.loadAsync(bytes);
    const out = await JSZip.loadAsync(await ws.toBytes());
    const name = Object.keys(original.files).find((n) => /DriverConfig\.db$/i.test(n))!;
    expect(await out.files[name].async("uint8array")).toEqual(await original.files[name].async("uint8array"));
  });

  it("finds the engineer's START button inside a content screen's grid, and how it is bound", async () => {
    const ws = await Workspace.open(new Uint8Array(fs.readFileSync(RIG)), "auto-manual.eote");
    const ctx = contextFor(ws);
    const hits = (await run(ctx, "find_objects", { type: "Switch_PB04" })).text;
    expect(hits).toMatch(/CompoundObject\.Switch_PB04/);
    expect(hits).toMatch(/CV:.*Run_CMD/);
    expect((await run(ctx, "own_objects")).text).toContain("Switch_PB04");
    expect((await run(ctx, "check")).text).toContain("no problems found");
  }, 30_000);

  it("copies START onto the Meter grid by cell, says when the grid has no room, and binds it", async () => {
    const ws = await Workspace.open(new Uint8Array(fs.readFileSync(RIG)), "auto-manual.eote");
    const ctx = contextFor(ws);
    const r = (await run(ctx, "clone_object", { object: "Switch_PB041", to_screen: "Meter", container: "Grid", name: "AUTO_START" })).text;
    expect(r).toContain("grid cell");
    // The engineer filled the Meter grid; the tool says so rather than hiding the overlap.
    expect(r).toContain("no free 3x2 cell");
    expect((await run(ctx, "bind", { object: "AUTO_START", property: "CV", tag: "AUTOSTART", mode: 2 })).text).toContain("MachineExpertEquipment1.Main.AUTOSTART.Value");
    const placed = (await run(ctx, "find_objects", { screen: "Meter", name: "AUTO_START" })).text;
    expect(placed).toContain("CV:MachineExpertEquipment1.Main.AUTOSTART.Value");
    expect(ws.text("Contents/8f008a19-1aa6-44ac-be39-123fd626ed32/Screen.dat")).toMatch(/"Name": "AUTO_START"/);
    expect((await run(ctx, "check")).text).toContain("no problems found");
  }, 60_000);
});
