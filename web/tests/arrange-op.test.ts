import { describe, expect, it } from "vitest";
import { applyOps } from "@/core/ops/apply";
import { coerceTurn, type Op } from "@/core/ops/ops";
import { TOOLS } from "@/lib/agent/tools";
import { READ_TOOLS } from "@/lib/mcp/read";
import { digestOf, volatileContext } from "@/lib/ai/converse";
import { createProjectStore } from "@/store/project";
import type { Part, Screen } from "@/lib/ote/schema";

const part = (id: string, left: number, top: number): Part =>
  ({ Type: "Rectangle", UniqueId: id, Name: id, Location: { Left: left, Top: top }, Width: 40, Height: 24 }) as Part;

function seeded() {
  const screen = { Type: "Screen", UniqueId: "s", Name: "S", Children: [{ Type: "ViewBox", UniqueId: "v", Name: "V", Width: 320, Height: 240,
    Children: [part("a", 20, 20), part("b", 100, 80), part("other", 220, 160)] }] } as Screen;
  const store = createProjectStore();
  store.getState().hydrate({ id: "p", name: "P", target: { model: "test", width: 320, height: 240 }, screens: [screen], activeScreenId: "s", variables: [] });
  return store;
}

describe("arrange op", () => {
  it("aligns through the solver and leaves an unrelated unit bit-identical", () => {
    const store = seeded();
    const before = structuredClone(store.getState().screens[0].Children[0].Children[2]);
    const outcome = applyOps([{ op: "arrange", screen: "s", constraints: [{ id: "left", kind: "align", units: ["a", "b"], edge: "left" }] }] as Op[], store);
    expect(outcome.rejected).toEqual([]);
    const after = store.getState().screens[0].Children[0].Children;
    expect(after[0].Location.Left).toBe(after[1].Location.Left);
    expect(after[2]).toEqual(before);
  });

  it("keeps arrange coordinate-free at the turn boundary", () => {
    const turn = coerceTurn({ mode: "edit", reply: "", ops: [{ op: "arrange", constraints: [{ id: "snap", kind: "snap", scope: "screen" }], left: 120, dx: 8 }] });
    expect(turn?.ops?.[0]).toMatchObject({ op: "arrange", left: undefined, dx: undefined });
  });

  it("keeps matchSize and snapToGrid as solver-backed compatibility ops", () => {
    const store = seeded();
    store.getState().nudge(["a"], 1, 2);
    const outcome = applyOps([{ op: "snapToGrid", screen: "s" }] as Op[], store);
    expect(outcome.rejected).toEqual([]);
    expect(store.getState().screens[0].Children[0].Children[0].Location).toEqual({ Left: 20, Top: 24 });
  });
});

describe("layout tool surface", () => {
  it("keeps the six arrangement tools and adds facts and solve beside them", () => {
    for (const name of ["align_objects", "distribute_objects", "match_size", "snap_to_grid", "find_overlaps", "tidy_screen", "layout_facts", "layout_solve"])
      expect(TOOLS.some((tool) => tool.name === name), name).toBe(true);
  });

  it("adds layout as a read-only MCP tool without changing existing names", () => {
    expect(READ_TOOLS.some((tool) => tool.name === "get_layout")).toBe(true);
  });

  it("gives chat resolved SDU layout facts while retaining transcript overlap context", () => {
    const store = seeded();
    const context = volatileContext(digestOf({ ...store.getState(), selectedIds: [] } as never));
    expect(context).toContain("Layout facts (resolved SDU):");
    expect(context).toContain("units (id kind type parent box [row col]):");
  });
});
