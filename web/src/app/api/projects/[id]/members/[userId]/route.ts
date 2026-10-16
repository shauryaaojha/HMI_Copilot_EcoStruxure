/**
 * The owner changes a member's role or removes them. Ownership itself is not
 * transferable here: the repository keeps exactly one owner per project.
 */
import { repo } from "@/lib/server/repo";
import { requireAccess } from "@/lib/server/access";
import { currentUser } from "@/lib/server/session";
import { errorResponse, json, sameOrigin } from "@/lib/server/http";
import { ServerError } from "@/lib/server/errors";
export const runtime = "nodejs";
type MemberContext = { params: Promise<{ id: string; userId: string }> };
const ROLES = ["editor", "commenter", "viewer"] as const;

/** Set a member's role to editor, commenter or viewer. */
export async function PATCH(request: Request, context: MemberContext) {
  try {
    const { id, userId } = await context.params;
    await requireAccess(await currentUser(), id, "manage", request);
    const body = await json(request);
    const role = ROLES.find(r => r === body.role);
    if (!role) throw new ServerError(400, "invalid", "A member is an editor, a commenter or a viewer");
    if (!await repo().members.get(id, userId)) throw new ServerError(404, "not-found", "Not a member of this project");
    await repo().members.put(id, userId, role);
    return Response.json({ member: await repo().members.get(id, userId) });
  } catch (e) { return errorResponse(e); }
}

/** Remove a member; the owner cannot be removed. */
export async function DELETE(request: Request, context: MemberContext) {
  try {
    sameOrigin(request);
    const { id, userId } = await context.params;
    await requireAccess(await currentUser(), id, "manage", request);
    await repo().members.remove(id, userId);
    return Response.json({ removed: true });
  } catch (e) { return errorResponse(e); }
}
