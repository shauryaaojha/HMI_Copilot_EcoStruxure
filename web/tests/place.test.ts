/**
 * Where a new object goes when the request did not say.
 *
 * Reported from a real session: several turns of conversational editing put
 * everything in one corner, on top of each other. Two causes, both here -
 * a missing position defaulted to 20,20 rather than being computed, and a
 * position outside the panel was written through unchanged, where SVG clips it
 * and the object is simply invisible.
 */

import { describe, expect, it } from "vitest";
import { clampToPanel, freeSpaceHint, freeSpot, type Box } from "@/lib/ote/place";

const PANEL = { width: 1024, height: 600 };

const box = (left: number, top: number, width = 200, height = 100): Box => ({
  left,
  top,
  width,
  height,
});

const overlap = (a: Box, b: Box) =>
  a.left < b.left + b.width &&
  a.left + a.width > b.left &&
  a.top < b.top + b.height &&
  a.top + a.height > b.top;

describe("clampToPanel", () => {
  it("leaves a box that already fits exactly where it is", () => {
    expect(clampToPanel(box(100, 80), PANEL)).toEqual(box(100, 80));
  });

  it("pulls a box back inside rather than letting SVG clip it away", () => {
    // top: 900 on a 600-high panel is the failure: the object exists, is bound,
    // and cannot be seen.
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

describe("freeSpot", () => {
  it("starts at the margin on an empty screen", () => {
    expect(freeSpot([], { width: 200, height: 100 }, PANEL)).toEqual({ left: 12, top: 12 });
  });

  it("does not land on top of what is already there", () => {
    const taken = [box(0, 0, 1024, 44), box(12, 60, 320, 162)];
    const size = { width: 200, height: 100 };
    const at = freeSpot(taken, size, PANEL);
    for (const t of taken) expect(overlap({ ...at, ...size }, t)).toBe(false);
  });

  it("puts three objects added in a row in three different places", () => {
    // The reported bug: three turns, three objects, one corner.
    const taken: Box[] = [];
    const size = { width: 200, height: 100 };
    const placed: { left: number; top: number }[] = [];

    for (let i = 0; i < 3; i++) {
      const at = freeSpot(taken, size, PANEL);
      placed.push(at);
      taken.push({ ...at, ...size });
    }

    expect(new Set(placed.map((p) => `${p.left},${p.top}`)).size).toBe(3);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(overlap({ ...placed[i], ...size }, { ...placed[j], ...size })).toBe(false);
      }
    }
  });

  it("walks around the header, nav strip and footer without knowing what they are", () => {
    // Chrome needs no special case: on a generated screen it is objects.
    const chrome = [
      box(0, 0, 1024, 44),
      box(0, 44, 1024, 32),
      box(0, 572, 1024, 28),
    ];
    const at = freeSpot(chrome, { width: 300, height: 120 }, PANEL);
    expect(at.top).toBeGreaterThanOrEqual(76);
    expect(at.top + 120).toBeLessThanOrEqual(572);
  });

  it("stays inside the panel even for a box nearly as large as it", () => {
    const at = freeSpot([], { width: 1000, height: 580 }, PANEL);
    expect(at.left + 1000).toBeLessThanOrEqual(PANEL.width);
    expect(at.top + 580).toBeLessThanOrEqual(PANEL.height);
  });

  it("aligns to the grid, so a placed object lines up with a laid-out one", () => {
    const at = freeSpot([box(0, 0, 1024, 44)], { width: 100, height: 40 }, PANEL);
    expect(at.left % 4).toBe(0);
    expect(at.top % 4).toBe(0);
  });

  it("still places something on a full screen rather than refusing", () => {
    const full = [box(0, 0, 1024, 600)];
    const at = freeSpot(full, { width: 200, height: 100 }, PANEL);
    expect(at.left).toBeGreaterThanOrEqual(0);
    expect(at.top + 100).toBeLessThanOrEqual(PANEL.height);
  });
});

describe("freeSpaceHint", () => {
  it("says the whole screen is free when it is", () => {
    expect(freeSpaceHint([], PANEL)).toContain("1024 x 600");
  });

  it("points below the content when that is where the room is", () => {
    expect(freeSpaceHint([box(0, 0, 1024, 200)], PANEL)).toContain("below");
  });

  it("points beside it when the content is a narrow column", () => {
    expect(freeSpaceHint([box(0, 0, 300, 600)], PANEL)).toContain("right");
  });

  it("says so when there is nowhere left, rather than inventing room", () => {
    expect(freeSpaceHint([box(0, 0, 1024, 600)], PANEL)).toContain("full");
  });
});
