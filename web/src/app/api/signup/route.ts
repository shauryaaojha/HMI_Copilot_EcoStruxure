/**
 * Making an account. The whole rule set - the address, the password, the
 * limits, what a refusal is allowed to say - is lib/server/credentials.ts;
 * this is the HTTP shape of it.
 *
 * Signing in is not here: that POST belongs to Auth.js, at
 * /api/auth/callback/credentials, because the CSRF token and the session
 * cookie are its business.
 */
import { signUp } from "@/lib/server/credentials";
import { errorResponse, json } from "@/lib/server/http";
export const runtime = "nodejs";

/** Body `{ email, password, name? }`; answers the new profile, never its hash. */
export async function POST(request: Request) {
  try {
    const body = await json(request);
    const user = await signUp(body, request);
    return Response.json({ user }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
