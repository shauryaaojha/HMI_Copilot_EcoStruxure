import { describe, expect, it } from "vitest";
import { sceneOf } from "@/lib/layout/scene";
import { solveLayout, type SolveInput } from "@/lib/layout/solve";
import { partsAfterPlan, verifyPlan } from "@/lib/layout/verify";
import type { Constraint } from "@/lib/layout/types";
import type { Part, Screen } from "@/lib/ote/schema";

const part = (id: string, left: number, top: number, width = 40, height = 24) =>
  ({ Type: "Rectangle", UniqueId: id, Name: id, Location: { Left: left, Top: top }, Width: width, Height: height }) as Part;
const input = (parts: Part[], constraints: Constraint[], width = 320, height = 240): SolveInput => {
  const screen = { Type: "Screen", UniqueId: "s", Name: "S", Children: [{ Type: "ViewBox", UniqueId: "v", Name: "View",
    Width: width, Height: height, Children: parts }] } as Screen;
  return { scene: sceneOf({ screen, panel: { width, height } }), parts, constraints };
};

describe("layout solver", () => {
  it("aligns random pairs exactly and leaves every unasked part unchanged", () => {
    for (let seed = 0; seed < 30; seed++) {
      const parts = [part("a", 40 + seed * 2, 40), part("b", 100 + seed, 100), part("keep", 220, 160)];
      const request = input(parts, [{ id: "align", kind: "align", units: ["a", "b"], edge: "left" }]);
      const plan = solveLayout(request);
      expect(plan.conflict).toBeUndefined();
      const after = partsAfterPlan(request, plan);
      expect(after[0].Location.Left).toBe(after[1].Location.Left);
      expect(after[2]).toBe(parts[2]);
    }
  });

  it("distributes by equal edge gaps", () => {
    const request = input([part("a", 20, 20), part("b", 96, 24), part("c", 220, 28)],
      [{ id: "spread", kind: "distribute", units: ["a", "b", "c"], axis: "x" }]);
    const plan = solveLayout(request);
    const after = partsAfterPlan(request, plan);
    expect(after[1].Location.Left - after[0].Location.Left - 40).toBeCloseTo(after[2].Location.Left - after[1].Location.Left - 40);
    expect(plan.conflict).toBeUndefined();
  });

  it("matches the requested dimension without changing the other dimension", () => {
    const request = input([part("a", 20, 20, 40, 24), part("b", 100, 80, 72, 36)],
      [{ id: "width", kind: "sameSize", units: ["a", "b"], dim: "width" }]);
    const plan = solveLayout(request);
    expect(plan.conflict).toBeUndefined();
    expect(verifyPlan(request, plan).ok).toBe(true);
    const after = partsAfterPlan(request, plan);
    expect(after[0].Width).toBe(after[1].Width);
    expect(after[0].Height).toBe(24);
    expect(after[1].Height).toBe(36);
  });

  it("returns the conflicting constraint ids on an impossible request", () => {
    const request = input([part("a", 20, 20), part("b", 80, 20)], [
      { id: "hold-a", kind: "keep", units: ["a"] },
      { id: "hold-b", kind: "keep", units: ["b"] },
      { id: "align", kind: "align", units: ["a", "b"], edge: "left" },
    ]);
    const plan = solveLayout(request);
    expect(plan.conflict?.constraints).toContain("align");
    expect(verifyPlan(request, plan).ok).toBe(false);
  });

  it("separates a pair along the smaller penetration and preserves an unrelated part", () => {
    const parts = [part("a", 40, 40, 64, 64), part("b", 96, 48, 64, 64), part("fixed", 240, 160)];
    const request = input(parts, [{ id: "clear", kind: "noOverlap", scope: "screen" }]);
    const plan = solveLayout(request);
    expect(plan.conflict).toBeUndefined();
    const after = partsAfterPlan(request, plan);
    expect(after[2]).toBe(parts[2]);
    expect(after[0].Location.Left + 64 <= after[1].Location.Left || after[1].Location.Left + 64 <= after[0].Location.Left).toBe(true);
  });

  it("clears 38 generated perturbations while retaining unrelated boxes", () => {
    for (let seed = 0; seed < 38; seed++) {
      const fixed = part("fixed", 248, 184, 40, 24);
      const request = input([
        part("a", 24 + (seed % 5) * 4, 32 + (seed % 3) * 4, 48, 28),
        part("b", 48 + (seed % 5) * 4, 48 + (seed % 3) * 4, 48, 28),
        fixed,
      ], [{ id: "clear", kind: "noOverlap", scope: "screen" }]);
      const plan = solveLayout(request);
      const after = partsAfterPlan(request, plan);
      expect(plan.conflict, String(seed)).toBeUndefined();
      expect(after[2], String(seed)).toBe(fixed);
      expect(after[0].Location.Left + 48 <= after[1].Location.Left || after[1].Location.Left + 48 <= after[0].Location.Left ||
        after[0].Location.Top + 28 <= after[1].Location.Top || after[1].Location.Top + 28 <= after[0].Location.Top, String(seed)).toBe(true);
    }
  });
});
