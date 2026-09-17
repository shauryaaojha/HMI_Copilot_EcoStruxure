/**
 * Which model answers, so the UI can say so.
 *
 * Returns the resolved choice and nothing else - no key, no environment. The
 * reason is the sentence provider.ts wrote, which is what the status bar
 * shows on hover when no model is configured.
 */

import { resolveProvider } from "@/lib/ai/provider";

export const runtime = "nodejs";

export async function GET() {
  const { provider, model, reason } = resolveProvider();
  return Response.json({ provider, model, reason });
}
