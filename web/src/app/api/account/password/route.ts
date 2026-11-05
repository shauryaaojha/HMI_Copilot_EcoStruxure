import { changePassword } from "@/lib/server/credentials";
import { errorResponse, ServerError } from "@/lib/server/errors";
import { json } from "@/lib/server/http";
import { currentUser } from "@/lib/server/session";
import { clearAccountSessions } from "@/lib/server/sessions";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user?.email) throw new ServerError(401, "unauthorized", "Sign in to change your password");
    const body = await json(request);
    await changePassword(user, body.currentPassword, body.newPassword, request);
    clearAccountSessions(user.id);
    return new Response(null, { status: 204 });
  } catch (error) { return errorResponse(error); }
}
