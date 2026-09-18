/**
 * Composites. docs/ARCHITECTURE_SCREEN_QUALITY.md §3.3, Phase 3 item 2.
 *
 * A composite expands to parts the packager writes and the pack allows; the
 * store keeps it an object the inspector edits; a prop change re-expands it
 * in place; the generator builds faceplate readings from it; the
 * conversation can add one. Ungrouping or deleting a part makes it parts.
 */

import { describe, expect, it } from "vitest";
import { Part } from "@/lib/ote/schema";
import { COMPOSITES, COMPOSITE_KINDS, expandComposite, propsFor, unionBox } from "@/lib/composites";
import { lintPack } from "@/lib/standard/lint";
import { screenOf } from "@/lib/ote/parts";
import { layoutApplication } from "@/lib/ote/layout";
import { inferEquipment } from "@/lib/ai/infer";
import { fallbackPlan } from "@/lib/ai/plan";
import { applyOps } from "@/lib/ai/applier";
import { createProjectStore } from "@/store/project";
import { fieldsOfSchema } from "@/components/inspector/schemaFields";
import { TOOLS } from "@/components/canvas/newPart";
import { demoScreen, demoVariables } from "@/fixtures";

const PANEL = { model: "HMIGTO6310", width: 1024, height: 600 };
const box = { left: 48, top: 96, width: 144, height: 184 };

function seeded() {
  const store = createProjectStore();
  const screen = structuredClone(demoScreen);
  screen.Children[0].Children = screen.Children[0].Children.slice(0, 1);
  store.getState().hydrate({
    id: "c",
    name: "Composites",
    target: PANEL,
    screens: [screen],
    activeScreenId: screen.UniqueId,
    variables: structuredClone(demoVariables),
  });
  return store;
}

describe("every composite expands to parts the product accepts", () => {
  for (const kind of COMPOSITE_KINDS) {
    it(`${kind} parses, lints clean, and is a tool`, () => {
      const def = COMPOSITES[kind];
      const { parts, wires } = expandComposite(kind, propsFor(kind, { tag: "FT_101_PV", runTag: "PMP_101_RUN", faultTag: "PMP_101_FLT" }), { left: 40, top: 96, ...def.size }, "X");
      expect(parts.length).toBeGreaterThan(1);
      for (const p of parts) expect(Part.safeParse(p).success, p.Name).toBe(true);
      // Nothing outside the composite's own box, and everything inside the pack.
      const union = unionBox(parts)!;
      expect(union.left).toBeGreaterThanOrEqual(40);
      expect(union.top).toBeGreaterThanOrEqual(96);
      expect(union.left + union.width).toBeLessThanOrEqual(40 + def.size.width);
      expect(union.top + union.height).toBeLessThanOrEqual(96 + def.size.height);
      const findings = lintPack({ name: "t", target: PANEL, screens: [screenOf("S", parts, PANEL)], variables: [], alarms: [], wires: [] });
      expect(findings.filter((f) => f.rule === "colour.abnormalOnly" || f.rule === "text.fontFloor")).toEqual([]);
      // Wires point at real parts.
      for (const w of wires) expect(parts[w.index], `${kind} wire ${w.tag}`).toBeDefined();
      expect(TOOLS.some((t) => t.type === kind)).toBe(true);
    });
  }

  it("an indicator's band sits where the normal range is", () => {
    const { parts } = expandComposite("AnalogIndicator", propsFor("AnalogIndicator", { min: 0, max: 100, normalLow: 50, normalHigh: 100 }), box, "I");
    const scale = parts.find((p) => p.Name === "I_Scale")!;
    const band = parts.find((p) => p.Name === "I_Band")!;
    // Top half of the scale: the band starts at the scale's top and ends at its middle.
    expect(band.Location.Top).toBe(scale.Location.Top);
    expect(band.Height).toBeCloseTo(scale.Height / 2, 0);
  });

  it("props fill from the defaults and refuse nonsense", () => {
    expect(propsFor("KpiTile", { label: "Flow" })).toMatchObject({ label: "Flow", units: "m3/h", trend: true });
    expect(() => propsFor("AnalogIndicator", { decimals: 9 })).toThrow();
  });
});

