"use client";

/**
 * Which live transport a session uses.
 *
 * Supabase Realtime when the deployment has a Supabase project, server-sent
 * events otherwise. The choice is made once, from the public configuration
 * the browser already has, and both satisfy the same `Transport` interface -
 * so the session, its reconnects and its gap handling are the same code
 * either way.
 *
 * Keeping SSE rather than deleting it is deliberate. It is the documented
 * fallback if the Free project pauses and cannot be kept alive
 * (docs/PLAN_FULL_ARCHITECTURE.md §3), and it is what lets the suite run with
 * no Supabase project at all.
 */

import { realtimeEnabled } from "@/lib/realtime/config";
import { browserTransport } from "./browser";
import { realtimeTransport } from "./realtime";
import type { Transport } from "./sync";

export function liveTransport(): Transport {
  return realtimeEnabled() ? realtimeTransport : browserTransport;
}
