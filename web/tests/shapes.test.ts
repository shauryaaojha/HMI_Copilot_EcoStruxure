import { describe, expect, it } from "vitest";
import { expandComponent } from "@/lib/components";
import { arcBand, circle, diamond, hexagon, maskPart, pumpCasing, ring, shapePart, triangle, valveBody, vessel, motorFrame, capsule, type Shape } from "@/lib/ote/shapes";

/** Twice the signed area of each outline; positive is clockwise on a screen. */
function windings(shape: { Commands: string; points: number[] }): number[] {
  const out: number[] = [];
  let at = 0, ring: [number, number][] = [];
  for (const command of shape.Commands) {
    if (command === "z") { out.push(ring.reduce((sum, [x, y], i) => { const [nx, ny] = ring[(i + 1) % ring.length]; return sum + (x * ny - nx * y); }, 0)); ring = []; continue; }
    const n = command === "C" ? 3 : 1;
    for (let i = 0; i < n; i++) ring.push([shape.points[at + i * 2], shape.points[at + i * 2 + 1]]);
    at += n * 2;
  }
  return out;
}

const SHAPES: Record<string, Shape> = {
  circle: circle(), diamond: diamond(), up: triangle("up"), down: triangle("down"), right: triangle("right"), hexagon: hexagon(),
  band: arcBand(135, 405), pump: pumpCasing(), valve: valveBody(), motor: motorFrame(), vessel: vessel(0.6), cone: vessel(0.6, "cone"), capsule: capsule(2),
};

describe("shapes as Path geometry", () => {
  it("draws every outline clockwise, inside the unit square, with the commands the product's library uses", () => {
    for (const [name, shape] of Object.entries(SHAPES)) {
      expect(shape.Commands, name).toMatch(/^[MLCz]+$/);
      expect(windings(shape).every((area) => area > 0), `${name} winds clockwise`).toBe(true);
      expect(shape.points.every((n) => n >= -1e-9 && n <= 1 + 1e-9), `${name} stays in the unit square`).toBe(true);
    }
  });

  it("winds a hole against its outline, so it is a hole under either fill rule", () => {
    const [outer, inner] = windings(ring());
    expect(outer).toBeGreaterThan(0);
    expect(inner).toBeLessThan(0);
    const mask = maskPart("M", diamond(), { left: 0, top: 0, width: 24, height: 24 }, { fill: 11 });
    if (mask.Type !== "Path") throw new Error("not a path");
    const points = mask.Path!.Data!.split(",").map(Number);
    const [plate, hole] = windings({ Commands: mask.Path!.Commands!, points });
    expect(plate * hole).toBeLessThan(0);
    // Stretched over the whole box, as the product stretches a Path's 3072 units.
    expect(Math.min(...points)).toBe(0);
    expect(Math.max(...points)).toBe(3072);
  });

  it("keeps a shape's aspect inside the box it is given, on the 4 px grid", () => {
    const part = shapePart("P", vessel(0.5), { left: 8, top: 8, width: 96, height: 96 }, { border: 22 });
    expect(part.Width).toBe(48);
    expect(part.Height).toBe(96);
    expect(part.Location.Left % 4).toBe(0);
  });

  it("builds a ring gauge from benched parts: a filling rectangle under a cut plate", () => {
    const { parts, wires } = expandComponent({ kind: "Gauge", variant: "ring", size: "M", tags: { value: "FT_101" }, props: { label: "Flow" } }, { left: 0, top: 0, width: 96, height: 120 });
    const fill = parts.find((p) => p.Name.endsWith("_Fill"))!;
    expect(fill.Type).toBe("Rectangle");
    expect(parts.indexOf(parts.find((p) => p.Name.endsWith("_Plate"))!)).toBeGreaterThan(parts.indexOf(fill));
    expect(wires.filter((w) => w.tag === "FT_101").map((w) => w.property).sort()).toEqual(["Animation.FillLevel.VerticalFill", "CurrentValue"]);
  });
});
