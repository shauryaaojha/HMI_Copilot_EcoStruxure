/**
 * Compound Objects in an opened project: read as parts the editor can select,
 * move and align, drawn from their definitions (lib/ote/co-look.ts), and
 * written back typed by their definition.
 *
 * Runs on the engineer's Panel-1 project when it is on disk (it is not in
 * git). Each look check is what the OTE editor shows for that object.
 */

import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readProject } from "@/lib/ote/reader";
import { packageProject } from "@/lib/ote/packager";
import type { Look, LookItem } from "@/lib/ote/co-look";
import type { Part } from "@/lib/ote/schema";
import { digestOf, projectContext, volatileContext } from "@/lib/ai/converse";

const RIG = path.join(__dirname, "..", "..", "samples", "hmi-panel-1", "auto-manual.eote");

type Raw = Record<string, unknown>;

const parts = (look: Look): Extract<LookItem, { kind: "part" }>["part"][] =>
  look.items.flatMap((i) => (i.kind === "part" ? [i.part] : parts(i.look)));

const find = (n: Raw, name: string): Raw | undefined =>
  n.Name === name ? n : ((n.Children as Raw[] | undefined) ?? []).map((c) => find(c, name)).find(Boolean);

async function contentFile(bytes: Uint8Array, id: string): Promise<Raw> {
  const zip = await JSZip.loadAsync(bytes);
  const entry = Object.keys(zip.files).find((n) => n.split("\\").join("/").toLowerCase() === `contents/${id}/screen.dat`);
  return JSON.parse((await zip.file(entry!)!.async("string")).replace(/^\uFEFF/, ""));
}

describe.skipIf(!fs.existsSync(RIG))("Compound Objects on the Panel-1 rig", async () => {
  const bytes = new Uint8Array(fs.readFileSync(RIG));
  const read = await readProject(bytes, "auto-manual.eote");
  const all = Object.values(read.foreign).flat();
  const cos = read.screens
    .flatMap((s) => s.Children[0].Children.map((p) => ({ screen: s, part: p })))
    .filter((x): x is { screen: (typeof read.screens)[number]; part: Extract<Part, { Type: "CompoundObject" }> } => x.part.Type === "CompoundObject");
  const named = (name: string) => cos.find((x) => x.part.Name === name)!;
  const lookOf = (name: string) => named(name).part.Look as Look;

  it("reads every instance as a part the editor can select and move", () => {
    expect(cos.map((x) => `${x.screen.Name}/${x.part.Name}`).sort()).toEqual([
      "Bar_Graph/BarGraph_Vert_301",
      "Bar_Graph/BarGraph_Vert_302",
      "Bar_Graph/BarGraph_Vert_303",
      "Frequency_Set/Display_ND011",
      "Meter/Gauge_101",
      "Meter/Gauge_105",
      "Start_Stop/Switch_PB041",
      "Start_Stop/Switch_PB042",
      "Start_Stop/Switch_PB044",
      "Start_Stop1/BarGraph_Vert_303",
    ]);
    const start = named("Switch_PB041").part;
    expect(start.Definition).toBe("Switch_PB04");
    expect(start.Width).toBeGreaterThan(0);
    expect(all.some((f) => f.type.startsWith("CompoundObject."))).toBe(false);
  });

  it("writes an untouched instance back as it was, and a moved one typed and kept in its cell", async () => {
    const input = { name: read.name, target: read.target, screens: read.screens, variables: read.variables, alarms: read.alarms, wires: read.wires } as Parameters<typeof packageProject>[0];
    const host = named("Switch_PB041").screen;
    const original = find(await contentFile(bytes, host.UniqueId), "Switch_PB041")!;

    const same = find(await contentFile(await packageProject(input, undefined, read.preserved), host.UniqueId), "Switch_PB041")!;
    expect(same).toEqual(original);

    const screens = structuredClone(read.screens);
    const start = screens.find((s) => s.UniqueId === host.UniqueId)!.Children[0].Children.find((p) => p.Name === "Switch_PB041")!;
    start.Location = { Left: start.Location.Left + 20, Top: start.Location.Top + 10 };
    const out = find(await contentFile(await packageProject({ ...input, screens }, undefined, read.preserved), host.UniqueId), "Switch_PB041")!;
    expect(out.Type).toBe("CompoundObject.Switch_PB04");
    expect(out).not.toHaveProperty("Definition");
    expect(out).not.toHaveProperty("Look");
    expect(out.Text).toEqual(original.Text);
    expect((out.Location as Raw).Row).toBe((original.Location as Raw).Row);
    expect(out.Margin).toBeDefined();
  });

  it("draws each push button with the instance's own text, in its OFF state", () => {
    const texts = ["Switch_PB041", "Switch_PB042", "Switch_PB044"].map((n) =>
      parts(lookOf(n)).filter((p) => p.Type === "TextBox").map((p) => (p as { Text?: string }).Text),
    );
    // The script hides TextBox_ON and every coloured ellipse while CV is false.
    expect(texts).toEqual([["START"], ["RESET"], ["STOP/READY"]]);
    expect(parts(lookOf("Switch_PB041")).some((p) => /Green|Blue|Red/.test(p.Name ?? ""))).toBe(false);
  });

  it("turns a gauge's value into an angle through its Scale converter, from twelve o'clock", () => {
    const arch = parts(lookOf("Gauge_101")).find((p) => p.Name === "Arch_Top") as { StartAngle?: number; EndAngle?: number };
    expect(arch.StartAngle).toBe(-90);
    expect(arch.EndAngle).toBeGreaterThan(-90);
    expect(arch.EndAngle).toBeLessThanOrEqual(270);
  });

  it("fills a bar graph to its value and binds the instance's colour", () => {
    const look = lookOf("BarGraph_Vert_301");
    const window = look.items.find((i) => i.kind === "box");
    expect(window && window.kind === "box" && window.look.clip).toBe(true);
    // 75 of 100: the coloured lines show through the bottom three quarters.
    if (window?.kind === "box") expect(window.box.height / look.height).toBeCloseTo(0.75);
    expect((parts(look).at(-1) as { Fill?: { Color?: { Value?: number } } }).Fill?.Color?.Value).toBe(39);
  });

  it("gives the Copilot each instance as an object with a handle, and a content screen as content", () => {
    const active = named("Switch_PB041").screen;
    const handles = Object.fromEntries(cos.map((x, i) => [x.part.UniqueId, `o${i + 1}`]));
    const digest = digestOf({ name: "P1", target: read.target, screens: read.screens, foreign: read.foreign, activeScreenId: active.UniqueId, variables: [], alarms: [], bindings: [], selectedIds: [], handles });
    expect(projectContext(digest)).toContain("Start_Stop: 8 objects (content screen #4, shown inside Screen1 (ContentDisplay4))");
    expect(volatileContext(digest)).toMatch(/o\d+ Switch_PB041 \[CompoundObject\.Switch_PB04, [a-z]+, reads "START"\]/);
  });

  it("leaves what is not a Compound Object carried", () => {
    expect(all.find((f) => f.type === "HardwareConfiguration")?.look).toBeUndefined();
  });
});
