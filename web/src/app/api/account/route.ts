import { deleteAccountWithPassword } from "@/lib/server/credentials";
import { errorResponse, ServerError } from "@/lib/server/errors";
import { json } from "@/lib/server/http";
import { currentUser } from "@/lib/server/session";
import { clearAccountSessions } from "@/lib/server/sessions";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  try {
    const user = await currentUser();
    if (!user?.email) throw new ServerError(401, "unauthorized", "Sign in to delete your account");
    const body = await json(request);
    const result = await deleteAccountWithPassword(user, body.password, request);
    clearAccountSessions(user.id);
    return Response.json({ deleted: true, ...result });
  } catch (error) { return errorResponse(error); }
}
