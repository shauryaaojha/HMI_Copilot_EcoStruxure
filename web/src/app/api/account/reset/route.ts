import { resetPassword } from "@/lib/server/credentials";
import { errorResponse } from "@/lib/server/errors";
import { json } from "@/lib/server/http";
import { clearAccountSessions } from "@/lib/server/sessions";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await json(request);
    const userId = await resetPassword(body.token, body.newPassword);
    clearAccountSessions(userId);
    return new Response(null, { status: 204 });
  } catch (error) { return errorResponse(error); }
}
