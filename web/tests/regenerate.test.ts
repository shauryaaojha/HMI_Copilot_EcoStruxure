/**
 * Regenerating a screen as a diff (docs/AUDIT_2026-10.md §5).
 *
 * The fixture is a real generation: the pipeline run offline over a sample
 * plant's tags, its events applied the way the client applies them -
 * generated parts with their keys, the program with its screen. Then the
 * screen is compiled again from that program and diffed. The properties held:
 *
 * - an untouched screen recompiled from unchanged inputs has nothing to do,
 *   which is what proves the keys stable and the compile deterministic;
 * - a hand edit is never overwritten unless ticked;
 * - a matched object keeps its UniqueId, name and bindings;
 * - an object the generator never placed is never touched;
 * - new equipment arrives as additions, dropped equipment as removals;
 * - the store applies a plan as one undoable step.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { runPipeline } from "@/lib/ai/pipeline";
import { parseTags } from "@/lib/tags/parse";
import { recompileScreen, reconstructProgram } from "@/lib/program/recompile";
import { applyRegeneration, planRegeneration, type CurrentScreen } from "@/lib/program/regenerate";
import { createProjectStore } from "@/store/project";
import { rectangle } from "@/lib/ote/parts";
import type { ScreenProgram } from "@/lib/program/program";
import type { GenerationEvent } from "@/types/events";
import type { Part, Variable } from "@/lib/ote/schema";
import type { Binding, CompositeInstance, ObjectMeta } from "@/store/types";

const PANEL = { width: 1024, height: 768 };

interface Generated {
  variables: Variable[];
  screens: { name: string; viewBoxId: string; parts: Part[]; program: ScreenProgram }[];
  meta: Record<string, ObjectMeta>;
  bindings: Binding[];
  composites: CompositeInstance[];
}

/** Run the pipeline offline and keep what the client keeps. */
async function generate(file: string, intent: string): Promise<Generated> {
  for (const k of ["ANTHROPIC_API_KEY", "GEMINI_API_KEY"]) delete process.env[k];
  process.env.AI_PROVIDER = "none";
  const variables = parseTags(readFileSync(join(__dirname, "..", "public", "demo", file)), file).variables;
  const out: Generated = { variables, screens: [], meta: {}, bindings: [], composites: [] };
  const byView = new Map<string, Generated["screens"][number]>();
  for await (const e of runPipeline({ intent, variables, panel: { model: "HMIGTO6310", ...PANEL } }) as AsyncGenerator<GenerationEvent>) {
    if (e.type === "program") {
      const s = { name: e.screenName, viewBoxId: e.parentId, parts: [], program: e.program };
      byView.set(e.parentId, s);
      out.screens.push(s);
    } else if (e.type === "object") {
      byView.get(e.parentId)!.parts.push(e.part);
      if (e.key) out.meta[e.part.UniqueId] = { origin: "generated", key: e.key };
    } else if (e.type === "binding") {
      const part = out.screens.flatMap((s) => s.parts).find((p) => p.Name === e.target)!;
      // As useGeneration applies it: the converter travels with the binding.
      out.bindings.push({ tag: e.tag, targetId: part.UniqueId, targetName: part.Name, property: e.property, ...(e.converter ? { converter: e.converter as Binding["converter"] } : {}) });
    } else if (e.type === "composite") {
      out.composites.push({ id: e.id, kind: e.kind, name: e.name, props: e.props, screenId: e.screenId, partIds: e.partIds });
      for (const id of e.partIds) out.meta[id] = { ...out.meta[id], groupId: e.id };
    }
  }
  return out;
}

function currentOf(g: Generated, index: number): CurrentScreen {
  const s = g.screens[index];
  const ids = new Set(s.parts.map((p) => p.UniqueId));
  return {
    parts: s.parts,
    meta: Object.fromEntries(Object.entries(g.meta).filter(([id]) => ids.has(id))),
    bindings: g.bindings.filter((b) => ids.has(b.targetId)),
    composites: g.composites.filter((c) => c.partIds.some((id) => ids.has(id))),
  };
}

const recompile = (g: Generated, index: number, program = g.screens[index].program, variables = g.variables) =>
  recompileScreen({ screenName: g.screens[index].name, program, screens: g.screens.map((s) => ({ name: s.name, program: s.program })), variables, panel: PANEL });

let g: Generated;
beforeAll(async () => {
  g = await generate("Transfer_Pumps.csv", "Create a transfer pump station screen with every pump, the flow and the tank level");
});

