/**
 * The generator's screens, measured the way the audit measured them (design B,
 * phase 3): the four tracked samples through the same build the agent runs.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFromTags } from "@/lib/agent/build";
import { BENCHED_PARTS, DEFAULT_THEME } from "@/lib/components";
import { critiqueGeometry } from "@/lib/critic/geometry";
import { screenToSvg } from "@/lib/critic/render";
import { DEFAULT_PACK } from "@/lib/standard/pack";
import { parseTags } from "@/lib/tags/parse";
import type { Part, Screen } from "@/lib/ote/schema";

const PANEL = { model: "HMIST6500AWADI", width: 1024, height: 600 };
const SAMPLES: [string, string][] = [
  ["transfer-pump-station", "transfer pump station, with a faceplate for PMP_101"],
  ["tank-farm", "tank farm overview"],
  ["water-treatment", "water treatment plant"],
  ["boiler-house", "boiler house"],
];

async function built(sample: string, intent: string): Promise<Screen[]> {
  const csv = path.resolve(import.meta.dirname, "..", "..", "samples", sample, "tags.csv");
  const { variables } = parseTags(fs.readFileSync(csv), "tags.csv");
  return (await buildFromTags({ name: sample, intent, variables, panel: PANEL })).input.screens;
}

const partsOf = (screen: Screen) => screen.Children[0].Children;
const colours = (node: unknown): number[] => {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(colours);
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    key === "Color" && value && typeof (value as { Value?: unknown }).Value === "number" ? [(value as { Value: number }).Value] : colours(value));
};

describe.each(SAMPLES)("%s", (sample, intent) => {
  it("meets the numbers design B set for a generated screen", async () => {
    const screens = await built(sample, intent);
    expect(screens.length).toBeGreaterThan(0);
    const allowed = new Set<number>([...Object.values(DEFAULT_THEME.tokens), ...Object.values(DEFAULT_PACK.tokens)]);
    let edges = 0, onGrid = 0;
    for (const screen of screens) {
      const parts = partsOf(screen);
      const report = critiqueGeometry(screen, DEFAULT_PACK);
      expect(report.findings.filter((f) => f.rule === "geom.overlap").map((f) => f.message), screen.Name).toEqual([]);

      for (const part of parts) {
        expect(BENCHED_PARTS as readonly string[], `${screen.Name}: ${part.Name}`).toContain(part.Type);
        if (part.Type === "Pipe") continue;
        for (const edge of [part.Location.Left, part.Location.Top, part.Location.Left + (part.Width ?? 0), part.Location.Top + (part.Height ?? 0)]) {
          edges++;
          if (edge % 4 === 0) onGrid++;
        }
        for (const colour of colours(part)) expect(allowed, `${screen.Name}: ${part.Name} uses colour ${colour}`).toContain(colour);
        if (part.Type === "TextBox") {
          const size = part.Font?.Size ?? 12;
          expect(size, `${screen.Name}: ${part.Name}`).toBeGreaterThanOrEqual(DEFAULT_THEME.type.regular.small);
          expect(part.Text.length * size * 0.55, `${screen.Name}: ${part.Name} "${part.Text}" runs out of its box`).toBeLessThanOrEqual((part.Width ?? 0) + 2);
        }
        const fill = part.Type === "Rectangle" ? part.Animation?.FillLevel : undefined;
        if (fill?.Enable) expect((fill.HorizontalFill ?? fill.VerticalFill ?? 0), `${screen.Name}: ${part.Name} is an empty bar`).toBeGreaterThan(0);
      }

      // Chrome: everything above the body, and the banner and footer below it.
      const nav = parts.find((p) => p.Name.startsWith("Nav_"))!;
      const banner = parts.find((p) => p.Name.startsWith("AlarmBanner_") && p.Type === "Rectangle");
      const bottomTop = banner ? banner.Location.Top : PANEL.height - 16;
      const chrome = nav.Location.Top + (nav.Height ?? 0) + PANEL.height - bottomTop;
      expect(chrome / PANEL.height, screen.Name).toBeLessThanOrEqual(0.2);
    }
    expect(onGrid / edges).toBeGreaterThanOrEqual(0.95);
  });
});

describe("the level drawings", () => {
  const normal = (svg: string) => svg.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "ID");
  it("stay what they were, one screen per level", async () => {
    const screens = await built(...SAMPLES[0]);
    const levels = new Map<string, Screen>();
    const text = (screen: Screen, part: (p: Part) => boolean) => partsOf(screen).find(part);
    for (const screen of screens) {
      const label = text(screen, (p) => p.Name.startsWith("HdrLevel_"));
      const level = label?.Type === "TextBox" ? label.Text.slice(0, 7) : "";
      if (level && !levels.has(level)) levels.set(level, screen);
    }
    expect(levels.size).toBeGreaterThanOrEqual(2);
    for (const [level, screen] of levels) {
      const svg = normal(await screenToSvg(screen));
      await expect(svg).toMatchFileSnapshot(`./__golden__/${level.replace(" ", "-")}.svg`);
    }
  });
});
