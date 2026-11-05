/**
 * Audit 2026-11, stream S6. Two ways the server rasteriser (lib/critic/render.ts,
 * behind render_screen and the visual critic) draws a different picture from the
 * canvas. Both tests FAIL on the code they were written against.
 *
 *   cd web && MONGODB_URI= npx vitest run --config scripts/audit/vitest.config.mts scripts/audit/s6-server-render-strokes.test.ts
 *
 * S6-01. Stretched vector parts (Line, PolyLine, Polygon, Bezier, Path symbols) are
 * drawn in a 3072-unit viewBox with vector-effect="non-scaling-stroke"
 * (components/canvas/parts/Shapes.tsx:59, GraphicObject.tsx:79). Browsers keep the
 * stroke at Thickness; resvg ignores vector-effect and scales it by width/3072, so a
 * 2 px line in a 100 px box is 0.065 px wide and every library symbol loses its
 * outline in the PNG.
 *
 * S6-02. The screen's paper colour is a CSS `style="background:..."` on the root
 * <svg> (StaticScreen.tsx); resvg paints no CSS background, so every pixel no part
 * covers is transparent black in the PNG.
 */
import { describe, expect, it } from "vitest";
import { Resvg } from "@resvg/resvg-js";
import { screenToSvg } from "@/lib/critic/render";
import { screenOf } from "@/lib/ote/parts";
import type { Part } from "@/lib/ote/schema";

const PANEL = { width: 200, height: 100 };

function pixels(svg: string) {
  const img = new Resvg(svg).render();
  const at = (x: number, y: number) => {
    const i = (y * img.width + x) * 4;
    return { r: img.pixels[i], a: img.pixels[i + 3] };
  };
  return { at };
}

describe("S6 server render matches the canvas", () => {
  it("S6-01 draws a 2 px black Line as a dark line, not a hairline", async () => {
    const ground = { Type: "Rectangle", UniqueId: "3f2504e0-4f89-41d3-9a0c-0305e82c3311", Name: "Ground", Location: { Left: 0, Top: 0 }, Width: 200, Height: 100, Fill: { Color: { Value: 21 } }, Border: { Color: { Value: 21 } } };
    // A diagonal line, corner to corner of a 100 x 40 box, 2 px thick.
    const line = { Type: "Line", UniqueId: "3f2504e0-4f89-41d3-9a0c-0305e82c3312", Name: "Rule", Location: { Left: 50, Top: 30 }, Width: 100, Height: 40, Stroke: { Color: { Value: 31 } }, Thickness: 2, Path: { Commands: "ML", Data: "0,0,3072,3072" } };
    const svg = await screenToSvg(screenOf("Hairline", [ground, line] as unknown as Part[], PANEL), undefined, { panel: PANEL });
    const { at } = pixels(svg);
    // Inside the line's box only, clear of the 1 px screen frame at the edges.
    let darkest = 255;
    for (let y = 32; y < 68; y++) for (let x = 52; x < 148; x++) darkest = Math.min(darkest, at(x, y).r);
    expect(darkest, `darkest pixel on a 2 px black line is ${darkest}/255: resvg ignored vector-effect="non-scaling-stroke" and drew a hairline`).toBeLessThan(128);
  });

  it("S6-02 paints the screen's paper where no part covers it", async () => {
    const svg = await screenToSvg(screenOf("Empty", [], PANEL), undefined, { panel: PANEL });
    const { a } = pixels(svg).at(100, 50);
    expect(a, `the centre of an empty screen has alpha ${a}: the paper is a CSS background resvg does not paint`).toBe(255);
  });
});
