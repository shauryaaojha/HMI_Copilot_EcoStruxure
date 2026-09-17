/**
 * The one placement rule that survives an explicit coordinate: a box is kept
 * inside the panel, because an object outside the ViewBox is clipped by SVG
 * and simply invisible. Everything else about where a new object goes lives
 * in lib/ote/regions.ts and tests/regions.test.ts now.
 */

import { describe, expect, it } from "vitest";
import { clampToPanel, type Box } from "@/lib/ote/place";

const PANEL = { width: 1024, height: 600 };

const box = (left: number, top: number, width = 200, height = 100): Box => ({
  left,
  top,
  width,
  height,
});

describe("clampToPanel", () => {
  it("leaves a box that already fits exactly where it is", () => {
    expect(clampToPanel(box(100, 80), PANEL)).toEqual(box(100, 80));
  });

  it("pulls a box back inside rather than letting SVG clip it away", () => {
    expect(clampToPanel(box(0, 900), PANEL).top).toBe(500);
    expect(clampToPanel(box(2000, 0), PANEL).left).toBe(824);
  });

  it("refuses negative coordinates", () => {
    const clamped = clampToPanel(box(-50, -20), PANEL);
    expect(clamped.left).toBe(0);
    expect(clamped.top).toBe(0);
  });

  it("shrinks a box too large for the panel instead of hiding half of it", () => {
    const clamped = clampToPanel({ left: 0, top: 0, width: 5000, height: 5000 }, PANEL);
    expect(clamped.width).toBe(PANEL.width);
    expect(clamped.height).toBe(PANEL.height);
  });

  it("always returns something wholly inside the panel", () => {
    for (const candidate of [box(-9, -9), box(1e6, 1e6), box(900, 550, 400, 400)]) {
      const c = clampToPanel(candidate, PANEL);
      expect(c.left).toBeGreaterThanOrEqual(0);
      expect(c.top).toBeGreaterThanOrEqual(0);
      expect(c.left + c.width).toBeLessThanOrEqual(PANEL.width);
      expect(c.top + c.height).toBeLessThanOrEqual(PANEL.height);
    }
  });
});
