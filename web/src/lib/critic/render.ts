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

import { createElement } from "react";
import { rootBox, type Screen } from "@/lib/ote/schema";
import type { ForeignPart } from "@/store/types";
import { ScreenRenderer } from "@/components/canvas/ScreenRenderer";

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

export async function screenToSvg(screen: Screen, foreign?: ForeignPart[], around: Around = {}): Promise<string> {
  const box = rootBox(screen.Children[0], around.panel ?? { width: 1024, height: 600 });
  const renderToStaticMarkup = await serverRenderer();
  const markup = renderToStaticMarkup(createElement(ScreenRenderer, { screen, selectedIds: [], foreign, ...around }));
  // The canvas SVG sizes itself to its container and reads its colours from
  // the page. Standalone, it needs an absolute size, an xmlns, and the two
  // CSS variables the design uses spelled out.
  return markup
    .replace(/^<svg /, `<svg xmlns="http://www.w3.org/2000/svg" `)
    .replace(/width="100%"/, `width="${box.width}"`)
    .replace(/height="100%"/, `height="${box.height}"`)
    .replace(/var\(--font-sans\)/g, "Segoe UI, Arial, sans-serif")
    .replace(/var\(--font-mono\)/g, "Consolas, monospace")
    .replace(/var\(--color-[a-z-]+\)/g, "#7d8b99");
}

export async function screenToPng(screen: Screen, foreign?: ForeignPart[], scale = 1, around: Around = {}): Promise<Uint8Array> {
  const { Resvg } = await import("@resvg/resvg-js");
  const svg = await screenToSvg(screen, foreign, around);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "zoom", value: scale },
    font: { loadSystemFonts: true, defaultFontFamily: "Segoe UI" },
  });
  return resvg.render().asPng();
}
