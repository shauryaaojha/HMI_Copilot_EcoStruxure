/**
 * S3-03: alignObjects reports success when it could not do what was asked.
 *
 * core/ops/apply.ts `alignObjects` drops every target it cannot resolve without
 * saying so, and rejects only when *none* resolve. Then:
 *  - one resolved object: store/edits.ts alignTo aligns a single part to the SCREEN,
 *    so "align START and STOP" with a misspelt STOP moves START to the panel edge and
 *    answers "Aligned 1 objects";
 *  - spreadHorizontal/Vertical with two objects: store/slices/objects.ts spread
 *    returns early for fewer than 3, nothing moves, and the answer is "Aligned 2 objects".
 */
import { describe, expect, it } from "vitest";
import { demoScreen, demoVariables } from "@/fixtures";
import { applyOps } from "@/core/ops";
import { createProjectStore } from "@/store/project";

function store() {
  const s = createProjectStore();
  const screen = structuredClone(demoScreen);
  s.getState().hydrate({
    name: "Align", target: { model: "HMIST6500", width: 1024, height: 600 }, screens: [screen], activeScreenId: screen.UniqueId,
    variables: structuredClone(demoVariables), alarms: [], bindings: [],
  } as never);
  return s;
}
const parts = (s: ReturnType<typeof store>) => s.getState().screens[0].Children[0].Children;
/** Two small, non-background parts that are not at the left edge. */
function pick(s: ReturnType<typeof store>) {
  const small = parts(s).filter((p) => (p.Width ?? 0) < 400 && p.Location.Left > 20);
  return [small[0], small[1]];
}

describe("S3-03 alignObjects is honest about what it did", () => {
  it("one of two targets unresolved: the op is refused (or names the missing one), and nothing moves to the screen edge", () => {
    const s = store();
    const [a] = pick(s);
    const leftBefore = a.Location.Left;
    const out = applyOps([{ op: "alignObjects", targets: [a.Name, "Btn_Stop_Missing"], mode: "left", note: "align the start and stop buttons" }], s);
    const leftAfter = parts(s).find((p) => p.UniqueId === a.UniqueId)!.Location.Left;
    const named = JSON.stringify(out.rejected).includes("Btn_Stop_Missing");
    expect(
      named && leftAfter === leftBefore,
      `applied=${JSON.stringify(out.applied)} rejected=${JSON.stringify(out.rejected)}; ${a.Name} left ${leftBefore} -> ${leftAfter}`,
    ).toBe(true);
  });

  it("spreadHorizontal on two objects: refused or moved, never reported as done while nothing changed", () => {
    const s = store();
    const [a, b] = pick(s);
    const before = JSON.stringify([a.Location, b.Location]);
    const out = applyOps([{ op: "alignObjects", targets: [a.Name, b.Name], mode: "spreadHorizontal", note: "spread them" }], s);
    const now = parts(s);
    const after = JSON.stringify([now.find((p) => p.UniqueId === a.UniqueId)!.Location, now.find((p) => p.UniqueId === b.UniqueId)!.Location]);
    const claimed = out.applied.length > 0;
    expect(claimed && before === after, `applied=${JSON.stringify(out.applied)} and nothing moved`).toBe(false);
  });
});
