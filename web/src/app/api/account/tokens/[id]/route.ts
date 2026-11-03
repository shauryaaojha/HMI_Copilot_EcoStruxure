/**
 * Revoke a personal access token. The id is the row's public handle and
 * deliberately not its hash, so a page that can revoke a token has never been
 * handed the one value that would let it use one.
 */
import { repo } from "@/lib/server/repo";
import { errorResponse, userRequired, type Context } from "@/lib/server/http";
import { notRevocable } from "@/lib/server/repo-connector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: Context) {
  try {
    const user = await userRequired();
    const { id } = await context.params;
    if (!(await repo().connector.revokeToken(user.id, id))) throw notRevocable();
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
