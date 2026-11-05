import { describe, expect, it } from "vitest";
import { applyOps } from "@/core/ops/apply";
import type { Op } from "@/core/ops/ops";
import { createProjectStore } from "@/store/project";
import type { Part, Screen } from "@/lib/ote/schema";

const part = (id: string, left: number, top: number, width: number, height = 24): Part =>
  ({ Type: "Rectangle", UniqueId: id, Name: id, Location: { Left: left, Top: top }, Width: width, Height: height }) as Part;

function seeded(parts: Part[]) {
  const screen = { Type: "Screen", UniqueId: "s", Name: "S", Children: [{ Type: "ViewBox", UniqueId: "v", Name: "V", Width: 640, Height: 480, Children: parts }] } as Screen;
  const store = createProjectStore();
  store.getState().hydrate({ id: "p", name: "P", target: { model: "test", width: 640, height: 480 }, screens: [screen], activeScreenId: "s", variables: [] });
  return store;
}
const placed = (store: ReturnType<typeof seeded>) => Object.fromEntries(store.getState().screens[0].Children[0].Children.map((p) => [p.UniqueId, p]));
const right = (p: Part) => p.Location.Left + (p.Width ?? 0);

describe("a request the engineer asked for is not refused over the grid", () => {
  it("aligns right edges of parts whose widths differ by an odd number", () => {
    const store = seeded([part("a", 40, 40, 131), part("b", 80, 120, 100)]);
    const outcome = applyOps([{ op: "alignObjects", targets: ["a", "b"], mode: "right" }] as Op[], store);
    expect(outcome.rejected.map((r) => r.reason)).toEqual([]);
    const now = placed(store);
    expect(right(now.a)).toBe(right(now.b));
  });

  it("spreads three parts when the equal gap is not a whole number of grid units", () => {
    const store = seeded([part("a", 40, 40, 40), part("b", 90, 40, 40), part("c", 301, 40, 40)]);
    const outcome = applyOps([{ op: "alignObjects", targets: ["a", "b", "c"], mode: "spreadHorizontal" }] as Op[], store);
    expect(outcome.rejected.map((r) => r.reason)).toEqual([]);
    const now = placed(store);
    expect(Number.isInteger(now.b.Location.Left)).toBe(true);
    expect(now.b.Location.Left - right(now.a)).toBeCloseTo(now.c.Location.Left - right(now.b), 6);
  });

  it("is not stopped by something else already off the panel", () => {
    const store = seeded([part("a", 40, 40, 40), part("b", 80, 120, 40), part("off", 700, 300, 40)]);
    const outcome = applyOps([{ op: "alignObjects", targets: ["a", "b"], mode: "left" }] as Op[], store);
    expect(outcome.rejected.map((r) => r.reason)).toEqual([]);
    expect(placed(store).off.Location.Left).toBe(700);
  });

  it("tells the engineer the screen is full when tidying cannot find room", () => {
    const store = seeded([part("top", 0, 0, 640, 300), part("low", 0, 200, 640, 280)]);
    const outcome = applyOps([{ op: "tidyLayout", screen: "s" }] as Op[], store);
    expect(outcome.rejected.map((r) => r.reason).join(" ")).toMatch(/full/i);
  });
});

describe("naming something on a card moves that thing, on the card", () => {
  it("aligns two buttons on one card, and the card stays", () => {
    const store = seeded([part("Card_A", 40, 40, 300, 200), part("Start", 60, 80, 60), part("Stop", 140, 123, 60)]);
    const outcome = applyOps([{ op: "alignObjects", targets: ["Start", "Stop"], mode: "top" }] as Op[], store);
    expect(outcome.rejected.map((r) => r.reason)).toEqual([]);
    const now = placed(store);
    expect(now.Start.Location.Top).toBe(now.Stop.Location.Top);
    expect(now.Card_A.Location).toEqual({ Left: 40, Top: 40 });
  });

  it("refuses, and says so, when lining two up would stack them", () => {
    const store = seeded([part("Card_A", 40, 40, 300, 200), part("Start", 60, 80, 60), part("Stop", 60, 123, 60)]);
    const outcome = applyOps([{ op: "alignObjects", targets: ["Start", "Stop"], mode: "top" }] as Op[], store);
    expect(outcome.rejected.map((r) => r.reason).join()).toMatch(/overlaps/);
    expect(placed(store).Stop.Location.Top).toBe(123);
  });

  it("keeps a part inside its card even when asked to follow something off it", () => {
    const store = seeded([part("Card_A", 40, 40, 200, 200), part("Lamp", 60, 80, 60), part("Far", 400, 300, 40)]);
    const outcome = applyOps([{ op: "alignObjects", targets: ["Lamp", "Far"], mode: "top" }] as Op[], store);
    const now = placed(store);
    expect(now.Lamp.Location.Top).toBeLessThanOrEqual(216);
    if (outcome.rejected.length === 0) expect(now.Lamp.Location.Top).toBe(now.Far.Location.Top);
    else expect(now.Lamp.Location.Top).toBe(80);
  });
});
