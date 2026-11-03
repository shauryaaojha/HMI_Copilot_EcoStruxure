/**
 * Mint a Realtime token for one project.
 *
 * The browser calls this before joining a channel and again before the token
 * lapses. Access is decided here, in MongoDB, by the same `requireReader` the
 * rest of the project routes use - so a person who cannot read the project
 * cannot get a token, and without a token Realtime refuses the join.
 *
 * 503 rather than an error when Supabase is not configured: a deployment with
 * no Supabase project is a supported state, and the client falls back to the
 * event stream.
 */
import { requireReader } from "@/lib/server/access";
import { currentUser } from "@/lib/server/session";
import { mintRealtimeToken } from "@/lib/realtime/token";
import { errorResponse, type Context } from "@/lib/server/http";
import { ServerError } from "@/lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const user = await currentUser();
    await requireReader(user, id, request);
    // A share-link visitor has read access but no identity to scope a token
    // to, so they keep the event stream rather than getting a channel.
    if (!user) throw new ServerError(401, "unauthorized", "Sign in to use live sync");
    const minted = await mintRealtimeToken(user.id, id);
    if (!minted) throw new ServerError(503, "unconfigured", "Realtime is not configured on this deployment");
    return Response.json(minted, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
