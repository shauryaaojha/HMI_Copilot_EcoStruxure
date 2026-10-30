/**
 * Presence heartbeat: which screen someone is on, what they have selected and
 * where their pointer is. Sent every 5 s, counted for 15 s, broadcast on the
 * stream. A signed-out viewer has no name to show, so their heartbeat is
 * accepted and dropped.
 *
 * The answer carries everyone currently here, not only the entry just stored.
 * This route is where presence lives for both transports, and a Realtime
 * session has no other way to read it: its channel carries revision
 * broadcasts and nothing else (lib/collab/realtime.ts). So the heartbeat it
 * already sends every five seconds is also its read, with no second request
 * and no second copy of who-is-where.
 */
import { repo } from "@/lib/server/repo";
import { requireReader } from "@/lib/server/access";
import { currentUser } from "@/lib/server/session";
import { errorResponse, json, type Context } from "@/lib/server/http";
export const runtime = "nodejs";

const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length <= 160).slice(0, 200) : [];

/** Body `{ screenId?, selection: string[], cursor?: { x, y } }`. */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const user = await currentUser();
    await requireReader(user, id, request);
    const body = await json(request);
    if (!user) return Response.json({ ok: true, anonymous: true });
    const cursor = body.cursor as { x?: unknown; y?: unknown } | undefined;
    const point = cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.y) ? { x: Number(cursor.x), y: Number(cursor.y) } : undefined;
    const presence = await repo().live.presence.put(id, {
      userId: user.id,
      name: user.name,
      selection: ids(body.selection),
      ...(typeof body.screenId === "string" ? { screenId: body.screenId.slice(0, 160) } : {}),
      ...(point ? { cursor: point } : {}),
    });
    // Read after the write, so this person is in the list they get back and
    // the list is the same one the event stream sends to everyone else.
    const users = await repo().live.presence.list(id);
    return Response.json({ ok: true, presence, users }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