describe("the store keeps a composite an object", () => {
  it("adds one: grouped, bound, one undo step", () => {
    const store = seeded();
    const s = store.getState();
    const before = s.screens[0].Children[0].Children.length;
    const id = s.addComposite(s.screens[0].UniqueId, "AnalogIndicator", { label: "Flow", tag: "FT_101_PV", units: "LPM" }, box);
    const after = store.getState();
    const instance = after.composites[id];
    expect(instance).toBeDefined();
    expect(after.screens[0].Children[0].Children.length).toBe(before + instance.partIds.length);
    for (const pid of instance.partIds) expect(after.objectMeta[pid]?.groupId).toBe(id);
    expect(after.bindings.some((b) => b.tag === "FT_101_PV" && instance.partIds.includes(b.targetId))).toBe(true);
    expect(after.selectedIds).toEqual(instance.partIds);
    store.getState().undo();
    expect(store.getState().screens[0].Children[0].Children.length).toBe(before);
  });

  it("re-expands in place on a prop change: same index, same box, new names kept", () => {
    const store = seeded();
    const s = store.getState();
    const id = s.addComposite(s.screens[0].UniqueId, "AnalogIndicator", { label: "Flow", tag: "FT_101_PV" }, box, "Ind_Flow");
    const children = () => store.getState().screens[0].Children[0].Children;
    const firstIndex = children().findIndex((p) => store.getState().composites[id].partIds.includes(p.UniqueId));
    const boxBefore = unionBox(children().filter((p) => store.getState().composites[id].partIds.includes(p.UniqueId)))!;

    store.getState().setCompositeProps(id, { normalHigh: 60, units: "m3/h" });

    const instance = store.getState().composites[id];
    expect(instance.props).toMatchObject({ normalHigh: 60, units: "m3/h", label: "Flow" });
    expect(children().findIndex((p) => instance.partIds.includes(p.UniqueId))).toBe(firstIndex);
    expect(unionBox(children().filter((p) => instance.partIds.includes(p.UniqueId)))).toEqual(boxBefore);
    expect(children().find((p) => p.Name === "Ind_Flow_Unit")).toBeDefined();
    expect(children().some((p) => p.Name === "Ind_Flow_Unit_2")).toBe(false);
    expect(store.getState().bindings.filter((b) => b.tag === "FT_101_PV")).toHaveLength(1);
  });

  it("stops being a composite when a part is deleted or it is ungrouped", () => {
    const store = seeded();
    const s = store.getState();
    const a = s.addComposite(s.screens[0].UniqueId, "KpiTile", { label: "A", tag: "FT_101_PV" }, { left: 40, top: 96, width: 208, height: 120 });
    const b = s.addComposite(s.screens[0].UniqueId, "KpiTile", { label: "B" }, { left: 300, top: 96, width: 208, height: 120 });
    store.getState().removeObjects([store.getState().composites[a].partIds[1]]);
    expect(store.getState().composites[a]).toBeUndefined();
    store.getState().ungroup(store.getState().composites[b].partIds);
    expect(store.getState().composites[b]).toBeUndefined();
    expect(store.getState().screens[0].Children[0].Children.some((p) => p.Name.startsWith("KpiTile"))).toBe(true);
  });

  it("survives reset", () => {
    const store = seeded();
    const s = store.getState();
    s.addComposite(s.screens[0].UniqueId, "KpiTile", { label: "A" }, { left: 40, top: 96, width: 208, height: 120 });
    store.getState().reset();
    expect(store.getState().composites).toEqual({});
  });
});

describe("the inspector and the conversation reach it", () => {
  it("derives an editor from the props schema", () => {
    const fields = fieldsOfSchema(COMPOSITES.AnalogIndicator.props);
    expect(fields.map((f) => f.key)).toEqual(["label", "tag", "units", "min", "max", "normalLow", "normalHigh", "decimals"]);
    expect(fields.find((f) => f.key === "decimals")?.kind).toBe("integer");
  });

  it("adds a composite from an op, bound to the tag it names", () => {
    const store = seeded();
    const outcome = applyOps([{ op: "addObject", type: "AnalogIndicator", text: "Discharge flow", tag: "FT_101_PV", place: { region: "body" }, note: "n" }], store);
    expect(outcome.rejected).toEqual([]);
    expect(outcome.created).toHaveLength(1);
    expect(outcome.created[0].type).toBe("AnalogIndicator");
    const s = store.getState();
    const instance = Object.values(s.composites)[0];
    expect(instance.props.label).toBe("Discharge flow");
    expect(s.bindings.some((b) => b.tag === "FT_101_PV")).toBe(true);
  });
});

describe("the generator builds readings from indicators", () => {
  it("every faceplate reading is an AnalogIndicator instance the store can adopt", () => {
    const equipment = inferEquipment(demoVariables);
    const plan = fallbackPlan("pump station", equipment);
    const screens = layoutApplication(plan.screens, equipment, PANEL);
    const withReadings = screens.filter((s) => s.composites.length > 0);
    expect(withReadings.length).toBeGreaterThan(0);
    for (const laid of withReadings) {
      const ids = new Set(laid.parts.map((p) => p.UniqueId));
      for (const c of laid.composites) {
        expect(c.kind).toBe("AnalogIndicator");
        expect(c.screenId).toBe(laid.screen.UniqueId);
        for (const pid of c.partIds) expect(ids.has(pid)).toBe(true);
        // Its value is wired to the reading's tag.
        expect(laid.wires.some((w) => c.partIds.includes(w.part.UniqueId) && w.tag === c.props.tag)).toBe(true);
      }
      // Still nothing outside the pack.
      const findings = lintPack({ name: "t", target: PANEL, screens: [laid.screen], variables: [], alarms: [], wires: [] });
      expect(findings.filter((f) => f.rule === "colour.abnormalOnly" || f.rule === "text.fontFloor")).toEqual([]);
    }
    // And the store adopts them: grouped and editable.
    const store = createProjectStore();
    const laid = withReadings[0];
    store.getState().hydrate({ id: "g", name: "Gen", target: PANEL, screens: [laid.screen], activeScreenId: laid.screen.UniqueId, variables: structuredClone(demoVariables) });
    for (const c of laid.composites) store.getState().registerComposite(c);
    const c = laid.composites[0];
    expect(store.getState().objectMeta[c.partIds[0]]?.groupId).toBe(c.id);
    store.getState().setCompositeProps(c.id, { normalHigh: 90 });
    expect(store.getState().composites[c.id].props.normalHigh).toBe(90);
  });
});
