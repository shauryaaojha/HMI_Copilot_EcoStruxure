/**
 * Compound Objects drawn from their definitions: lib/ote/co-look.ts.
 *
 * Runs on the engineer's Panel-1 project when it is on disk (it is not in
 * git). Each check is what the OTE editor shows for that object.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readProject } from "@/lib/ote/reader";
import type { Look, LookItem } from "@/lib/ote/co-look";
import { digestOf, projectContext, volatileContext } from "@/lib/ai/converse";

const RIG = path.join(__dirname, "..", "..", "samples", "hmi-panel-1", "auto-manual.eote");

const parts = (look: Look): Extract<LookItem, { kind: "part" }>["part"][] =>
  look.items.flatMap((i) => (i.kind === "part" ? [i.part] : parts(i.look)));

describe.skipIf(!fs.existsSync(RIG))("Compound Object looks on the Panel-1 rig", async () => {
  const read = await readProject(new Uint8Array(fs.readFileSync(RIG)), "auto-manual.eote");
  const all = Object.values(read.foreign).flat();
  const named = (name: string) => all.find((f) => f.name === name);

  it("draws each push button with the instance's own text, in its OFF state", () => {
    const texts = ["Switch_PB041", "Switch_PB042", "Switch_PB044"].map((n) =>
      parts(named(n)!.look!).filter((p) => p.Type === "TextBox").map((p) => (p as { Text?: string }).Text),
    );
    // The script hides TextBox_ON and every coloured ellipse while CV is false.
    expect(texts).toEqual([["START"], ["RESET"], ["STOP/READY"]]);
    expect(parts(named("Switch_PB041")!.look!).some((p) => /Green|Blue|Red/.test(p.Name ?? ""))).toBe(false);
  });

  it("turns a gauge's value into an angle through its Scale converter, from twelve o'clock", () => {
    const arch = parts(named("Gauge_101")!.look!).find((p) => p.Name === "Arch_Top") as { StartAngle?: number; EndAngle?: number };
    expect(arch.StartAngle).toBe(-90);
    expect(arch.EndAngle).toBeGreaterThan(-90);
    expect(arch.EndAngle).toBeLessThanOrEqual(270);
  });

  it("fills a bar graph to its value and binds the instance's colour", () => {
    const look = named("BarGraph_Vert_301")!.look!;
    const window = look.items.find((i) => i.kind === "box");
    expect(window && window.kind === "box" && window.look.clip).toBe(true);
    // 75 of 100: the coloured lines show through the bottom three quarters.
    if (window?.kind === "box") expect(window.box.height / look.height).toBeCloseTo(0.75);
    expect((parts(look).at(-1) as { Fill?: { Color?: { Value?: number } } }).Fill?.Color?.Value).toBe(39);
  });

  it("tells the Copilot a content screen is content and a Compound Object is an object", () => {
    const active = read.screens.find((s) => s.Name === "Start_Stop")!;
    const digest = digestOf({ name: "P1", target: read.target, screens: read.screens, foreign: read.foreign, activeScreenId: active.UniqueId, variables: [], alarms: [], bindings: [], selectedIds: [], handles: {} });
    expect(projectContext(digest)).toContain("Start_Stop: 8 objects (content screen #4, shown inside Screen1 (ContentDisplay4))");
    expect(volatileContext(digest)).toMatch(/Compound Objects on it[^\n]*\nSwitch_PB041 \[CompoundObject\.Switch_PB04\] reads "START"/);
  });

  it("leaves what is not a Compound Object hatched", () => {
    expect(all.find((f) => f.type === "HardwareConfiguration")?.look).toBeUndefined();
  });
});
