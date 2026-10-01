/**
 * Which model answers, so the UI can say so.
 *
 * Returns the resolved choice and nothing else - no key, no environment. The
 * reason is the sentence provider.ts wrote, which is what the status bar
 * shows on hover when no model is configured.
 */

import { resolveProvider } from "@/lib/ai/provider";

export const runtime = "nodejs";

/**
 * Read at request time, never prerendered. A GET handler with no dynamic
 * signal is evaluated once at build and its answer baked in - so this route
 * reported the build machine's configuration for the life of the deployment,
 * which on Vercel meant "no model is configured" however the environment was
 * later set.
 */
export const dynamic = "force-dynamic";


export async function GET() {
  const { provider, model, reason } = resolveProvider();
  return Response.json({ provider, model, reason });
}
