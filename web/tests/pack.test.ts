/**
 * The Standard pack. docs/ARCHITECTURE_SCREEN_QUALITY.md §3.2, Phase 3 item 1.
 *
 * Two promises. The pack is the one statement of the standard: its tokens
 * are real indices in the project's colour set and the generator uses only
 * them. And the pack is enforced: the lint reads the same document, so a
 * generated application violates none of its rules, and a screen that does
 * gets a finding that names the object.
 */

import { describe, expect, it } from "vitest";
import { COLOR_SETS } from "@/lib/ote/palette";
import { ISA101, StandardPack, neutralSet, signalSet } from "@/lib/standard/pack";
import { lintPack } from "@/lib/standard/lint";
import { applyPack } from "@/lib/standard/apply";
import { GREEN, RED, WHITE } from "@/lib/ote/palette";
import { layoutApplication } from "@/lib/ote/layout";
import { lamp, rectangle, screenOf, textBox } from "@/lib/ote/parts";
import { buildDemoProject } from "@/lib/ote/demo-project";
import { inferEquipment } from "@/lib/ai/infer";
import { fallbackPlan } from "@/lib/ai/plan";
import { parseTags } from "@/lib/tags/parse";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PackageInput } from "@/lib/ote/packager";

const PANEL = { model: "HMIGTO6310", width: 1024, height: 600 };

const project = (parts: ReturnType<typeof lamp>[]): PackageInput => ({
  name: "t",
  target: PANEL,
  screens: [screenOf("S", parts, PANEL)],
  variables: [],
  alarms: [],
  wires: [],
});

describe("the pack is a real document", () => {
  it("parses its own schema", () => {
    expect(StandardPack.safeParse(ISA101).success).toBe(true);
  });

  it("names only colours the project's colour set holds", () => {
    const size = COLOR_SETS[4].colors.length;
    for (const [role, index] of Object.entries(ISA101.tokens)) {
      expect(index, role).toBeGreaterThanOrEqual(1);
      expect(index, role).toBeLessThanOrEqual(size);
    }
  });

  it("keeps the quiet colours and the alarm colours apart", () => {
    const neutral = neutralSet(ISA101);
    for (const c of signalSet(ISA101)) expect(neutral.has(c), `colour ${c} is both`).toBe(false);
  });
});

describe("the generator obeys the pack", () => {
  it("builds the demo project with no colour outside the pack and nothing under the font floor", () => {
    const findings = lintPack(buildDemoProject());
    expect(findings.filter((f) => f.rule === "colour.abnormalOnly")).toEqual([]);
    expect(findings.filter((f) => f.rule === "text.fontFloor")).toEqual([]);
  });

  it("lays out a whole application for the largest sample with no colour or font finding", () => {
    const csv = readFileSync(join(process.cwd(), "public", "demo", "Plant_Tags.csv"));
    const { variables } = parseTags(csv, "Plant_Tags.csv");
    const equipment = inferEquipment(variables);
    const plan = fallbackPlan("Build the whole plant", equipment);
    const screens = layoutApplication(plan.screens, equipment, PANEL);
    const input: PackageInput = {
      name: "plant",
      target: PANEL,
      screens: screens.map((s) => s.screen),
      variables,
      alarms: [],
      wires: [],
    };
    const findings = lintPack(input);
    expect(findings.filter((f) => f.rule === "colour.abnormalOnly")).toEqual([]);
    expect(findings.filter((f) => f.rule === "text.fontFloor")).toEqual([]);
    // Every screen starts with its ground.
    for (const s of input.screens) expect(s.Children[0].Children[0].Name).toMatch(/^Ground_/);
  });

  it("puts running in the outline and keeps every resting face neutral", () => {
    const l = lamp("L", "STOPPED", "RUNNING", { left: 0, top: 0, width: 100, height: 40 });
    if (l.Type === "Lamp") {
      expect(l.Off.Fill).toEqual({ Color: { Value: ISA101.tokens.equipmentFill } });
      expect(l.On.Border).toEqual({ Color: { Value: ISA101.tokens.runningLine } });
      expect(l.On.Thickness).toBe(2);
      expect(signalSet(ISA101).has((l.On.Fill as { Color: { Value: number } }).Color.Value)).toBe(false);
    }
  });
});

