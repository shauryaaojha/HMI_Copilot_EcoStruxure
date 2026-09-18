/**
 * Review a screen: render it to pixels, show it to the critic, return the
 * findings. docs/ARCHITECTURE_SCREEN_QUALITY.md §3.5.
 *
 * Node runtime: the rasteriser is native. With no provider configured the
 * answer says so and carries the PNG anyway, so the render itself can be
 * looked at.
 */

import { Screen } from "@/lib/ote/schema";
import { resolveProvider } from "@/lib/ai/provider";

/**
 * Loaded on demand. The renderer draws with React's server renderer, which
 * Next's bundler refuses to see in a route's module graph, even a dynamic
 * one - so the module is resolved at run time, outside the bundle, the way
 * the packager loads sql.js.
 */
const critic = () => import("@/lib/critic/critic");
const render = () => import("@/lib/critic/render");

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(request: Request) {
  let body: { screen?: unknown; renderOnly?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected JSON with a screen" }, { status: 400 });
  }
  const parsed = Screen.safeParse(body.screen);
  if (!parsed.success) {
    return Response.json({ error: "that is not a screen the canvas can draw" }, { status: 400 });
  }
  const screen = parsed.data;

  try {
    if (body.renderOnly) {
      const { screenToPng } = await render();
      const png = await screenToPng(screen);
      return new Response(Buffer.from(png), { headers: { "Content-Type": "image/png" } });
    }
    const choice = resolveProvider();
    if (!choice.provider) {
      return Response.json({ provider: null, reason: choice.reason, report: null });
    }
    const { critique } = await critic();
    const result = await critique(screen);
    if (!result) {
      return Response.json({ provider: choice.provider, reason: "the model did not answer with a report", report: null });
    }
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "could not review the screen";
    return Response.json({ error: message }, { status: 500 });
  }
}
