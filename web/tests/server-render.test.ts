/**
 * The screen rasteriser runs inside route handlers (render_screen, the critic),
 * which Next bundles with React's server build: no hooks, no createContext, and
 * a "use client" module arrives as a reference that cannot be called. Vitest
 * applies none of that, so a render test passes while the route fails
 * (docs/DEFECT_SERVER_RENDER.md). This test holds the property the bundler
 * enforces: nothing on the drawing path may use what the server build lacks.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { StaticScreen } from "@/components/canvas/StaticScreen";
import { DEFAULT_ENV, contentsById } from "@/components/canvas/parts";
import { screenToSvg } from "@/lib/critic/render";
import { alarmSummary } from "@/lib/ote/parts";
import { demoScreen } from "@/fixtures";
import type { Screen } from "@/lib/ote/schema";

const SRC = path.join(__dirname, "..", "src");
const PARTS = path.join(SRC, "components", "canvas", "parts");

/** Every file the rasteriser draws with. */
const drawingPath = [
  ...fs.readdirSync(PARTS).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(PARTS, f)),
  path.join(SRC, "components", "canvas", "StaticScreen.tsx"),
  path.join(SRC, "lib", "critic", "render.ts"),
];

const FORBIDDEN = [/^\s*["']use client["']/m, /\bcreateContext\s*\(/, /\buse(Context|State|Effect|LayoutEffect|Ref|Id|Memo|Callback|Reducer|SyncExternalStore)\s*\(/, /from\s+["']@\/store\/(?!types["'])/];

describe("the server drawing path", () => {
  it.each(drawingPath.map((f) => [path.relative(SRC, f), f]))("%s uses nothing React's server build lacks", (_name, file) => {
    const source = fs.readFileSync(file, "utf8");
    for (const rule of FORBIDDEN) expect(source, String(rule)).not.toMatch(rule);
  });

  it("draws a content display and an alarm summary from props alone", () => {
    const content = structuredClone(demoScreen) as Screen & { Type?: string; ContentID?: number };
    content.Type = "Content";
    content.ContentID = 7;
    content.Name = "Inner";
    const host = structuredClone(demoScreen);
    host.Children[0].Children = [
      { Type: "ContentDisplay", UniqueId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302", Name: "Window", Location: { Left: 0, Top: 0 }, Width: 200, Height: 120, ScreenId: 7 } as never,
      alarmSummary("Alarms", { left: 0, top: 200, width: 300, height: 120 }),
    ];
    const env = { ...DEFAULT_ENV, contents: contentsById([content as Screen]) };
    const svg = renderToStaticMarkup(createElement(StaticScreen, { screen: host, env }));
    // The display drew the content's parts rather than its "nothing to show" label.
    expect(svg).not.toContain(">Inner<");
    expect(svg).toContain('viewBox="0 0');
    expect(svg).toMatch(/clipPath id="alarm-clip-[0-9a-f-]+"/);
  });

  it("still hands a rasteriser a standalone SVG", async () => {
    const svg = await screenToSvg(demoScreen);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" /);
    expect(svg).not.toContain('width="100%"');
  });
});
