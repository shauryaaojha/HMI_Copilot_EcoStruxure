import { describe, expect, it } from "vitest";
import { Resvg } from "@resvg/resvg-js";
import { fillBar, screenOf } from "@/lib/ote/parts";
import { screenToSvg } from "@/lib/critic/render";
import { Part } from "@/lib/ote/schema";

const panel = { width: 120, height: 80 };

async function pixel(part: Part, x: number, y: number) {
  const svg = await screenToSvg(screenOf("Part", [part], panel), undefined, { panel });
  const png = new Resvg(svg).render();
  return Array.from(png.pixels.slice((y * png.width + x) * 4, (y * png.width + x) * 4 + 4));
}

describe("design time parts", () => {
  it("draws a file's CornerRadius in the server render", async () => {
    const part = Part.parse({
      Type: "Rectangle", UniqueId: crypto.randomUUID(), Name: "Round",
      Location: { Left: 20, Top: 20 }, Width: 40, Height: 40,
      Fill: { Color: { Value: 12 } }, Border: { Type: 0 }, Thickness: 0,
      CornerRadius: { Style: 2, TopLeft: 12, TopRight: 12, BottomLeft: 12, BottomRight: 12 },
    });
    expect((await pixel(part, 21, 21)).slice(0, 3)).toEqual([241, 241, 241]);
    expect((await pixel(part, 40, 40))[0]).toBeLessThan(100);
  });

  it("shows a generated bar at its design value", async () => {
    const part = fillBar("Level", { left: 20, top: 20, width: 80, height: 16 }, { fill: 12, back: 21, border: 22, vertical: false, designValue: 60 });
    expect(part.Type).toBe("Rectangle");
    if (part.Type !== "Rectangle") return;
    expect(part.Animation?.FillLevel?.HorizontalFill).toBe(60);
    expect((await pixel(part, 40, 28))[0]).toBeLessThan(100);
    expect((await pixel(part, 90, 28))[0]).toBeGreaterThan(200);
  });
});
