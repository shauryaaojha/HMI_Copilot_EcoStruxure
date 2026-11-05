import { repo } from "@/lib/server/repo";
import { currentUser } from "@/lib/server/session";
import { clearAccountSessions } from "@/lib/server/sessions";
import { errorResponse, ServerError } from "@/lib/server/errors";
import { sameOrigin } from "@/lib/server/http";

export const runtime = "nodejs";

/** Ending every session changes the version that every cookie must match. */
export async function DELETE(request: Request) {
  try {
    // There is no body, so nothing else here would check where this came from.
    sameOrigin(request);
    const user = await currentUser();
    if (!user?.email) throw new ServerError(401, "unauthorized", "Sign in to manage sessions");
    await repo().users.bumpSessionVersion(user.id);
    clearAccountSessions(user.id);
    return new Response(null, { status: 204 });
  } catch (error) { return errorResponse(error); }
}
