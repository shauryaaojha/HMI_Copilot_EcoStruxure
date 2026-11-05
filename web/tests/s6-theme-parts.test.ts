import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { arch, ellipse, line, polygon, rectangle, screenOf } from "@/lib/ote/parts";
import { Part, type Part as PartType } from "@/lib/ote/schema";
import { DEFAULT_PACK, StandardPack } from "@/lib/standard/pack";
import { contrastRatio, DEFAULT_THEME, densityOf } from "@/lib/components/theme";
import { packageProject } from "@/lib/ote/packager";
import { readProject } from "@/lib/ote/reader";

const box = { left: 8, top: 8, width: 80, height: 64 };
const shapes = [
  ellipse("Ellipse", box, { fill: 11, border: 22 }),
  polygon("Polygon", box, [{ x: 0, y: 0 }, { x: 1, y: 0.5 }, { x: 0, y: 1 }]),
  line("Line", box, { points: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }] }),
  arch("Arch", box, { start: 135, end: 405, innerRadius: 75 }),
  rectangle("Round", box, { radius: 4 }),
];

describe("theme and unbenched part factories", () => {
  it("parses the theme, density scale and required contrast pairs", () => {
    expect(StandardPack.parse(DEFAULT_PACK).theme).toEqual(DEFAULT_THEME);
    expect(densityOf({ width: 320, height: 240 })).toBe("compact");
    expect(densityOf({ width: 1024, height: 600 })).toBe("regular");
    expect(densityOf({ width: 1280, height: 800 })).toBe("large");
    const t = DEFAULT_THEME.tokens;
    expect(contrastRatio(t.ground, t.field)).toBeGreaterThanOrEqual(1.4);
    expect(contrastRatio(t.ink, t.ground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.onDark, t.equipmentRunning)).toBeGreaterThanOrEqual(4.5);
    for (const role of ["alarmP1", "alarmP2", "alarmP3", "alarmP4"] as const) {
      expect(contrastRatio(t.ink, t[role])).toBeGreaterThan(1);
    }
  });

  it.each(shapes)("schema parses $Type and keeps the factory data", (part) => {
    expect(Part.parse(part)).toEqual(part);
  });

  it.skipIf(!fs.existsSync(path.join(__dirname, "..", "skeleton", "manifest.json")))("writes and reads every new factory unchanged through a project", async () => {
    const parts = shapes as PartType[];
    const target = { model: "HMIST6500AWADI", width: 1024, height: 600 };
    const bytes = await packageProject({ name: "Shapes", target, screens: [screenOf("Shapes", parts, target)], variables: [], alarms: [], wires: [] });
    const read = await readProject(bytes);
    for (const original of parts) {
      const actual = read.screens[0].Children[0].Children.find((p) => p.Name === original.Name);
      expect(actual).toEqual(original);
    }
  });
});
