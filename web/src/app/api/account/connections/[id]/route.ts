/**
 * Disconnect a client.
 *
 * The grant goes and every token issued under it goes with it, because one
 * consent produces a chain of access and refresh tokens over its lifetime and
 * "disconnect" has to mean the chain. `verifyToken` looks the grant up again
 * on every MCP call, so this lands on the very next request rather than
 * whenever the current access token would have expired.
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
    if (!(await repo().connector.revokeGrant(user.id, id))) throw notRevocable();
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
