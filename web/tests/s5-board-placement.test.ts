import { describe, expect, it } from "vitest";
import { boardLayout, placementOf } from "@/components/canvas/ScreenBoard";

describe("S5-03 board placement", () => {
  it("uses the same layout for drawing and zooming across different frame sizes", () => {
    const frames = [
      { id: "main", width: 1280, height: 800 },
      { id: "content", width: 478.125, height: 397.5 },
      { id: "third", width: 1280, height: 800 },
    ];
    const drawn = boardLayout(frames, {});
    const aimed = boardLayout(frames, {});
    expect(placementOf(2, aimed.metrics)).toEqual(placementOf(2, drawn.metrics));
    expect(placementOf(2, drawn.metrics).y).toBe(1036);
  });
});
