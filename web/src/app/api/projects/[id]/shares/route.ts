/**
 * Share links for one project. Listing and creating them is the owner's; the
 * raw token is returned once, at creation, because only its hash is kept.
 */
import { repo, type ShareRole } from "@/lib/server/repo";
import { requireAccess } from "@/lib/server/access";
import { currentUser } from "@/lib/server/session";
import { createShare, shareInfo } from "@/lib/server/shares";
import { errorResponse, json, type Context } from "@/lib/server/http";
import { ServerError } from "@/lib/server/errors";
export const runtime = "nodejs";
const ROLES: ShareRole[] = ["viewer", "commenter", "editor"];

/** The project's links, newest first, without any token. */
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    await requireAccess(await currentUser(), id, "manage", request);
    const shares = (await repo().shares.list(id)).map(shareInfo);
    return Response.json({ shares }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}

/** Create a link: a role, an expiry in days (default 14, at most 90), and whether it may export. */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const user = await requireAccess(await currentUser(), id, "manage", request);
    const body = await json(request);
    const role = ROLES.find(r => r === body.role);
    if (!role) throw new ServerError(400, "invalid", "A link grants viewer, commenter or editor");
    if (body.allowExport !== undefined && typeof body.allowExport !== "boolean") throw new ServerError(400, "invalid", "allowExport is true or false");
    const { share, token, url } = await createShare(id, user.id, { role, days: body.days, allowExport: body.allowExport });
    return Response.json({ share: shareInfo(share), token, url }, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
