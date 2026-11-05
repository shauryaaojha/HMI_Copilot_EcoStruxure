/**
 * Design B phase 4: a component is asked for by what it is, from chat, the
 * agent and the connector alike, and never by a number or a colour.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyOps, type Op } from "@/core/ops";
import { coerceTurn } from "@/core/ops/ops";
import { BENCHED_PARTS, COMPONENT_KINDS, COMPONENTS, DEFAULT_THEME } from "@/lib/components";
import { componentCatalogue, componentUse } from "@/lib/components/place";
import { contextFor, TOOLS } from "@/lib/agent/tools";
import { Workspace } from "@/lib/agent/workspace";
import { READ_TOOLS } from "@/lib/mcp/read";
import { WRITE_TOOLS } from "@/lib/mcp/write";
import { applyRegeneration } from "@/lib/program/regenerate";
import { createProjectStore } from "@/store/project";
import type { Part, Variable } from "@/lib/ote/schema";

const FILE = path.resolve(import.meta.dirname, "../../demo_project/HMICopilot_Bars.eote");

const tag = (Name: string, DataType = "BOOL"): Variable => ({ Name, DataType } as Variable);
const TAGS = [
  tag("PMP_101_RUN"), tag("PMP_101_FAULT"), tag("PMP_101_SPEED", "REAL"),
  tag("TNK_101_LEVEL", "REAL"), tag("TNK_101_HIGH"),
];

function fresh() {
  const store = createProjectStore();
  const s = store.getState();
  s.hydrate({ name: "T", target: { Width: 800, Height: 600 }, variables: TAGS, screens: [], alarms: [], bindings: [] } as never);
  store.getState().addScreen("Main");
  return store;
}
const partsOf = (store: ReturnType<typeof fresh>) => store.getState().screens[0].Children[0].Children as Part[];
const instanceOf = (store: ReturnType<typeof fresh>, kind: string) => Object.values(store.getState().composites).find((c) => c.kind === kind)!;

describe("asking for a component", () => {
  it("coerceTurn keeps which drawing and how big", () => {
    const turn = coerceTurn({ mode: "edit", reply: "ok", ops: [{ op: "addObject", type: "Pump", variant: "pictorial", size: "L", equipment: "PMP_101", note: "n" }] });
    const op = turn?.ops?.[0] as Op;
    expect(op).toMatchObject({ type: "Pump", size: "L", variant: "pictorial", equipment: "PMP_101" });
  });

  it("every kind lands as a valid instance: on the grid, in the panel, of parts the bench has seen", () => {
    for (const kind of COMPONENT_KINDS) {
      const store = fresh();
      const outcome = applyOps([{ op: "addObject", type: kind, screen: "Main", name: kind }] as Op[], store);
      expect(outcome.rejected, kind).toEqual([]);
      const instance = instanceOf(store, kind);
      expect(instance.use?.kind, kind).toBe(kind);
      expect(instance.use?.variant, kind).toBe(COMPONENTS[kind].variants[0]);
      const parts = partsOf(store);
      expect(parts.length, kind).toBeGreaterThan(0);
      expect(parts.map((p) => p.UniqueId).sort(), kind).toEqual([...instance.partIds].sort());
      for (const part of parts) {
        expect((BENCHED_PARTS as readonly string[]).includes(part.Type), `${kind} ${part.Type}`).toBe(true);
        expect(part.Location.Left % DEFAULT_THEME.grid.unit, `${kind} ${part.Name}`).toBe(0);
        expect(part.Location.Top % DEFAULT_THEME.grid.unit, `${kind} ${part.Name}`).toBe(0);
        expect(part.Location.Left + (part.Width ?? 0), kind).toBeLessThanOrEqual(800);
        expect(part.Location.Top + (part.Height ?? 0), kind).toBeLessThanOrEqual(600);
      }
    }
  });

  it("draws every variant at every size, or says why not", () => {
    for (const kind of COMPONENT_KINDS) {
      for (const variant of COMPONENTS[kind].variants) {
        for (const size of ["S", "M", "L"] as const) {
          const store = fresh();
          const outcome = applyOps([{ op: "addObject", type: kind, screen: "Main", variant, size }] as Op[], store);
          expect(outcome.rejected.map((r) => r.reason), `${kind} ${variant} ${size}`).toEqual([]);
          expect(instanceOf(store, kind).partIds.length, `${kind} ${variant} ${size}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("says what there is when a variant or a role does not exist", () => {
    expect(() => componentUse({ kind: "Pump", variant: "nope" })).toThrow(/has no variant nope; it has /);
    expect(() => componentUse({ kind: "Pump", tags: { nope: "X" } })).toThrow(/has no role nope; it has /);
    const store = fresh();
    const outcome = applyOps([{ op: "addObject", type: "Pump", screen: "Main", variant: "nope" }] as Op[], store);
    expect(outcome.rejected[0].reason).toMatch(/has no variant nope/);
    expect(partsOf(store)).toEqual([]);
  });

  it("refuses a tag or a unit the project does not have, and draws nothing", () => {
    const store = fresh();
    const a = applyOps([{ op: "addObject", type: "Pump", screen: "Main", equipment: "PMP_999" }] as Op[], store);
    expect(a.rejected[0].reason).toMatch(/No equipment called PMP_999/);
    const b = applyOps([{ op: "addObject", type: "Pump", screen: "Main", tag: "NOT_A_TAG" }] as Op[], store);
    expect(b.rejected[0].reason).toMatch(/NOT_A_TAG/);
    expect(partsOf(store)).toEqual([]);
  });

  it("the catalogue names what can be asked for", () => {
    const catalogue = componentCatalogue();
    expect(catalogue.map((c) => c.kind)).toEqual([...COMPONENT_KINDS]);
    expect(catalogue.find((c) => c.kind === "Pump")!.roles.some((r) => r.required)).toBe(true);
  });
});

describe("a recorded session: add a pump for PMP_101 next to the tank", () => {
  const session: Op[] = [
    { op: "addObject", type: "Tank", screen: "Main", name: "Tank_1", equipment: "TNK_101" },
    { op: "addObject", type: "Pump", screen: "Main", name: "Pump_1", equipment: "PMP_101", place: { anchor: "Tank_1_Body", side: "rightOf" } },
  ] as Op[];
  const replay = () => {
    const store = fresh();
    const outcome = applyOps(session, store);
    return {
      outcome,
      store,
      drawn: partsOf(store).map((p) => [p.Name, p.Type, p.Location.Left, p.Location.Top, p.Width, p.Height].join(" ")),
      wires: store.getState().bindings.map((b) => `${b.targetName}.${b.property}=${b.tag}`).sort(),
    };
  };

  it("draws the same parts every time, with no number and no colour asked for", () => {
    const first = replay();
    expect(first.outcome.rejected.map((r) => r.reason)).toEqual([]);
    const second = replay();
    expect(second.drawn).toEqual(first.drawn);
    expect(second.wires).toEqual(first.wires);
    expect(first.drawn).toMatchSnapshot("parts");
    expect(first.wires).toMatchSnapshot("wires");
  });

  it("binds the unit's tags by role, and puts the pump right of the tank", () => {
    const { store, wires } = replay();
    expect(wires.join()).toMatch(/PMP_101_RUN/);
    expect(wires.join()).toMatch(/TNK_101_LEVEL/);
    const left = (name: string) => Math.min(...instanceOf(store, name).partIds.map((id) => partsOf(store).find((p) => p.UniqueId === id)!.Location.Left));
    const right = (name: string) => Math.max(...instanceOf(store, name).partIds.map((id) => {
      const p = partsOf(store).find((x) => x.UniqueId === id)!;
      return p.Location.Left + (p.Width ?? 0);
    }));
    expect(left("Pump")).toBeGreaterThanOrEqual(right("Tank"));
  });
});

describe("setColor by token", () => {
  it("takes a meaning and paints the theme's colour", () => {
    const store = fresh();
    applyOps([{ op: "addObject", type: "Rectangle", screen: "Main", name: "Box_1" }] as Op[], store);
    const outcome = applyOps([{ op: "setColor", target: "Box_1", token: "alarmP1" }] as Op[], store);
    expect(outcome.rejected).toEqual([]);
    expect(outcome.applied.join()).toMatch(/alarmP1/);
    const painted = JSON.stringify(partsOf(store)[0]);
    expect(painted).toContain(String(DEFAULT_THEME.tokens.alarmP1));
  });
});

describe("re-expanding a placed component", () => {
  const placed = () => {
    const store = fresh();
    applyOps([{ op: "addObject", type: "Pump", screen: "Main", name: "Pump_1", equipment: "PMP_101", place: { region: "body" } }] as Op[], store);
    const instance = instanceOf(store, "Pump");
    return { store, instance };
  };
  const corner = (store: ReturnType<typeof fresh>) => ({
    left: Math.min(...partsOf(store).map((p) => p.Location.Left)),
    top: Math.min(...partsOf(store).map((p) => p.Location.Top)),
  });

  it("keeps its place and its tags when a property changes", () => {
    const { store, instance } = placed();
    const before = corner(store);
    const wires = store.getState().bindings.map((b) => b.tag).sort();
    store.getState().setCompositeProps(instance.id, { label: "Feed pump" });
    expect(corner(store)).toEqual(before);
    expect(store.getState().bindings.map((b) => b.tag).sort()).toEqual(wires);
    expect(JSON.stringify(partsOf(store))).toContain("Feed pump");
    expect(instanceOf(store, "Pump").use!.props.label).toBe("Feed pump");
  });

  it("changes size and unbinds a role, in one step each", () => {
    const { store, instance } = placed();
    const before = corner(store);
    store.getState().setCompositeProps(instance.id, {}, { size: "L" });
    expect(instanceOf(store, "Pump").size).toBe("L");
    expect(corner(store)).toEqual(before);
    const role = Object.keys(instanceOf(store, "Pump").use!.tags)[0];
    store.getState().setCompositeProps(instance.id, {}, { tags: { [role]: "" } });
    expect(instanceOf(store, "Pump").use!.tags[role]).toBeUndefined();
    store.getState().undo();
    expect(instanceOf(store, "Pump").use!.tags[role]).toBeDefined();
  });

  it("leaves everything as it was when the ask cannot be drawn", () => {
    const { store, instance } = placed();
    const before = JSON.stringify(partsOf(store));
    expect(() => store.getState().setCompositeProps(instance.id, {}, { variant: "nope" })).not.toThrow();
    expect(JSON.stringify(partsOf(store))).toBe(before);
    expect(instanceOf(store, "Pump").use!.variant).toBe(instance.use!.variant);
  });
});

describe("regeneration", () => {
  it("is imported where the instance is carried", () => {
    expect(typeof applyRegeneration).toBe("function");
    const source = readFileSync(path.resolve(import.meta.dirname, "../src/lib/program/regenerate.ts"), "utf8");
    expect(source).toMatch(/old\?\.use && old\.kind === comp\.kind/);
  });
});

describe("the agent places a component", () => {
  async function open() {
    const ws = await Workspace.open(new Uint8Array(readFileSync(FILE)), "sample.eote");
    const ctx = contextFor(ws);
    const call = async (name: string, input: Record<string, unknown>) => TOOLS.find((t) => t.name === name)!.run(ctx, input);
    return { ctx, call };
  }

  it("with no coordinate and no colour in the call, and the project reads back", async () => {
    const { ctx, call } = await open();
    // A full screen says so; the first screen with room takes it.
    const screens = (await ctx.read()).screens.map((s) => s.Name);
    let placedOn: string | undefined;
    for (const screen of screens) {
      const out = await call("place_component", { screen, kind: "StatusTile", size: "S", name: "Level_Tile" });
      if (!out.isError) { placedOn = screen; break; }
      expect(out.text).toMatch(/no free space/);
    }
    expect(placedOn, "no screen in the sample has room").toBeDefined();
    const read = await ctx.read();
    const parts = read.screens.find((s) => s.Name === placedOn)!.Children[0].Children;
    expect(parts.some((p) => p.Name.startsWith("Level_Tile"))).toBe(true);
  });

  it("is told what is wrong rather than guessed at", async () => {
    const { ctx, call } = await open();
    const screen = (await ctx.read()).screens[0].Name;
    expect((await call("place_component", { screen, kind: "Spaceship" })).isError).toBe(true);
    const out = await call("place_component", { screen, kind: "Pump", variant: "nope" });
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/has no variant nope/);
  });

  it("can read the catalogue first", async () => {
    const { call } = await open();
    const out = await call("components", {});
    expect(JSON.parse(out.text).map((c: { kind: string }) => c.kind)).toEqual([...COMPONENT_KINDS]);
  });
});

describe("the connector", () => {
  it("offers the catalogue to read and placing to write", () => {
    expect(READ_TOOLS.some((t) => t.name === "components")).toBe(true);
    expect(WRITE_TOOLS.some((t) => t.name === "place_component")).toBe(true);
  });
});
