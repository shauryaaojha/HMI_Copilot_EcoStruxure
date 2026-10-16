/** Current snapshot (with the caller's access), compare-and-save, and owner-only deletion. */
import { repo } from "@/lib/server/repo";
import { requireAccess, requireReader } from "@/lib/server/access";
import { currentUser } from "@/lib/server/session";
import { snapshot, revision, label, sameOrigin, errorResponse, type Context } from "@/lib/server/http";
import { snapshotBody } from "@/lib/server/snapshot";
export const runtime = "nodejs";
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    // Members and signed-out viewer links both read here; the access tells
    // the editor which affordances to offer.
    const { access } = await requireReader(await currentUser(), id, request);
    const version = await repo().versions.current(id);
    return Response.json({ project: await repo().projects.get(id), rev: version?.rev, snapshot: version?.snapshot, access }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
export async function PUT(request: Request, context: Context) {
  try {
    const { id } = await context.params; const user = await requireAccess(await currentUser(), id, "edit");
    const body = await snapshotBody(request, user);
    const value = await snapshot(body.snapshot, user);
    return Response.json(await repo().projects.save(id, revision(body.rev), value, user.id, label(body.label)));
  } catch (e) { return errorResponse(e); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    sameOrigin(request); const { id } = await context.params;
    await requireAccess(await currentUser(), id, "manage"); await repo().projects.delete(id);
    return Response.json({ deleted: true });
  } catch (e) { return errorResponse(e); }
}
