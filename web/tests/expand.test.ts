/**
 * The scope of a change (lib/ai/expand.ts): one op for "all screens", "every
 * lamp", "the boilers screen", resolved into the plain ops it stands for.
 *
 * The session that found this: "change for all screens" changed the active
 * screen only, and the next turn invented handles (o1197_bg) for the other
 * ten backgrounds and had every op rejected.
 */

import { describe, expect, it } from "vitest";
import { expandOps, type ExpandState } from "@/lib/ai/expand";
import { coerceTurn, type Op } from "@/lib/ai/ops";
import { applyOps } from "@/lib/ai/applier";
import { inferEquipment } from "@/lib/ai/infer";
import { fallbackPlan } from "@/lib/ai/plan";
import { layoutApplication } from "@/lib/ote/layout";
import { colorIndexOf, BROWN } from "@/lib/ote/palette";
import type { Part, Screen, Variable } from "@/lib/ote/schema";
import { createProjectStore } from "@/store/project";

const tag = (Name: string, DataType: Variable["DataType"] = "BOOL", Comments = ""): Variable => ({ Name, DataType, Comments, DeviceAddress: "" });

const variables: Variable[] = [
  ...[101, 102, 103, 104, 105, 106, 107].flatMap((n) => [tag(`PMP_${n}_RUN`), tag(`PMP_${n}_FLT`), tag(`FT_${n}_PV`, "REAL", "flow LPM")]),
  ...[201, 202].flatMap((n) => [tag(`BLR_${n}_RUN`), tag(`BLR_${n}_FLT`)]),
];

/** A generated application: several screens, each with its own chrome. */
function application(): Screen[] {
  const equipment = inferEquipment(variables);
  const plan = fallbackPlan("the whole plant", equipment);
  return layoutApplication(plan.screens, equipment, { width: 1024, height: 600 }).map((l) => l.screen);
}

function stateOf(screens: Screen[]): ExpandState {
  const handles: Record<string, string> = {};
  screens.forEach((s, i) => (handles[s.UniqueId] = `s${i + 1}`));
  let n = 1;
  for (const s of screens) for (const p of s.Children[0].Children) handles[p.UniqueId] = `o${n++}`;
  return { screens, activeScreenId: screens[0].UniqueId, handles, bindings: [] };
}

const partOf = (screens: Screen[], name: string): Part => {
  for (const s of screens) {
    const p = s.Children[0].Children.find((x) => x.Name === name);
    if (p) return p;
  }
  throw new Error(`no ${name}`);
};

describe("expandOps", () => {
  const screens = application();
  const state = stateOf(screens);

  it("has an application of several screens to work on", () => {
    expect(screens.length).toBeGreaterThan(2);
  });

  it("puts one op on every screen's background for screens all", () => {
    const { ops, rejected } = expandOps([{ op: "setColor", select: "background", screens: ["all"], color: "brown" } as Op], state);
    expect(rejected).toEqual([]);
    expect(ops).toHaveLength(screens.length);
    const targets = ops.map((o) => o.target);
    for (const s of screens) expect(targets).toContain(state.handles[partOf(screens, `Ground_${s.Name}`).UniqueId]);
    // No scope fields survive: the applier sees plain ops.
    for (const o of ops) expect(o).not.toHaveProperty("screens");
  });

  it("finds a handle's copy on every screen, by name stem", () => {
    const first = partOf(screens, `Foot_${screens[0].Name}`);
    const { ops } = expandOps([{ op: "deleteObject", target: state.handles[first.UniqueId], screens: ["all"] } as Op], state);
    expect(ops).toHaveLength(screens.length);
  });

  it("finds a copy by position when the names say nothing", () => {
    const a = structuredClone(screens.slice(0, 2));
    const box = { Type: "Rectangle", UniqueId: "r1", Name: "Logo", Location: { Left: 900, Top: 8 }, Width: 100, Height: 40 } as unknown as Part;
    a[0].Children[0].Children.push(box);
    a[1].Children[0].Children.push({ ...box, UniqueId: "r2", Name: "Badge" } as Part);
    const st = stateOf(a);
    const { ops } = expandOps([{ op: "setColor", target: "Logo", screens: ["all"], color: "navy" } as Op], st);
    expect(ops.map((o) => o.target)).toEqual([st.handles.r1, st.handles.r2]);
  });

  it("resolves a screen by handle, by name, and by a spelling an engineer would use", () => {
    const named = screens[1];
    for (const ref of [`s2`, named.Name, named.Name.toLowerCase().replace(/(\d)/, " $1")]) {
      const { ops, rejected } = expandOps([{ op: "setColor", select: "header", screens: [ref], color: "grey" } as Op], state);
      expect(rejected, ref).toEqual([]);
      expect(ops.map((o) => o.screen), ref).toEqual(["s2"]);
    }
  });

  it("names the screens there are when one does not exist", () => {
    const { ops, rejected } = expandOps([{ op: "setColor", select: "header", screens: ["Turbine"], color: "grey" } as Op], state);
    expect(ops).toEqual([]);
    expect(rejected[0].reason).toMatch(/No screen called Turbine; the screens are s1 /);
  });

  it("selects by part type and narrows by text", () => {
    const lamps = screens[1].Children[0].Children.filter((p) => p.Type === "Lamp");
    const { ops } = expandOps([{ op: "resizeObject", select: "Lamp", screens: [screens[1].Name], width: 60, height: 30 } as Op], state);
    expect(ops).toHaveLength(lamps.length);
    const some = lamps[0].Name.match(/PMP_?\d+|BLR_?\d+/)?.[0] ?? lamps[0].Name;
    const narrowed = expandOps([{ op: "resizeObject", select: "Lamp", selectText: some, screens: ["all"], width: 60 } as Op], state).ops;
    expect(narrowed.length).toBeGreaterThan(0);
    expect(narrowed.length).toBeLessThan(screens.flatMap((s) => s.Children[0].Children).filter((p) => p.Type === "Lamp").length);
  });

  it("repeats an add on every screen, each with its own name", () => {
    const { ops } = expandOps([{ op: "addObject", type: "TextBox", text: "Line 1", name: "LineLabel", screens: ["all"] } as Op], state);
    expect(ops).toHaveLength(screens.length);
    expect(new Set(ops.map((o) => o.name)).size).toBe(screens.length);
    expect(ops.map((o) => o.screen)).toEqual(screens.map((_, i) => `s${i + 1}`));
  });

  it("aligns a set per screen: one op on each screen, holding that screen's matches", () => {
    const { ops, rejected } = expandOps([{ op: "alignObjects", select: "Lamp", mode: "top", screens: ["all"] } as Op], state);
    expect(rejected).toEqual([]);
    const withLamps = screens.filter((sc) => sc.Children[0].Children.some((p) => p.Type === "Lamp"));
    expect(ops).toHaveLength(withLamps.length);
    for (const o of ops) expect(o.targets!.length).toBeGreaterThan(0);
  });

  it("leaves an op with no scope exactly as it was", () => {
    const op = { op: "setText", target: "o3", text: "x" } as Op;
    expect(expandOps([op], state).ops).toEqual([op]);
  });
});

