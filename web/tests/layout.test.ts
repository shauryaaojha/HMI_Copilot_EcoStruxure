/**
 * The ISA-101 application layout.
 *
 * The standard's claims about what makes a display set usable are checkable:
 * navigation and the alarm banner in the same place on every screen, nothing
 * overlapping, nothing off the panel, and a hierarchy that splits rather than
 * crowds. Those are the assertions here - not "it looks right", which no test
 * can make.
 *
 * Names are checked across the whole application, not per screen, because the
 * binding graph resolves a target by name.
 */

import { describe, expect, it } from "vitest";
import { layoutApplication, type LayoutUnit, type ScreenSpec } from "@/lib/ote/layout";
import { boardExtent, boardMetrics, placementOf } from "@/components/canvas/ScreenBoard";
import type { Part } from "@/lib/ote/schema";

const PANEL = { width: 1024, height: 600 };

const unit = (id: string, kind = "pump"): LayoutUnit => ({
  id,
  kind,
  label: id,
  roles: [
    { tag: `${id}_RUN`, role: "running", dataType: "BOOL", comment: "running" },
    { tag: `${id}_FLT`, role: "fault", dataType: "BOOL", comment: "fault" },
    { tag: `${id}_FLOW`, role: "flow", dataType: "REAL", comment: "flow LPM" },
  ],
});

const spec = (over: Partial<ScreenSpec> = {}): ScreenSpec => ({
  screenName: "PumpStation1",
  title: "Pump Station",
  level: 2,
  include: ["P101", "P102"],
  sections: ["status", "process", "alarms"],
  ...over,
});

const units = [unit("P101"), unit("P102"), unit("P103"), unit("P104"), unit("P105")];

const boxOf = (p: Part) => ({
  left: p.Location.Left,
  top: p.Location.Top,
  right: p.Location.Left + p.Width,
  bottom: p.Location.Top + p.Height,
});

describe("one screen", () => {
  const [built] = layoutApplication([spec()], units, PANEL);

  it("wraps the parts in the Screen -> ViewBox shape the product expects", () => {
    expect(built.screen.Type).toBe("Screen");
    expect(built.screen.Children).toHaveLength(1);
    expect(built.screen.Children[0].Width).toBe(PANEL.width);
    expect(built.screen.Children[0].Children).toEqual(built.parts);
  });

  it("keeps every object inside the panel", () => {
    for (const part of built.parts) {
      const b = boxOf(part);
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.top).toBeGreaterThanOrEqual(0);
      expect(b.right).toBeLessThanOrEqual(PANEL.width);
      expect(b.bottom).toBeLessThanOrEqual(PANEL.height);
    }
  });

  it("emits only part types the packager can write", () => {
    const allowed = new Set(["Rectangle", "TextBox", "Lamp", "NumericDisplay", "AlarmSummary"]);
    for (const part of built.parts) expect(allowed.has(part.Type)).toBe(true);
  });

  it("puts a numeric display on every reading and binds it", () => {
    const numerics = built.parts.filter((p) => p.Type === "NumericDisplay");
    expect(numerics.length).toBeGreaterThan(0);
    for (const numeric of numerics) {
      expect(built.wires.some((w) => w.part.UniqueId === numeric.UniqueId)).toBe(true);
    }
  });

  it("tells every wire which screen its object is on", () => {
    for (const wire of built.wires) {
      expect(wire.screenId).toBe(built.screen.UniqueId);
    }
  });

  it("drops the alarm banner when the screen did not ask for one", () => {
    const [plain] = layoutApplication([spec({ sections: ["status"] })], units, PANEL);
    expect(plain.parts.some((p) => p.Type === "AlarmSummary")).toBe(false);
  });
});