describe("a generated screen, regenerated", () => {
  it("records a recipe per screen and a key per generated part", () => {
    expect(g.screens.length).toBeGreaterThan(0);
    const s = g.screens[0];
    expect(s.program.name).toBe(s.name);
    expect(s.parts.every((p) => g.meta[p.UniqueId]?.key)).toBe(true);
    const keys = s.parts.map((p) => g.meta[p.UniqueId].key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("has nothing to do when nothing changed: keys are stable, the compile deterministic", async () => {
    for (let i = 0; i < g.screens.length; i++) {
      const { fresh } = await recompile(g, i);
      const plan = planRegeneration(currentOf(g, i), fresh);
      expect(plan.units, g.screens[i].name).toEqual([]);
      expect(plan.unchanged).toBeGreaterThan(0);
      expect(plan.untouched).toBe(0);
    }
  });

  it("keeps a hand edit unless ticked, and replaces only what was not touched", async () => {
    const cur = structuredClone(currentOf(g, 0));
    const program = structuredClone(g.screens[0].program);
    const unit = program.faceplates?.[0];
    expect(unit).toBeTruthy();
    // The engineer moved one generated part.
    const moved = cur.parts.find((p) => cur.meta[p.UniqueId].key === "Title") ?? cur.parts[0];
    moved.Location.Left += 40;
    cur.meta[moved.UniqueId].origin = "edited";
    // And a pump's faceplate is dropped from the recipe.
    program.faceplates = program.faceplates!.slice(1);
    const { fresh } = await recompile(g, 0, program);
    const plan = planRegeneration(cur, fresh);
    const edit = plan.units.find((u) => u.current.includes(moved.UniqueId) && u.kind === "update");
    expect(edit).toMatchObject({ protected: true, defaultAccept: false, reason: "kept: edited by hand" });
    expect(edit?.changes).toContain("position");
    const removals = plan.units.filter((u) => u.kind === "remove");
    expect(removals.length).toBeGreaterThan(0);
    expect(removals.every((u) => u.defaultAccept && !u.protected)).toBe(true);

    const taken = new Set(g.screens.flatMap((s) => s.parts.map((p) => p.Name)));
    const out = applyRegeneration(cur, fresh, plan, new Set(plan.units.filter((u) => u.defaultAccept).map((u) => u.id)), taken, "screen-1", () => crypto.randomUUID());
    expect(out.parts.find((p) => p.UniqueId === moved.UniqueId)?.Location.Left).toBe(moved.Location.Left);
    const gone = new Set(removals.flatMap((u) => u.current));
    expect(out.parts.some((p) => gone.has(p.UniqueId))).toBe(false);
    expect(out.bindings.some((b) => gone.has(b.targetId))).toBe(false);
    expect(out.summary.removed).toBe(removals.length);
  });

  it("keeps the UniqueId, name and bindings of what it updates", async () => {
    const cur = structuredClone(currentOf(g, 0));
    // Simulate a library change: every generated part's border colour differs
    // from what would compile now, so every keyed part is an update.
    const victim = cur.parts.find((p) => cur.bindings.some((b) => b.targetId === p.UniqueId))!;
    (victim as unknown as { Width: number }).Width += 8;
    const { fresh } = await recompile(g, 0);
    const plan = planRegeneration(cur, fresh);
    const unit = plan.units.find((u) => u.current.includes(victim.UniqueId))!;
    expect(unit).toMatchObject({ kind: "update", defaultAccept: true });
    const out = applyRegeneration(cur, fresh, plan, new Set([unit.id]), new Set(), "screen-1");
    const after = out.parts.find((p) => p.UniqueId === victim.UniqueId)!;
    expect(after.Name).toBe(victim.Name);
    expect(after.Width).toBe((victim.Width ?? 0) - 8);
    expect(out.bindings.filter((b) => b.targetId === victim.UniqueId).map((b) => b.tag)).toEqual(
      cur.bindings.filter((b) => b.targetId === victim.UniqueId).map((b) => b.tag),
    );
  });

  it("never touches an object the generator did not place", async () => {
    const cur = structuredClone(currentOf(g, 0));
    const mine = rectangle("MyNote", { left: 10, top: 700, width: 50, height: 20 }, {});
    cur.parts.push(mine);
    cur.meta[mine.UniqueId] = { origin: "manual" };
    const program = { ...g.screens[0].program, faceplates: g.screens[0].program.faceplates!.slice(1) };
    const { fresh } = await recompile(g, 0, program);
    const plan = planRegeneration(cur, fresh);
    expect(plan.untouched).toBe(1);
    expect(plan.units.some((u) => u.current.includes(mine.UniqueId))).toBe(false);
    const out = applyRegeneration(cur, fresh, plan, new Set(plan.units.map((u) => u.id)), new Set(), "screen-1");
    expect(out.parts.at(-1)).toEqual(mine);
  });

  it("adds what the recipe gains, named uniquely and bound", async () => {
    const cur = structuredClone(currentOf(g, 0));
    const program = structuredClone(g.screens[0].program);
    const dropped = program.faceplates!.shift()!;
    const smaller = await recompile(g, 0, program);
    // The screen as it would have been without that unit...
    const without = planRegeneration(cur, smaller.fresh);
    const base = applyRegeneration(cur, smaller.fresh, without, new Set(without.units.map((u) => u.id)), new Set(), "s");
    const baseScreen: CurrentScreen = { parts: base.parts, meta: base.meta, bindings: base.bindings, composites: base.composites };
    // ...regenerated with it back.
    program.faceplates!.unshift(dropped);
    const { fresh } = await recompile(g, 0, program);
    const plan = planRegeneration(baseScreen, fresh);
    const adds = plan.units.filter((u) => u.kind === "add");
    expect(adds.length).toBeGreaterThan(0);
    const out = applyRegeneration(baseScreen, fresh, plan, new Set(adds.map((u) => u.id)), new Set(base.parts.map((p) => p.Name)), "s");
    const names = out.parts.map((p) => p.Name);
    expect(new Set(names).size).toBe(names.length);
    expect(out.summary.added).toBe(adds.length);
    const added = out.parts.filter((p) => !base.parts.some((b) => b.UniqueId === p.UniqueId));
    expect(added.every((p) => out.meta[p.UniqueId]?.origin === "generated")).toBe(true);
    expect(out.bindings.length).toBeGreaterThan(base.bindings.length);
  });

  it("matches a screen from before keys by name, and protects what it cannot vouch for", async () => {
    const cur = structuredClone(currentOf(g, 0));
    cur.meta = {};
    const victim = cur.parts[0];
    victim.Location.Top += 16;
    const { fresh } = await recompile(g, 0);
    const plan = planRegeneration(cur, fresh);
    expect(plan.units.filter((u) => u.kind === "add")).toEqual([]);
    const unit = plan.units.find((u) => u.current.includes(victim.UniqueId))!;
    expect(unit).toMatchObject({ protected: true, defaultAccept: false, reason: "kept: origin unknown" });
  });

  it("reconstructs a recipe for a screen that has none", () => {
    const s = g.screens.find((x) => (x.program.faceplates?.length ?? 0) > 0)!;
    const parts = s.parts.map((p) => ({ name: p.Name, type: p.Type }));
    const units = s.program.faceplates!;
    const r = reconstructProgram(s.name, parts, { equipment: [], units: [], connections: [], answers: {}, questions: [], assumptions: [] } as never, units);
    expect(r?.faceplates?.sort()).toEqual([...units].sort());
  });
});

describe("the store applies a plan as one step", () => {
  it("applies, records provenance and recipe, and undoes", async () => {
    const store = createProjectStore();
    const s0 = g.screens[0];
    const screenId = "screen-1";
    store.getState().hydrate({
      id: "p",
      name: "P",
      target: { model: "HMIGTO6310", ...PANEL },
      screens: [{ Type: "Screen", UniqueId: screenId, Name: s0.name, Children: [{ Type: "ViewBox", UniqueId: s0.viewBoxId, Name: "ViewBox", Width: PANEL.width, Height: PANEL.height, Children: structuredClone(s0.parts) }] }] as never,
      variables: g.variables,
      bindings: currentOf(g, 0).bindings,
      objectMeta: currentOf(g, 0).meta,
      composites: Object.fromEntries(currentOf(g, 0).composites.map((c) => [c.id, { ...c, screenId }])),
      programs: { [screenId]: s0.program },
    });
    // An edit by hand demotes a generated part to edited.
    const first = s0.parts[0].UniqueId;
    store.getState().nudge([first], 8, 0);
    expect(store.getState().objectMeta[first].origin).toBe("edited");
    // A hand-placed part is manual; locking it keeps its provenance.
    const note = rectangle("Note", { left: 0, top: 0, width: 8, height: 8 }, {});
    store.getState().appendObject(screenId, note);
    store.getState().setMeta([note.UniqueId], { locked: false });
    expect(store.getState().objectMeta[note.UniqueId].origin).toBe("manual");

    const program = { ...s0.program, faceplates: s0.program.faceplates!.slice(1) };
    const st = store.getState();
    const view = st.screens[0].Children[0].Children;
    const ids = new Set(view.map((p) => p.UniqueId));
    const cur: CurrentScreen = {
      parts: view,
      meta: st.objectMeta,
      bindings: st.bindings.filter((b) => ids.has(b.targetId)),
      composites: Object.values(st.composites),
    };
    const { fresh } = await recompile(g, 0, program);
    const plan = planRegeneration(cur, fresh);
    const before = st.screens[0].Children[0].Children.length;
    const summary = store.getState().applyRegeneration(screenId, fresh, plan, plan.units.filter((u) => u.defaultAccept).map((u) => u.id), program);
    expect(summary.removed).toBeGreaterThan(0);
    const after = store.getState();
    expect(after.screens[0].Children[0].Children.length).toBeLessThan(before);
    expect(after.programs[screenId].faceplates).toEqual(program.faceplates);
    expect(after.screens[0].Children[0].Children.some((p) => p.UniqueId === note.UniqueId)).toBe(true);
    const boundIds = new Set(after.screens[0].Children[0].Children.map((p) => p.UniqueId));
    expect(after.bindings.every((b) => boundIds.has(b.targetId))).toBe(true);

    store.getState().undo();
    expect(store.getState().screens[0].Children[0].Children.length).toBe(before);
  });
});
