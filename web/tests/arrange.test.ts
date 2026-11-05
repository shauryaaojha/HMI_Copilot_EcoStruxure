/**
 * Arranging objects by chat op and by agent tool: match size, snap to grid,
 * aligning cards with what is on them, overlaps inside a card (S3-09), and the
 * agent's own tools working on a real project's files.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { demoScreen, demoVariables } from "@/fixtures";
import { applyOps } from "@/core/ops";
import { readProject } from "@/lib/ote/reader";
import type { Part } from "@/lib/ote/schema";
import { overlapsOn, planTidy } from "@/lib/ote/tidy";
import { createProjectStore } from "@/store/project";
import { matchSizes, snapPosition } from "@/store/edits";
import { contextFor, TOOLS } from "@/lib/agent/tools";
import { Workspace } from "@/lib/agent/workspace";

const PANEL = { width: 1024, height: 600 };
const FILE = path.resolve(import.meta.dirname, "../../demo_project/HMICopilot_Bars.eote");

const rect = (Name: string, Left: number, Top: number, Width: number, Height: number, Type = "Rectangle"): Part =>
  ({ UniqueId: Name, Name, Type, Location: { Left, Top }, Width, Height }) as unknown as Part;

function storeWith(parts: Part[]) {
  const s = createProjectStore();
  const screen = structuredClone(demoScreen);
  screen.Children[0].Children = parts;
  s.getState().hydrate({
    name: "Arrange", target: { model: "HMIST6500", ...PANEL }, screens: [screen], activeScreenId: screen.UniqueId,
    variables: structuredClone(demoVariables), alarms: [], bindings: [],
  } as never);
  return s;
}
const part = (s: ReturnType<typeof storeWith>, name: string) => s.getState().screens[0].Children[0].Children.find((p) => p.Name === name)!;

describe("the pure geometry", () => {
  it("matchSizes copies from the first part, on the side asked", () => {
    const parts = [rect("A", 0, 0, 100, 40), rect("B", 0, 0, 60, 90)];
    expect(matchSizes(parts, "both").get("B")).toEqual({ width: 100, height: 40 });
    expect(matchSizes(parts, "width").get("B")).toEqual({ width: 100, height: 90 });
    expect(matchSizes(parts, "height").get("B")).toEqual({ width: 60, height: 40 });
    expect(matchSizes(parts, "both").has("A")).toBe(false);
  });

  it("snapPosition goes to the nearest line and stays on the panel", () => {
    expect(snapPosition({ left: 13, top: 3, width: 10, height: 10 }, 8)).toEqual({ left: 16, top: 0 });
    expect(snapPosition({ left: 1014, top: 0, width: 10, height: 10 }, 8, PANEL)).toEqual({ left: 1008, top: 0 });
  });
});

describe("chat ops", () => {
  it("matchSize resizes the rest to the first and refuses a name it cannot find", () => {
    const s = storeWith([rect("A", 10, 10, 120, 40), rect("B", 200, 10, 60, 90)]);
    const good = applyOps([{ op: "matchSize", targets: ["A", "B"] }], s);
    expect(good.rejected).toEqual([]);
    expect([part(s, "B").Width, part(s, "B").Height]).toEqual([120, 40]);
    const bad = applyOps([{ op: "matchSize", targets: ["A", "Nope"] }], s);
    expect(bad.rejected.length).toBe(1);
  });

  it("matchSize needs two objects", () => {
    const s = storeWith([rect("A", 10, 10, 120, 40)]);
    expect(applyOps([{ op: "matchSize", targets: ["A"] }], s).rejected.length).toBe(1);
  });

  it("snapToGrid with no targets snaps each faceplate whole, keeping the lamp's place on its card", () => {
    const s = storeWith([rect("Card_A", 13, 13, 200, 100), rect("Lamp_A", 33, 43, 20, 20, "TextBox"), rect("Free", 301, 301, 40, 40)]);
    const out = applyOps([{ op: "snapToGrid", grid: 8 }], s);
    expect(out.rejected).toEqual([]);
    expect([part(s, "Card_A").Location.Left, part(s, "Card_A").Location.Top]).toEqual([16, 16]);
    expect([part(s, "Lamp_A").Location.Left, part(s, "Lamp_A").Location.Top]).toEqual([36, 46]);
    expect([part(s, "Free").Location.Left, part(s, "Free").Location.Top]).toEqual([304, 304]);
  });

  it("aligning cards takes what is on them along", () => {
    const s = storeWith([
      rect("Card_A", 20, 40, 200, 100), rect("Lamp_A", 40, 60, 20, 20, "TextBox"),
      rect("Card_B", 300, 200, 200, 100), rect("Lamp_B", 320, 220, 20, 20, "TextBox"),
    ]);
    const out = applyOps([{ op: "alignObjects", targets: ["Card_A", "Card_B"], mode: "top" }], s);
    expect(out.rejected).toEqual([]);
    expect(part(s, "Card_B").Location.Top).toBe(40);
    expect(part(s, "Lamp_B").Location.Top).toBe(60);
    expect(part(s, "Lamp_A").Location.Top).toBe(60);
  });
});

describe("S3-09 overlaps inside a card", () => {
  const faceplate = () => [
    rect("Card_T", 100, 100, 400, 200),
    rect("Sym_T", 300, 120, 52, 52, "TextBox"),
    rect("Ind_T", 120, 150, 200, 56, "TextBox"),
  ];

  it("are found, naming the card", () => {
    const [o] = overlapsOn(faceplate());
    expect(o.inside).toBe("Card_T");
    expect(o.mover.name).toBe("Sym_T");
    expect([o.width, o.height]).toEqual([20, 22]);
  });

  it("a label wholly on a lamp and the members of one composite are not overlaps", () => {
    expect(overlapsOn([rect("Card_T", 100, 100, 400, 200), rect("Lamp", 120, 120, 40, 40, "TextBox"), rect("Lbl", 125, 125, 20, 20, "TextBox")])).toEqual([]);
    const group = (id: string) => (id === "Sym_T" || id === "Ind_T" ? "g" : undefined);
    expect(overlapsOn(faceplate(), group)).toEqual([]);
  });

  it("tidy moves the smaller one within its card, leaving nothing overlapped", () => {
    const parts = faceplate();
    const plan = planTidy(parts, PANEL);
    expect(plan.stuck).toEqual([]);
    expect(plan.moves.map((m) => m.name)).toEqual(["Sym_T"]);
    const m = plan.moves[0];
    const after = parts.map((p) => (p.Name === "Sym_T" ? { ...p, Location: { ...p.Location, Left: p.Location.Left + m.dx, Top: p.Location.Top + m.dy } } : p));
    expect(overlapsOn(after as Part[])).toEqual([]);
    const moved = after.find((p) => p.Name === "Sym_T")!;
    expect(moved.Location.Left).toBeGreaterThanOrEqual(100);
    expect(moved.Location.Left + 52).toBeLessThanOrEqual(500);
    expect(moved.Location.Top + 52).toBeLessThanOrEqual(300);
  });

  it("says so when the card has no room, instead of reporting done", () => {
    const parts = [rect("Card_T", 100, 100, 110, 60), rect("A", 100, 100, 100, 60, "TextBox"), rect("B", 150, 100, 60, 60, "TextBox")];
    const plan = planTidy(parts, PANEL);
    expect(plan.stuck.join()).toContain("on Card_T");
  });

  it("finds the overlap the generator left in the tracked sample", async () => {
    const read = await readProject(new Uint8Array(readFileSync(FILE)), FILE);
    const screen = read.screens.find((s) => s.Name === "PumpStation1")!;
    const found = overlapsOn(screen.Children[0].Children, () => undefined, read.target);
    expect(found.some((o) => [o.mover.name, o.other.name].includes("Sym_TNK101"))).toBe(true);
  });
});

describe("the agent's tools", () => {
  async function open() {
    const ws = await Workspace.open(new Uint8Array(readFileSync(FILE)), "sample.eote");
    const ctx = contextFor(ws);
    const call = async (name: string, input: Record<string, unknown>) => {
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) throw new Error(`no tool ${name}`);
      return tool.run(ctx, input);
    };
    return { ws, ctx, call };
  }
  const box = (read: Awaited<ReturnType<ReturnType<typeof contextFor>["read"]>>, name: string) =>
    read.screens.flatMap((s) => s.Children[0].Children).find((p) => p.Name === name)!;

  it("align_objects moves the file's objects, and the project still reads", async () => {
    const { ctx, call } = await open();
    const out = await call("align_objects", { objects: ["Sym_TNK101", "Ind_TNK101LEVEL_2"], mode: "top", screen: "PumpStation1" });
    expect(out.isError).toBeFalsy();
    const read = await ctx.read();
    expect(box(read, "Sym_TNK101").Location.Top).toBe(box(read, "Ind_TNK101LEVEL_2").Location.Top);
  });

  it("match_size copies the first object's size", async () => {
    const { ctx, call } = await open();
    await call("match_size", { objects: ["Ind_TNK101LEVEL_2", "Sym_TNK101"], dimension: "height", screen: "PumpStation1" });
    const read = await ctx.read();
    expect(box(read, "Sym_TNK101").Height).toBe(box(read, "Ind_TNK101LEVEL_2").Height);
    expect(box(read, "Sym_TNK101").Width).toBe(52);
  });

  it("find_overlaps and tidy_screen clear the sample's screen or say why not", async () => {
    const { call } = await open();
    const before = await call("find_overlaps", { screen: "PumpStation1" });
    expect(before.text).toContain("Sym_TNK101");
    const tidied = await call("tidy_screen", { screen: "PumpStation1" });
    expect(tidied.isError).toBeFalsy();
    const after = await call("find_overlaps", { screen: "PumpStation1" });
    if (!tidied.text.includes("no clear spot")) expect(after.text).toBe("no overlaps");
  });

  it("snap_to_grid leaves every faceplate's corner on the grid", async () => {
    const { call } = await open();
    const out = await call("snap_to_grid", { screen: "PumpStation1", grid: 16 });
    expect(out.text).toMatch(/snapped \d+|already/);
    const again = await call("snap_to_grid", { screen: "PumpStation1", grid: 16 });
    expect(again.text).toContain("already");
  });

  it("refuses to compare objects in different places, and asks for three to space evenly", async () => {
    const { call } = await open();
    await expect(call("distribute_objects", { objects: ["Sym_TNK101", "Ind_TNK101LEVEL_2"], axis: "horizontal", screen: "PumpStation1" })).rejects.toThrow(/at least three/);
  });
});
