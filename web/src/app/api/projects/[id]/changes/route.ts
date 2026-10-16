/**
 * Live edits arrive here in batches (Phase C). Each change is applied, in
 * order, to the latest snapshot and given the next revision; the answer says
 * which were accepted and why any were not. The author is always the signed-in
 * editor: a client cannot write in someone else's name, or the Copilot's.
 */
import { repo } from "@/lib/server/repo";
import { requireAccess } from "@/lib/server/access";
import { currentUser } from "@/lib/server/session";
import { BATCH_LIMIT } from "@/lib/server/repo-live";
import { errorResponse, json, type Context } from "@/lib/server/http";
import { ServerError } from "@/lib/server/errors";
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
    return Response.json(await repo().live.append(id, changes), { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
