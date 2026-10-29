/**
 * Live edits arrive here in batches (Phase C). Each change is applied, in
 * order, to the latest snapshot and given the next revision; the answer says
 * which were accepted and why any were not. The author is always the signed-in
 * editor: a client cannot write in someone else's name, or the Copilot's.
 */
import { repo } from "@/lib/server/repo";
import { requireAccess, requireReader } from "@/lib/server/access";
import { currentUser } from "@/lib/server/session";
import { BATCH_LIMIT } from "@/lib/server/repo-live";
import { errorResponse, json, type Context } from "@/lib/server/http";
import { ServerError } from "@/lib/server/errors";
import { publishRevision } from "@/lib/realtime/publish";
import type { Change } from "@/lib/collab/types";
export const runtime = "nodejs";

/** Body `{ base, changes: Change[] }`; answers `{ rev, accepted, rejected }`. */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const user = await requireAccess(await currentUser(), id, "edit", request);
    const body = await json(request);
    if (!Array.isArray(body.changes)) throw new ServerError(400, "invalid", "Expected a list of changes");
    if (body.changes.length > BATCH_LIMIT) throw new ServerError(413, "too-large", `At most ${BATCH_LIMIT} changes per request`);
    const changes = (body.changes as Partial<Change>[]).map(change => {
      const base = Number.isSafeInteger(change?.base) ? change.base : body.base;
      return { id: change?.id, base, ops: change?.ops, author: user.id } as Change;
    });
    const result = await repo().live.append(id, changes);
    // After the transaction, never before it: the broadcast says a revision
    // landed, and the revision it names is the one Mongo assigned.
    if (result.accepted.length > 0) {
      void publishRevision({ projectId: id, rev: result.rev, author: user.id });
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}

/**
 * The changes after `?since=rev`, for a client closing a revision gap.
 *
 * A Realtime broadcast says only that revision N landed and who landed it; the
 * ops are fetched here (docs/PLAN_FULL_ARCHITECTURE.md §2.3). This is the same
 * read the event stream makes between polls, so both transports see one log in
 * one order, and a client too far behind for the log gets `reset` with the
 * snapshot instead - the same answer the stream gives, for the same reason.
 */
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const user = await currentUser();
    await requireReader(user, id, request);
    const raw = new URL(request.url).searchParams.get("since");
    const since = raw === null ? 0 : Number(raw);
    if (!Number.isSafeInteger(since) || since < 0) throw new ServerError(400, "invalid", "since is a revision number");
    const found = await repo().live.since(id, since);
    return Response.json(found, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
