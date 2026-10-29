/**
 * Keeps the Supabase project from pausing.
 *
 * A Free project pauses after a week of inactivity, and a paused project
 * refuses Realtime connections (docs/PLAN_FULL_ARCHITECTURE.md §3). Whether
 * Realtime traffic alone counts as activity is unverified, so this does not
 * rely on it: a Vercel Cron job calls this route every few days and it opens a
 * channel, which is activity we control.
 *
 * It answers 200 with what it did either way, so the cron run is readable in
 * the Vercel log rather than being a silent success. When Supabase is not
 * configured it says so and is still a 200: there is nothing to keep alive,
 * and a red cron would be noise.
 */
import { publishRevision } from "@/lib/realtime/publish";
import { serverConfig } from "@/lib/realtime/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!serverConfig()) {
    return Response.json({ ok: true, skipped: "Realtime is not configured on this deployment" });
  }
  // A notice on a topic no project uses: it keeps the connection warm without
  // telling any client that a revision it should fetch has landed.
  const sent = await publishRevision({ projectId: "keepalive", rev: 0, author: null });
  return Response.json({ ok: true, sent, at: new Date().toISOString() });
}