describe("a scoped op, applied", () => {
  it("turns every screen's background brown in one op", () => {
    const store = createProjectStore();
    const screens = application();
    store.getState().hydrate({ id: "t", name: "T", target: { model: "HMIST6500AWADI", width: 1024, height: 600 }, screens, activeScreenId: screens[0].UniqueId, variables });
    const turn = coerceTurn({ mode: "edit", reply: "Brown backgrounds.", ops: [{ op: "setColor", select: "background", screens: ["all"], color: "brown", note: "brown background" }] })!;
    expect(turn.ops).toHaveLength(1);

    const outcome = applyOps(turn.ops!, store);
    expect(outcome.rejected).toEqual([]);
    // One line for the request, with how far it reached.
    expect(outcome.applied).toEqual([`brown background — ${screens.length} objects`]);
    for (const s of store.getState().screens) {
      const ground = s.Children[0].Children.find((p) => p.Name === `Ground_${s.Name}`)!;
      expect(colorIndexOf(ground, "Fill"), s.Name).toBe(BROWN);
    }
  });
});

describe("a fanned-out op that is refused", () => {
  it("is refused in one line that says how far, not once per screen", () => {
    const store = createProjectStore();
    const screens = application();
    store.getState().hydrate({ id: "t", name: "T", target: { model: "HMIST6500AWADI", width: 1024, height: 600 }, screens, variables });
    const outcome = applyOps([{ op: "setColor", select: "background", screens: ["all"], color: "pink", note: "pink background" } as unknown as Op], store);
    expect(outcome.applied).toEqual([]);
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0].reason).toMatch(new RegExp(`and the same on ${screens.length - 1} more$`));
  });
});

describe("a select with no screen named", () => {
  it("looks past the active screen when nothing there matches", () => {
    const screens = application();
    const state = stateOf(screens);
    const hasBoilerLamp = (sc: Screen) => sc.Children[0].Children.some((p) => p.Type === "Lamp" && p.Name.includes("BLR"));
    const without = screens.find((sc) => !hasBoilerLamp(sc))!;
    expect(without).toBeDefined();
    expect(screens.some(hasBoilerLamp)).toBe(true);
    const { ops } = expandOps([{ op: "setColor", select: "Lamp", selectText: "BLR", color: "amber" } as Op], { ...state, activeScreenId: without.UniqueId });
    expect(ops.length).toBeGreaterThan(0);
    expect(new Set(ops.map((o) => o.screen))).not.toContain(state.handles[without.UniqueId]);
  });
});

describe("addAlarm", () => {
  const seed = () => {
    const store = createProjectStore();
    store.getState().hydrate({
      id: "t", name: "T", target: { model: "HMIST6500AWADI", width: 1024, height: 600 },
      screens: application(), variables: [...variables, tag("TT_401_PV", "REAL", "Milk fridge temperature degC")],
    });
    return store;
  };

  it("words the message from the tag's comment, not its name", () => {
    const store = seed();
    applyOps([{ op: "addAlarm", tag: "TT_401_PV", alarmType: 2, value: "7" } as Op], store);
    expect(store.getState().alarms.at(-1)).toMatchObject({ Message: "Milk fridge temperature degC high", Value: "7" });
  });

  it("updates the alarm already on a condition rather than raising it twice", () => {
    const store = seed();
    applyOps([{ op: "addAlarm", tag: "TT_401_PV", alarmType: 2, value: "7", message: "Milk too warm" } as Op], store);
    const outcome = applyOps([{ op: "addAlarm", tag: "TT_401_PV", alarmType: 2, value: "6" } as Op], store);
    const on = store.getState().alarms.filter((a) => a.Trigger === "TT_401_PV");
    expect(on).toHaveLength(1);
    expect(on[0]).toMatchObject({ Message: "Milk too warm", Value: "6" });
    expect(outcome.applied[0]).toMatch(/^Updated alarm/);
  });

  it("keeps a high and a low on the same tag as two alarms", () => {
    const store = seed();
    applyOps([{ op: "addAlarm", tag: "TT_401_PV", alarmType: 2, value: "7" } as Op, { op: "addAlarm", tag: "TT_401_PV", alarmType: 3, value: "1" } as Op], store);
    expect(store.getState().alarms.filter((a) => a.Trigger === "TT_401_PV")).toHaveLength(2);
  });
});
