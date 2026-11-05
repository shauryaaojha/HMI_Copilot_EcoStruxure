/**
 * S5-03: the board used to be measured from two different screens, so a double-click
 * zoom scrolled to a place no frame was drawn at. CanvasPane and ScreenBoard now both
 * ask boardLayout about every screen, so the proof is that they do, and that frames
 * of different sizes (8 of 26 screens in the engineer files) do not land on each other.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { boardLayout, placementOf } from "@/components/canvas/ScreenBoard";

const source = (file: string) => readFileSync(path.resolve(import.meta.dirname, "../../src/components/canvas", file), "utf8");

describe("S5-03 board placement", () => {
  it("is measured the same way where it is drawn and where it is scrolled", () => {
    for (const file of ["CanvasPane.tsx", "ScreenBoard.tsx"]) {
      const code = source(file);
      expect(code).toContain("boardLayout(");
      expect(code).toContain("rootBox(screen.Children[0], target)");
    }
  });

  it("keeps frames of different sizes apart", () => {
    const frames = [
      { id: "main", width: 1280, height: 800 },
      { id: "content", width: 478.125, height: 397.5 },
      { id: "third", width: 1280, height: 800 },
    ];
    const { metrics } = boardLayout(frames, {});
    const boxes = frames.map((frame, i) => ({ ...placementOf(i, metrics), ...frame }));
    for (const a of boxes) for (const b of boxes) {
      if (a === b) continue;
      const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
      expect(apart, a.id + " and " + b.id).toBe(true);
    }
  });
});
