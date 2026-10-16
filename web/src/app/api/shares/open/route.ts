/**
 * Opening a share link. Signed in: become a member with the link's role (never
 * a weaker one than already held). Signed out: a viewer link sets the
 * `hmi_share` cookie, which lets this browser read that project; a commenter
 * or editor link asks for a sign-in first, because those leave a name behind.
 */
import { currentUser } from "@/lib/server/session";
import { inspectShare, joinShare, shareCookie } from "@/lib/server/shares";
import { errorResponse, json } from "@/lib/server/http";
import { ServerError } from "@/lib/server/errors";
export const runtime = "nodejs";

/** Body `{ token }`; answers the project and the role this browser now has on it. */
export async function POST(request: Request) {
  try {
    const body = await json(request);
    const token = typeof body.token === "string" ? body.token : "";
    const found = await inspectShare(token);
    if (found.status !== "ok") {
      if (found.status === "expired") throw new ServerError(410, "expired", "This link has expired");
      if (found.status === "revoked") throw new ServerError(410, "revoked", "This link has been revoked");
      throw new ServerError(404, "not-found", "This link does not exist");
    }
    const user = await currentUser();
    if (user) {
      const joined = await joinShare(token, user);
      return Response.json({ projectId: joined.projectId, role: joined.role, member: true });
    }
    if (found.share.role !== "viewer") throw new ServerError(401, "sign-in", "Sign in to comment on or edit this project");
    return Response.json(
      { projectId: found.share.projectId, role: "viewer", member: false },
      { headers: { "Set-Cookie": shareCookie(request, token), "Cache-Control": "no-store" } },
    );
  } catch (e) { return errorResponse(e); }
}
