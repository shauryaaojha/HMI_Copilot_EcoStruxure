/**
 * The editing primitives: align, distribute, restack, clone, snap.
 *
 * These are pure, and they are reached from four places - the toolbar, the
 * keyboard, the context menu and the chat's op list - so a disagreement between
 * any two of them would be a disagreement about what "align left" means. Tested
 * here once, against the numbers rather than against the UI.
 */

import { describe, expect, it } from "vitest";
import {
  alignTo,
  clonePartsInto,
  distribute,
  restack,
  snapDelta,
  snapTargets,
  unionOf,
  uniqueName,
} from "@/store/edits";
import type { Part } from "@/lib/ote/schema";

const box = (name: string, left: number, top: number, width = 100, height = 50): Part => ({
  Type: "Rectangle",
  UniqueId: `id-${name}`,
  Name: name,
  Location: { Left: left, Top: top },
  Width: width,
  Height: height,
});

const SCREEN = { width: 1024, height: 600 };

describe("unionOf", () => {
  it("is null for nothing", () => {
    expect(unionOf([])).toBeNull();
  });

  it("covers every corner", () => {
    expect(unionOf([box("a", 10, 20), box("b", 200, 300, 40, 10)])).toEqual({
      left: 10,
      top: 20,
      width: 230,
      height: 290,
    });
  });
});

describe("alignTo", () => {
  it("aligns several objects to their shared box, not to the screen", () => {
    const parts = [box("a", 10, 0), box("b", 90, 100), box("c", 50, 200)];
    const moves = alignTo(parts, "left", SCREEN);
    expect([...moves.values()].map((m) => m.left)).toEqual([10, 10, 10]);
  });

  it("aligns a single object to the screen, which is what centring one means", () => {
    const moves = alignTo([box("only", 0, 0, 200, 40)], "centre", SCREEN);
    expect(moves.get("id-only")!.left).toBe((1024 - 200) / 2);
  });

  it("moves only the axis it was asked about", () => {
    const parts = [box("a", 10, 5), box("b", 90, 60)];
    const moves = alignTo(parts, "top", SCREEN);
    expect(moves.get("id-a")).toEqual({ left: 10, top: 5 });
    expect(moves.get("id-b")).toEqual({ left: 90, top: 5 });
  });

  it("puts right edges together, not left edges", () => {
    const parts = [box("wide", 0, 0, 300, 20), box("narrow", 10, 40, 100, 20)];
    const moves = alignTo(parts, "right", SCREEN);
    expect(moves.get("id-wide")!.left).toBe(0);
    expect(moves.get("id-narrow")!.left).toBe(200);
  });
});

describe("distribute", () => {
  it("needs three objects to have a gap to even out", () => {
    expect(distribute([box("a", 0, 0), box("b", 500, 0)], "horizontal").size).toBe(0);
  });

  it("leaves the outermost two where they are", () => {
    const parts = [box("a", 0, 0), box("b", 130, 0), box("c", 400, 0)];
    const moves = distribute(parts, "horizontal");
    expect(moves.get("id-a")!.left).toBe(0);
    expect(moves.get("id-c")!.left).toBe(400);
  });

  it("evens the gaps, not the centres, so different widths still read as even", () => {
    // Widths 100, 200, 100 across 0..600: 400 occupied, 200 of gap, 100 each.
    const parts = [box("a", 0, 0, 100), box("b", 150, 0, 200), box("c", 500, 0, 100)];
    const moves = distribute(parts, "horizontal");
    const a = moves.get("id-a")!.left;
    const b = moves.get("id-b")!.left;
    const c = moves.get("id-c")!.left;
    expect(b - (a + 100)).toBe(c - (b + 200));
  });
});

describe("restack", () => {
  const parts = [box("a", 0, 0), box("b", 0, 0), box("c", 0, 0), box("d", 0, 0)];
  const names = (list: Part[]) => list.map((p) => p.Name);

  it("puts the moved objects last, which is the front", () => {
    expect(names(restack(parts, ["id-a"], "front"))).toEqual(["b", "c", "d", "a"]);
  });

  it("puts them first, which is the back", () => {
    expect(names(restack(parts, ["id-d"], "back"))).toEqual(["d", "a", "b", "c"]);
  });

  it("steps one place at a time", () => {
    expect(names(restack(parts, ["id-b"], "forward"))).toEqual(["a", "c", "b", "d"]);
    expect(names(restack(parts, ["id-c"], "backward"))).toEqual(["a", "c", "b", "d"]);
  });

  it("keeps a multi-selection in its own order", () => {
    expect(names(restack(parts, ["id-a", "id-c"], "front"))).toEqual(["b", "d", "a", "c"]);
  });

  it("does nothing when the ids are not there", () => {
    expect(names(restack(parts, ["id-zz"], "front"))).toEqual(["a", "b", "c", "d"]);
  });
});

describe("uniqueName", () => {
  it("leaves a free name alone", () => {
    expect(uniqueName(new Set(["Pump"]), "Tank")).toBe("Tank");
  });

  it("suffixes rather than colliding, because bindings resolve by name", () => {
    expect(uniqueName(new Set(["Pump"]), "Pump")).toBe("Pump_2");
    expect(uniqueName(new Set(["Pump", "Pump_2"]), "Pump")).toBe("Pump_3");
  });

  it("does not stack suffixes on a name that already has one", () => {
    expect(uniqueName(new Set(["Pump_2"]), "Pump_2")).toBe("Pump_3");
  });
});

describe("clonePartsInto", () => {
  it("gives every copy a new id and a free name", () => {
    const taken = new Set(["Panel"]);
    const [copy] = clonePartsInto([box("Panel", 10, 10)], taken, { dx: 16, dy: 16 });
    expect(copy.UniqueId).not.toBe("id-Panel");
    expect(copy.Name).toBe("Panel_2");
    expect(copy.Location).toEqual({ Left: 26, Top: 26 });
  });

  it("does not let two copies in one call take the same name", () => {
    const copies = clonePartsInto([box("P", 0, 0), box("P", 0, 0)], new Set(["P"]), {
      dx: 0,
      dy: 0,
    });
    expect(new Set(copies.map((c) => c.Name)).size).toBe(2);
  });

  it("detaches the copy from the original", () => {
    const original = box("P", 0, 0);
    const [copy] = clonePartsInto([original], new Set(), { dx: 0, dy: 0 });
    copy.Location.Left = 999;
    expect(original.Location.Left).toBe(0);
  });
});

describe("smart guides", () => {
  it("offers each other object's edges and centre, and never the dragged one", () => {
    const parts = [box("a", 100, 200, 80, 40), box("dragged", 0, 0)];
    const { vertical, horizontal } = snapTargets(parts, new Set(["id-dragged"]));
    expect(vertical).toEqual([100, 140, 180]);
    expect(horizontal).toEqual([200, 220, 240]);
  });

  it("catches the nearest line inside the tolerance and nothing outside it", () => {
    expect(snapDelta([98], [100], 6)).toEqual({ delta: 2, line: 100 });
    expect(snapDelta([90], [100], 6)).toBeNull();
  });

  it("prefers the closer of two candidates", () => {
    expect(snapDelta([100], [104, 97], 6)!.line).toBe(97);
  });
});
