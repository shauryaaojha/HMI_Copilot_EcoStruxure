/** A numbered raw part; retrying the same number replaces only that part. */
import { repo, PART_BYTES } from "@/lib/server/repo";
import { currentUser } from "@/lib/server/session";
import { readBody } from "@/lib/ingest/body";
import { sameOrigin, errorResponse, type Context } from "@/lib/server/http";
export const runtime = "nodejs";
export async function PUT(request: Request, context: Context) {
  try {
    sameOrigin(request); const { id } = await context.params;
    const part = new URL(request.url).searchParams.get("part");
    await repo().uploads.part(id, part === null ? NaN : Number(part), await readBody(request, PART_BYTES), (await currentUser())?.id ?? null);
    return Response.json({ uploaded: true });
  } catch (e) { return errorResponse(e); }
}