describe("an application", () => {
  const specs: ScreenSpec[] = [
    spec({ screenName: "PlantOverview", level: 1, include: units.map((u) => u.id), sections: ["status", "alarms"] }),
    spec({ screenName: "PumpStation1", include: ["P101", "P102", "P103"] }),
    spec({ screenName: "PumpStation2", include: ["P104", "P105"] }),
  ];
  const built = layoutApplication(specs, units, PANEL);

  it("builds one screen per spec", () => {
    expect(built).toHaveLength(3);
    expect(built.map((b) => b.screen.Name)).toEqual([
      "PlantOverview",
      "PumpStation1",
      "PumpStation2",
    ]);
  });

  it("gives every object a name unique across the whole application", () => {
    const names = built.flatMap((b) => b.parts.map((p) => p.Name));
    expect(new Set(names).size).toBe(names.length);
  });

  it("puts the navigation strip in the same place on every screen", () => {
    const strips = built.map((b) => b.parts.find((p) => p.Name.startsWith("Nav_"))!);
    for (const strip of strips) {
      expect(strip.Location).toEqual(strips[0].Location);
      expect(strip.Height).toBe(strips[0].Height);
    }
  });

  it("lists every screen in every navigation strip, so no display is a dead end", () => {
    for (const b of built) {
      const labels = b.parts
        .filter((p) => p.Name.includes("NavLbl_"))
        .map((p) => (p.Type === "TextBox" ? p.Text : ""));
      for (const s of specs) expect(labels).toContain(s.screenName);
    }
  });

  it("puts the alarm banner at the same height wherever there is one", () => {
    const banners = built.flatMap((b) => b.parts.filter((p) => p.Type === "AlarmSummary"));
    expect(banners.length).toBeGreaterThan(1);
    for (const banner of banners) expect(banner.Location.Top).toBe(banners[0].Location.Top);
  });

  it("does not overlap the cards it lays out", () => {
    const cards = built[1].parts.filter((p) => p.Name.startsWith("Card_")).map(boxOf);
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i];
        const b = cards[j];
        const apart =
          a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
        expect(apart).toBe(true);
      }
    }
  });

  it("shows status on a plant overview and readings on a unit overview", () => {
    const overview = built[0].parts;
    const station = built[1].parts;
    expect(overview.some((p) => p.Name.startsWith("Tile_"))).toBe(true);
    expect(station.some((p) => p.Name.startsWith("Card_"))).toBe(true);
  });
});

describe("a screen with nothing on it", () => {
  it("says so rather than rendering an empty frame", () => {
    const [built] = layoutApplication([spec({ include: [] })], units, PANEL);
    const texts = built.parts.filter((p) => p.Type === "TextBox").map((p) => p.Text);
    expect(texts.some((t) => t.includes("No equipment"))).toBe(true);
  });
});

describe("the board", () => {
  it("leaves a gap between frames that survives being zoomed out", () => {
    // 72 units vanished at the zoom that fits a whole plant - about eight
    // pixels across a twenty-one screen board.
    const metrics = boardMetrics(9, PANEL);
    expect(metrics.cell.width - PANEL.width).toBeGreaterThanOrEqual(120);
    expect(metrics.cell.height - PANEL.height).toBeGreaterThanOrEqual(120);
  });

  it("puts screens in a grid until one is moved", () => {
    const metrics = boardMetrics(4, PANEL);
    expect(placementOf(0, metrics)).toEqual({ x: 0, y: 0 });
    expect(placementOf(1, metrics)).toEqual({ x: metrics.cell.width, y: 0 });
    expect(placementOf(2, metrics)).toEqual({ x: 0, y: metrics.cell.height });
  });

  it("uses a hand placement over the grid slot", () => {
    const metrics = boardMetrics(4, PANEL);
    expect(placementOf(2, metrics, { x: 42, y: 7 })).toEqual({ x: 42, y: 7 });
  });

  it("grows the board to hold a screen dragged past the grid", () => {
    const extent = boardExtent(PANEL, ["a", "b"], { b: { x: 5000, y: 3000 } });
    expect(extent.width).toBeGreaterThanOrEqual(5000 + PANEL.width);
    expect(extent.height).toBeGreaterThanOrEqual(3000 + PANEL.height);
  });

  it("shifts the origin for a screen dragged above or left of the grid", () => {
    // A negative offset would be unreachable in a scroll container.
    const extent = boardExtent(PANEL, ["a", "b"], { b: { x: -800, y: -400 } });
    expect(extent.originX).toBe(-800);
    expect(extent.originY).toBe(-400);
    expect(extent.width).toBeGreaterThan(PANEL.width);
  });
});
