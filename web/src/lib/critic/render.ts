/**
 * A screen as pixels. docs/ARCHITECTURE_SCREEN_QUALITY.md §3.5.
 *
 * The canvas already draws every part to SVG; this renders that same SVG
 * headlessly, so the pipeline can look at its own output and a critic can
 * be shown what an operator would see. Same component, same pixels as the
 * browser - the one difference is the font, which resvg resolves from the
 * system rather than the page's stylesheet.
 *
 * Node only: resvg is a native module. Nothing here is imported by the
 * browser bundle.
 */

import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { rootBox, type Screen } from "@/lib/ote/schema";
import type { ForeignPart } from "@/store/types";
// StaticScreen, not ScreenRenderer: a route handler gets React's server build,
// where ScreenRenderer (a client component with hooks) cannot be called.
import { StaticScreen } from "@/components/canvas/StaticScreen";
import { contentsById, DEFAULT_ENV } from "@/components/canvas/parts";

/**
 * React's server renderer, resolved at run time. Next's App Router refuses
 * a static import of react-dom/server anywhere a route can reach, on the
 * grounds that a route is not where you server-render components - and it
 * is right in general. This is the one place it is exactly what we want:
 * the canvas component as a string, so a rasteriser can draw it. The
 * ignore comment keeps the bundler from following the import.
 */
async function serverRenderer() {
  const mod = await import(/* webpackIgnore: true */ "react-dom/server");
  return mod.renderToStaticMarkup as (el: React.ReactElement) => string;
}

/** The screen's SVG, standalone: namespace and size set so a rasteriser accepts it. */
export interface Around {
  /** The project's content screens, so a ContentDisplay draws what it shows. */
  contents?: Screen[];
  /** Carried objects of every screen, for those content screens. */
  contentForeign?: Record<string, ForeignPart[]>;
  /** The panel's size, for a screen whose root gives none (an opened project's Canvas). */
  panel?: { width: number; height: number };
}

/**
 * The screen without the top-level parts that lie wholly outside its canvas.
 * They draw nothing, and resvg panics on some of them (a clip-path group far
 * off the canvas, as an AlarmSummary draws), which aborts the whole Node
 * process (docs/audit/BUGS.md S3-10). Parts placed by a container (a Grid
 * cell) have no Location of their own and are kept.
 */
function onCanvas(screen: Screen, box: { width: number; height: number }): Screen {
  const root = screen.Children[0] as Screen["Children"][number] & { Children?: unknown[] };
  if (!Array.isArray(root.Children)) return screen;
  const inside = (p: unknown) => {
    const { Location, Width, Height } = p as { Location?: { Left?: number; Top?: number }; Width?: number; Height?: number };
    const left = Location?.Left, top = Location?.Top;
    if (typeof left !== "number" || typeof top !== "number" || typeof Width !== "number" || typeof Height !== "number") return true;
    return left < box.width && top < box.height && left + Width > 0 && top + Height > 0;
  };
  const kept = root.Children.filter(inside);
  return kept.length === root.Children.length ? screen : ({ ...screen, Children: [{ ...root, Children: kept }, ...screen.Children.slice(1)] } as Screen);
}

export async function screenToSvg(screen: Screen, foreign?: ForeignPart[], around: Around = {}): Promise<string> {
  const box = rootBox(screen.Children[0], around.panel ?? { width: 1024, height: 600 });
  screen = onCanvas(screen, box);
  const renderToStaticMarkup = await serverRenderer();
  const env = { ...DEFAULT_ENV, contents: contentsById(around.contents ?? []), carried: around.contentForeign };
  const markup = renderToStaticMarkup(createElement(StaticScreen, { screen, foreign, env, panel: around.panel }));
  // The canvas SVG sizes itself to its container and reads its colours from
  // the page. Standalone, it needs an absolute size, an xmlns, and the two
  // CSS variables the design uses spelled out.
  return markup
    .replace(/^<svg /, `<svg xmlns="http://www.w3.org/2000/svg" `)
    .replace(/width="100%"/, `width="${box.width}"`)
    .replace(/height="100%"/, `height="${box.height}"`)
    .replace(/var\(--font-sans\)/g, "Segoe UI, Noto Sans, Arial, sans-serif")
    .replace(/var\(--font-mono\)/g, "Consolas, Noto Sans, monospace")
    .replace(/var\(--color-[a-z-]+\)/g, "#7d8b99");
}

/**
 * A font resvg can always find. A Vercel function has no system fonts, so
 * with loadSystemFonts alone every label renders blank there (it worked on a
 * laptop, which has Segoe UI). fonts/ is carried into the routes that render
 * by outputFileTracingIncludes in next.config.ts.
 */
const BUNDLED_FONT = path.join(process.cwd(), "fonts", "NotoSans-Regular.ttf");

export async function screenToPng(screen: Screen, foreign?: ForeignPart[], scale = 1, around: Around = {}): Promise<Uint8Array> {
  const { Resvg } = await import("@resvg/resvg-js");
  const svg = await screenToSvg(screen, foreign, around);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "zoom", value: scale },
    font: {
      loadSystemFonts: true,
      fontFiles: fs.existsSync(BUNDLED_FONT) ? [BUNDLED_FONT] : [],
      // Segoe UI where the machine has it; Noto Sans everywhere else.
      defaultFontFamily: process.platform === "win32" ? "Segoe UI" : "Noto Sans",
    },
  });
  return resvg.render().asPng();
}
