/**
 * The agent's apply_ops and layout tools (lib/agent/tools.ts): the chat's ops
 * on the project file, and the screen read as nested cards.
 *
 * What is held: one apply_ops makes a screen, a tag, an object on it with its
 * geometry, a binding and navigation, all written so the project reads back
 * with them; a refused op is named with its reason and the rest still land; a
 * bad op is reported rather than sinking the call; layout shows each object
 * under its card with the free space on it.
 */
import { describe, expect, it } from "vitest";
import { Workspace } from "@/lib/agent/workspace";
import { contextFor, runAgentTool } from "@/lib/agent/tools";
import { packageProject } from "@/lib/ote/packager";
import { rectangle, screenOf, switchPart } from "@/lib/ote/parts";
import { readProject } from "@/lib/ote/reader";

const target = { model: "HMIST6600", width: 1280, height: 800 };

async function made() {
  const card = rectangle("Pump_Card", { left: 40, top: 120, width: 500, height: 400 });
  const start = switchPart("Start", "START", { left: 64, top: 160, width: 140, height: 44 });
  const screen = screenOf("Drive", [card, start], target);
  const variables = [{ Name: "Run_CMD", DataType: "BOOL", Comments: "", DeviceAddress: "" }] as never;
  const bytes = await packageProject({ name: "P", target, screens: [screen], variables, alarms: [], wires: [] });
  const ws = await Workspace.open(bytes, "p.eote");
  return { ws, ctx: contextFor(ws) };
}

describe("the agent's apply_ops", () => {
  it("makes a screen, a tag, a placed object, a binding and navigation in one call", async () => {
    const { ws, ctx } = await made();
    const r = await runAgentTool(ctx, "apply_ops", {
      ops: [
        { op: "addScreen", name: "Alarms" },
        { op: "addTag", name: "Auto_Mode", dataType: "BOOL", comment: "Auto mode" },
        { op: "addObject", type: "Switch", name: "Auto_Btn", screen: "Drive", left: 64, top: 240, width: 140, height: 44, text: "AUTO" },
        { op: "bindTag", target: "Auto_Btn", tag: "Auto_Mode" },
        { op: "addObject", type: "Switch", name: "To_Alarms", screen: "Drive", left: 240, top: 160, width: 140, height: 44, text: "ALARMS" },
        { op: "setAction", target: "To_Alarms", action: "goToScreen", toScreen: "Alarms" },
      ],
    });
    expect(r.isError).toBeFalsy();
    expect(r.text).toMatch(/^6 applied, 0 refused/);
    const read = await readProject(await ws.toBytes(), "p.eote");
    expect(read.screens.map((x) => x.Name).sort()).toEqual(["Alarms", "Drive"]);
    expect(read.variables.some((v) => v.Name === "Auto_Mode")).toBe(true);
    const drive = read.screens.find((x) => x.Name === "Drive")!.Children[0].Children;
    expect(drive.find((o) => o.Name === "Auto_Btn")).toMatchObject({ Location: { Left: 64, Top: 240 } });
    expect(read.wires.some((w) => w.part.Name === "Auto_Btn" && w.tag === "Auto_Mode")).toBe(true);
    expect((await runAgentTool(ctx, "check", {})).text).not.toMatch(/binding.*missing/i);
  });

  it("names a refused op and a broken one, and still writes the rest", async () => {
    const { ws, ctx } = await made();
    const r = await runAgentTool(ctx, "apply_ops", {
      ops: [
        { op: "addTag", name: "Good_Tag", dataType: "BOOL" },
        { op: "moveObject", target: "No_Such_Thing", left: 10, top: 10 },
        { op: "addObject" },
      ],
    });
    expect(r.text).toMatch(/^1 applied, 2 refused/);
    expect(r.text).toContain("No_Such_Thing");
    expect(r.text).toMatch(/(not usable: op 3|refused: addObject)/);
    expect((await readProject(await ws.toBytes(), "p.eote")).variables.some((v) => v.Name === "Good_Tag")).toBe(true);
  });

  it("says when a change puts an object across a card's edge", async () => {
    const { ctx } = await made();
    const r = await runAgentTool(ctx, "apply_ops", {
      ops: [{ op: "addObject", type: "Switch", name: "Half_Off", screen: "Drive", left: 480, top: 300, width: 140, height: 44, text: "X" }],
    });
    expect(r.text).toContain("Half_Off crosses the edge of Pump_Card");
  });
});

describe("the agent's layout", () => {
  it("shows each object under its card with the free space on it", async () => {
    const { ctx } = await made();
    const text = (await runAgentTool(ctx, "layout", { screen: "Drive" })).text;
    expect(text).toMatch(/- Pump_Card \[card 40,120 500x400\] free inside: \d+/);
    expect(text).toMatch(/\n  - Start \[Switch 64,160 140x44\]/);
    expect(text).toContain("Layout problems: none");
  });
});
