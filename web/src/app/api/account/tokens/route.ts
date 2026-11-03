/**
 * Mint a personal access token.
 *
 * The secret is in this one response and nowhere else, ever: only its hash is
 * stored, so there is no route that could show it again and no support
 * procedure that could recover it. That is the point of the design rather
 * than a limitation of it, and the UI says so where the engineer can read it.
 */
import { errorResponse, json, userRequired } from "@/lib/server/http";
import { createPersonalToken } from "@/lib/server/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Body `{ name? }`; answers `{ token, id, name, expiresAt }`. */
export async function POST(request: Request) {
  try {
    const user = await userRequired();
    const body = await json(request);
    const { token, info } = await createPersonalToken(user, body.name);
    return Response.json(
      { token, id: info.id, name: info.name, scopes: info.scopes, createdAt: info.createdAt, expiresAt: info.expiresAt },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) { return errorResponse(error); }
}
