/** Fetch one historical snapshot only when the engineer requests it. */
import { repo } from "@/lib/server/repo";
import { requireAccess } from "@/lib/server/access";
import { currentUser } from "@/lib/server/session";
import { errorResponse, revision } from "@/lib/server/http";
import { ServerError } from "@/lib/server/errors";
export const runtime = "nodejs";

/** Metadata lists stay small; this authorized endpoint loads the chosen body. */
export async function GET(_request: Request, context: { params: Promise<{ id: string; rev: string }> }) {
  try {
    const { id, rev } = await context.params;
    await requireAccess(await currentUser(), id, "read");
    const version = await repo().versions.get(id, revision(Number(rev)));
    if (!version) throw new ServerError(404, "not-found", "Version not found");
    return Response.json(version, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
