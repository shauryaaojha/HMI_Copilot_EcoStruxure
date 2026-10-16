/**
 * Server-Sent Events for one project: `change` events from the log after
 * `?since=rev`, `presence` when who-is-where changes, `reset` with the whole
 * snapshot when the client is further behind than the log reaches. Each connection lasts at most 55 s;
 * EventSource reconnects and the client resumes from its last revision.
 */
import { requireReader } from "@/lib/server/access";
import { currentUser } from "@/lib/server/session";
import { projectEvents, sse } from "@/lib/server/stream";
import { errorResponse, type Context } from "@/lib/server/http";
import { ServerError } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Open the stream; anyone who may read the project may listen. */
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const user = await currentUser();
    await requireReader(user, id, request);
    const raw = new URL(request.url).searchParams.get("since");
    const since = raw === null ? 0 : Number(raw);
    if (!Number.isSafeInteger(since) || since < 0) throw new ServerError(400, "invalid", "since is a revision number");
    const encoder = new TextEncoder();
    const events = projectEvents(id, since, { signal: request.signal });
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await events.next();
          if (next.done) controller.close();
          else controller.enqueue(encoder.encode(sse(next.value)));
        } catch {
          // Storage went away mid-stream: close, and let the client reconnect.
          controller.close();
        }
      },
      async cancel() {
        await events.return(undefined);
      },
    });
    return new Response(body, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
    });
  } catch (e) { return errorResponse(e); }
}