describe("the lint enforces the pack", () => {
  it("flags a saturated colour on a normal face, by object", () => {
    const green = rectangle("Panel_Green", { left: 0, top: 0, width: 100, height: 40 }, { fill: 3 });
    const findings = lintPack(project([green]));
    const hit = findings.find((f) => f.rule === "colour.abnormalOnly");
    expect(hit?.objectId).toBe(green.UniqueId);
    expect(hit?.severity).toBe("warning");
    expect(hit?.message).toMatch(/Panel_Green Fill/);
  });

  it("flags an alarm colour on a resting face, and allows it on the abnormal one", () => {
    const l = lamp("L", "OFF", "ON", { left: 0, top: 0, width: 100, height: 40 });
    if (l.Type === "Lamp") {
      l.On.Fill = { Color: { Value: ISA101.tokens.alarmP1 } };
      expect(lintPack(project([l])).filter((f) => f.rule === "colour.abnormalOnly")).toEqual([]);
      l.Off.Fill = { Color: { Value: ISA101.tokens.alarmP1 } };
      const hit = lintPack(project([l])).find((f) => f.rule === "colour.abnormalOnly");
      expect(hit?.message).toMatch(/L Off Fill is an alarm colour on a normal face/);
    }
  });

  it("flags text under the floor", () => {
    const small = textBox("Tiny", "x", { left: 0, top: 0, width: 100, height: 20 }, { size: 9 });
    const hit = lintPack(project([small])).find((f) => f.rule === "text.fontFloor");
    expect(hit?.objectId).toBe(small.UniqueId);
    expect(hit?.message).toMatch(/9pt/);
  });

  it("notes an object off the grid, as information", () => {
    const off = rectangle("Off", { left: 13, top: 8, width: 100, height: 40 });
    const hit = lintPack(project([off])).find((f) => f.rule === "layout.offGrid");
    expect(hit?.severity).toBe("info");
    const on = rectangle("On", { left: 16, top: 8, width: 100, height: 40 });
    expect(lintPack(project([on])).some((f) => f.rule === "layout.offGrid")).toBe(false);
  });

  it("warns when a screen is a wall of values", () => {
    const many = Array.from({ length: ISA101.rules.density.valuesPerScreen + 1 }, (_, i) =>
      lamp(`L${i}`, "OFF", "ON", { left: (i % 8) * 120, top: Math.floor(i / 8) * 48, width: 100, height: 40 }),
    );
    expect(lintPack(project(many)).some((f) => f.rule === "density.max")).toBe(true);
  });

  it("is part of project validation", async () => {
    const { validateProject } = await import("@/lib/validation/rules");
    const green = rectangle("Panel_Green", { left: 0, top: 0, width: 100, height: 40 }, { fill: 3 });
    expect(validateProject(project([green])).some((f) => f.rule === "colour.abnormalOnly")).toBe(true);
  });
});

describe("applying the pack to a screen drawn without it", () => {
  /** The demo as it was: a green banner, green running lamps, a red fault lamp. */
  const legacy = () => {
    const banner = rectangle("Banner", { left: 0, top: 0, width: 1024, height: 56 }, { fill: GREEN, border: GREEN });
    const title = textBox("Title", "Pump Station", { left: 20, top: 14, width: 400, height: 30 }, { size: 9, colour: WHITE, bold: true });
    const run = lamp("Lamp_RUN", "STOPPED", "RUNNING", { left: 40, top: 100, width: 180, height: 64 });
    const fault = lamp("Lamp_FLT", "OK", "FAULT", { left: 40, top: 180, width: 180, height: 64 });
    if (run.Type === "Lamp") { run.On.Fill = { Color: { Value: GREEN } }; run.On.TextColor = { Color: { Value: WHITE } }; }
    if (fault.Type === "Lamp") { fault.On.Fill = { Color: { Value: RED } }; fault.On.TextColor = { Color: { Value: WHITE } }; }
    return [banner, title, run, fault];
  };

  it("leaves nothing the lint would flag, and says what it changed", () => {
    const before = lintPack(project(legacy()));
    expect(before.some((f) => f.rule === "colour.abnormalOnly")).toBe(true);
    expect(before.some((f) => f.rule === "text.fontFloor")).toBe(true);

    const { parts, changes } = applyPack(legacy(), ISA101, PANEL);
    const after = lintPack(project(parts));
    expect(after.filter((f) => f.rule === "colour.abnormalOnly")).toEqual([]);
    expect(after.filter((f) => f.rule === "text.fontFloor")).toEqual([]);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.some((c) => c.startsWith("Banner Fill"))).toBe(true);
    expect(changes.some((c) => /Title: font 9pt → 12pt/.test(c))).toBe(true);
  });

  it("reads green as running and red as priority 1", () => {
    const { parts } = applyPack(legacy(), ISA101, PANEL);
    const run = parts.find((p) => p.Name === "Lamp_RUN")!;
    const fault = parts.find((p) => p.Name === "Lamp_FLT")!;
    if (run.Type === "Lamp" && fault.Type === "Lamp") {
      expect(run.On.Fill).toEqual({ Color: { Value: ISA101.tokens.white } });
      expect(run.On.Border).toEqual({ Color: { Value: ISA101.tokens.runningLine } });
      expect(run.On.Thickness).toBe(2);
      expect(fault.On.Fill).toEqual({ Color: { Value: ISA101.tokens.alarmP1 } });
      expect(fault.On.TextColor).toEqual({ Color: { Value: ISA101.tokens.onAlarm } });
      // Resting faces untouched: they were neutral already.
      expect(run.Off.Fill).toEqual({ Color: { Value: ISA101.tokens.equipmentFill } });
    }
  });

  it("does not touch what is already on the pack", () => {
    const clean = [lamp("L", "OFF", "ON", { left: 0, top: 0, width: 100, height: 40 })];
    expect(applyPack(clean, ISA101, PANEL).changes).toEqual([]);
  });

  it("is a store action, one undo step, and a conversational op", async () => {
    const { createProjectStore } = await import("@/store/project");
    const { applyOps } = await import("@/lib/ai/applier");
    const store = createProjectStore();
    store.getState().hydrate({
      id: "ap", name: "Apply", target: PANEL,
      screens: [screenOf("Legacy", legacy(), PANEL)], variables: [],
    });
    store.getState().hydrate({ activeScreenId: store.getState().screens[0].UniqueId });
    const outcome = applyOps([{ op: "applyPack", note: "" }], store);
    expect(outcome.rejected).toEqual([]);
    expect(outcome.applied[0]).toMatch(/^Applied the Standard/);
    expect(lintPack({ name: "x", target: PANEL, screens: store.getState().screens, variables: [], alarms: [], wires: [] })
      .filter((f) => f.rule === "colour.abnormalOnly")).toEqual([]);
    store.getState().undo();
    expect(lintPack({ name: "x", target: PANEL, screens: store.getState().screens, variables: [], alarms: [], wires: [] })
      .some((f) => f.rule === "colour.abnormalOnly")).toBe(true);
  });
});
