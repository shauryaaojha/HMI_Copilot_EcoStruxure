/**
 * S5-03: the board is measured from two different screens. ScreenBoard draws
 * every frame in a grid sized from the FIRST screen (ScreenBoard.tsx:227-239),
 * while CanvasPane sizes the same grid from the ACTIVE screen
 * (CanvasPane.tsx:185, 289-297) and uses it to scroll on a double-click zoom
 * (CanvasPane.tsx:364, 373-376). In a project whose screens differ in size -
 * a content screen laid out at its display's size, measured: 8 of 26 screens in
 * the engineer files - the zoom scrolls to a place no frame is drawn at.
 */
import { describe, expect, it } from "vitest";
import { boardExtent, placementOf } from "@/components/canvas/ScreenBoard";
import { rootBox } from "@/lib/ote/schema";

describe("S5-03 board placement", () => {
  it("scrolls a double-click zoom to where the frame is drawn", () => {
    const target = { width: 1280, height: 800 };
    // A screen with the panel's size, and a content screen of the size measured in the files.
    const first = { Width: undefined, Height: undefined };
    const content = { Width: 478.125, Height: 397.5 };
    const ids = ["main", "content", "third"];

    const drawn = boardExtent(rootBox(first, target), ids, {}); // ScreenBoard
    const scrolled = boardExtent(rootBox(content, target), ids, {}); // CanvasPane, content screen active

    const index = 2;
    const where = placementOf(index, drawn.metrics);
    const aimed = placementOf(index, scrolled.metrics);
    expect(aimed, `frame ${index} is drawn at ${where.x},${where.y}`).toEqual(where);
  });
});
