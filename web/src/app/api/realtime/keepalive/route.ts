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
 *
 * Only the cron may call it. Vercel sends `Authorization: Bearer $CRON_SECRET`
 * with every cron request, and anything without it is refused: this route
 * spends the project's message quota, and a URL that spends quota is a URL a
 * stranger can spend. With no `CRON_SECRET` set it refuses everything, the
 * cron included. That direction is deliberate - a keep-alive that stops
 * running loses a Free project a week later, which is visible and reversible
 * (docs/REALTIME_SETUP.md), while an open writer is neither.
 */
import { publishRevision } from "@/lib/realtime/publish";
import { serverConfig } from "@/lib/realtime/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether this request is the cron's: a secret is set, and the request carries it. */
export function fromCron(request: Request): boolean {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!fromCron(request)) {
    return Response.json({ error: "unauthorized", message: "This route is called by the cron" }, { status: 401 });
  }
  if (!serverConfig()) {
    return Response.json({ ok: true, skipped: "Realtime is not configured on this deployment" });
  }
  // A notice on a topic no project uses: it keeps the connection warm without
  // telling any client that a revision it should fetch has landed.
  const sent = await publishRevision({ projectId: "keepalive", rev: 0, author: null });
  return Response.json({ ok: true, sent, at: new Date().toISOString() });
}
