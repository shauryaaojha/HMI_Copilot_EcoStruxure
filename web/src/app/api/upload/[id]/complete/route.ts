/** Assembly produces a permanent private source or an expiring anonymous one. */
import { repo } from "@/lib/server/repo";
import { currentUser } from "@/lib/server/session";
import { sameOrigin, errorResponse, type Context } from "@/lib/server/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request, context: Context) {
  try {
    sameOrigin(request); const { id } = await context.params;
    return Response.json({ sourceId: await repo().uploads.complete(id, (await currentUser())?.id ?? null) });
  } catch (e) { return errorResponse(e); }
}
