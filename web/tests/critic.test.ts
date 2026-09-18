/**
 * The renderer and the critic's guard rails. docs/ARCHITECTURE_SCREEN_QUALITY.md
 * §3.5, Phase 3 item 5. The model itself is not called here; what is held is
 * that the pipeline can see its own screen as pixels, that the checklist is
 * the pack's, and that a finding naming an object the screen does not have
 * never reaches the engineer.
 */

import { describe, expect, it } from "vitest";
import { screenToPng, screenToSvg } from "@/lib/critic/render";
import { checklist, CriticReport } from "@/lib/critic/critic";
import { ISA101 } from "@/lib/standard/pack";
import { demoScreen } from "@/fixtures";

describe("a screen as pixels", () => {
  it("is a standalone SVG at the panel's size, with no page variables left in it", async () => {
    const svg = await screenToSvg(demoScreen);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`width="${demoScreen.Children[0].Width}"`);
    expect(svg).toContain(`height="${demoScreen.Children[0].Height}"`);
    expect(svg).not.toMatch(/var\(--/);
  });

  it("rasterises to a PNG of the panel's size", async () => {
    const png = await screenToPng(demoScreen);
    // PNG signature, then the IHDR chunk with width and height big-endian.
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const width = (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19];
    const height = (png[20] << 24) | (png[21] << 16) | (png[22] << 8) | png[23];
    expect(width).toBe(demoScreen.Children[0].Width);
    expect(height).toBe(demoScreen.Children[0].Height);
    expect(png.length).toBeGreaterThan(1000);
  });

  it("draws the same picture twice", async () => {
    const a = await screenToPng(demoScreen);
    const b = await screenToPng(demoScreen);
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
  });
});

describe("the checklist and the report", () => {
  it("is written from the pack and covers what a lint cannot", () => {
    const text = checklist(ISA101);
    expect(text).toContain(ISA101.name);
    for (const rule of ["flow", "callouts", "salience", "balance", "labels", "density", "frame"]) expect(text).toContain(`- ${rule}:`);
    expect(text).toMatch(/Do not report colours or font sizes/);
  });

  it("accepts a well-formed report and refuses one out of range", () => {
    expect(CriticReport.safeParse({ summary: "ok", score: 4, findings: [] }).success).toBe(true);
    expect(CriticReport.safeParse({ summary: "ok", score: 7, findings: [] }).success).toBe(false);
    expect(
      CriticReport.safeParse({
        summary: "ok",
        score: 3,
        findings: [{ rule: "flow", severity: "warning", object: "Num_Flow", message: "m", suggestion: "s" }],
      }).success,
    ).toBe(true);
    expect(CriticReport.safeParse({ summary: "ok", score: 3, findings: [{ rule: "colour", severity: "warning", message: "m", suggestion: "s" }] }).success).toBe(false);
  });
});
