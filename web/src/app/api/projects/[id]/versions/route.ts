/** Restoring writes a new authored revision; old history remains immutable. */
import { repo } from "@/lib/server/repo";
import { requireAccess } from "@/lib/server/access";
import { currentUser } from "@/lib/server/session";
import { json, revision, errorResponse, type Context } from "@/lib/server/http";
export const runtime = "nodejs";
export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params; await requireAccess(await currentUser(), id, "read");
    return Response.json({ versions: await repo().versions.list(id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params; const user = await requireAccess(await currentUser(), id, "edit");
    return Response.json(await repo().versions.restore(id, revision((await json(request)).rev), user.id));
  } catch (e) { return errorResponse(e); }
}
