/** Revoking a link stops it working at once; the record stays for the audit trail. */
import { repo } from "@/lib/server/repo";
import { requireAccess } from "@/lib/server/access";
import { currentUser } from "@/lib/server/session";
import { errorResponse, sameOrigin } from "@/lib/server/http";
import { shareInfo } from "@/lib/server/shares";
export const runtime = "nodejs";

/** Revoke one link of this project. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string; shareId: string }> }) {
  try {
    sameOrigin(request);
    const { id, shareId } = await context.params;
    await requireAccess(await currentUser(), id, "manage", request);
    return Response.json({ share: shareInfo(await repo().shares.revoke(id, shareId)) });
  } catch (e) { return errorResponse(e); }
}
