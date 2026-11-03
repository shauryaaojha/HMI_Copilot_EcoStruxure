/**
 * A Vercel function has no system fonts, so the rasteriser brings its own
 * (fonts/NotoSans-Regular.ttf). Without it every label in a rendered screen
 * came out blank in production while looking right on a laptop.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Resvg } from "@resvg/resvg-js";

const WEB = path.join(__dirname, "..");
const FONT = path.join(WEB, "fonts", "NotoSans-Regular.ttf");

function inkPixels(svg: string, fontFiles: string[]) {
  const img = new Resvg(svg, { font: { loadSystemFonts: false, fontFiles, defaultFontFamily: "Noto Sans" } }).render();
  let ink = 0;
  for (let i = 0; i < img.pixels.length; i += 4) if (img.pixels[i + 3] > 0) ink++;
  return ink;
}

describe("the rasteriser's bundled font", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40"><text x="4" y="28" font-size="20" font-family="Segoe UI, Noto Sans, Arial, sans-serif">Tank level</text></svg>`;

  it("draws text with no system font at all", () => {
    expect(fs.existsSync(FONT)).toBe(true);
    expect(inkPixels(svg, [])).toBe(0);
    expect(inkPixels(svg, [FONT])).toBeGreaterThan(100);
  });

  it("is carried into every route that rasterises a screen", () => {
    const config = fs.readFileSync(path.join(WEB, "next.config.ts"), "utf8");
    for (const route of ["/api/critique", "/api/mcp", "/api/agent"]) {
      const line = config.split("\n").find((l) => l.includes(`"${route}":`));
      expect(line, route).toMatch(/\bFONT\b/);
    }
  });
});
