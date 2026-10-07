/**
 * The plain shapes, as the product writes them. Each sample below is a real
 * object from the typed template corpus, trimmed to its geometry and paint.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Part, pathGeometry, withOrigin } from "@/lib/ote/schema";
import { PartNode } from "@/components/canvas/parts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const SAMPLES = [
  // HVAC_Symbol01: a gradient written as stops, and a border of Type 0 (none).
  { Type: "Ellipse", UniqueId: id(1), Name: "Ellipse1", Fill: { Type: 3, ColorStops: [{ Color: { Value: 2 } }, { Offset: 7500, Color: { Value: 2, Transparency: 100 } }] }, Border: { Type: 0 }, Location: { Left: 450, Top: 1 }, Width: 50, Height: 50 },
  // A line with no Path and no Left: corner to corner, at Left 0.
  { Type: "Line", UniqueId: id(2), Name: "Line8", Width: 44, Height: 0, Stroke: { Color: { Value: 1 } }, Thickness: 2, Path: { Data: "0,0,3072,0" }, Location: { Top: 9 } },
  { Type: "Polygon", UniqueId: id(3), Name: "Valve", Fill: { Color: { Value: 2 } }, Border: { Color: { Value: 1 } }, Thickness: 2, Path: { Commands: "MLLLz", Data: "0,0,3072,0,3072,3072,0,3072" }, Width: 18, Height: 15 },
  { Type: "Bezier", UniqueId: id(4), Name: "Bezier1", Stroke: { Color: { Value: 1 } }, Thickness: 2, Path: { Commands: "MCC", Data: "0,3072,0,3072,0,0,1536,0,3072,0,3072,3072,3072,3072" }, Location: { Left: 15, Top: 15 }, Width: 13, Height: 6 },
  { Type: "Arc", UniqueId: id(5), Name: "Arc2", StartAngle: 93, EndAngle: 301, Stroke: { Color: { Value: 1 } }, Thickness: 2, Location: { Left: 9, Top: 6 }, Width: 11, Height: 11 },
  // A full ring: 270 to 630.
  { Type: "Arch", UniqueId: id(6), Name: "Arch5", StartAngle: 270, EndAngle: 630, InnerRadius: 80, Fill: { Color: { Value: 22 } }, Border: { Type: 0 }, Width: 60, Height: 60 },
  { Type: "Pie", UniqueId: id(7), Name: "Pie5", Fill: { Color: { Value: 22 } }, Width: 60, Height: 60 },
  { Type: "Doughnut", UniqueId: id(8), Name: "Doughnut1", InnerRadius: 80, Fill: { Color: { Value: 42 } }, Width: 60, Height: 60 },
  // 3.4's Path encoding: geometry under Path, as Commands and Data.
  { Type: "Path", UniqueId: id(9), Name: "Path1", Fill: { Color: { Value: 31 } }, Thickness: 2, Path: { Commands: "MLLz", Data: "0,0,3072,0,1536,3072" }, Width: 44, Height: 17 },
];

describe("the shapes", () => {
  it("parse once the product's left-out zeros are filled in", () => {
    for (const sample of SAMPLES) {
      const parsed = Part.safeParse(withOrigin(sample));
      expect(parsed.success, sample.Type).toBe(true);
    }
  });

  it("draw something, each of them", () => {
    for (const sample of SAMPLES) {
      const part = Part.parse(withOrigin(sample));
      const html = renderToStaticMarkup(createElement("svg", null, createElement(PartNode, { part, alarms: [] })));
      expect(html, sample.Type).toMatch(/<(path|ellipse)\b/);
    }
  });

  it("read a Path's geometry from either encoding", () => {
    expect(pathGeometry({ Commands: "ML", Points: "0,0,1,1" })).toEqual({ Commands: "ML", Points: "0,0,1,1" });
    expect(pathGeometry({ Path: { Commands: "MLLz", Data: "0,0,1,0,1,1" } })).toEqual({ Commands: "MLLz", Points: "0,0,1,0,1,1" });
    expect(pathGeometry({ Path: { Data: "0,0,1,0,1,1" } })).toEqual({ Commands: "MLL", Points: "0,0,1,0,1,1" });
    expect(pathGeometry({})).toBeNull();
  });

  it("leave a part that has both coordinates alone", () => {
    const part = { Location: { Left: 1, Top: 2 } };
    expect(withOrigin(part)).toBe(part);
    expect(withOrigin({ Location: { Top: 9 } })).toEqual({ Location: { Left: 0, Top: 9 } });
    expect(withOrigin({})).toEqual({ Location: { Left: 0, Top: 0 } });
  });
});
