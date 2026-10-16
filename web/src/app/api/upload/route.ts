/** Start a bounded upload. Anonymous handles expire and never become accounts. */
import { repo } from "@/lib/server/repo";
import { currentUser } from "@/lib/server/session";
import { json, errorResponse } from "@/lib/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const user = await currentUser(); const body = await json(request);
    const fileName = typeof body.fileName === "string" ? body.fileName.replace(/^.*[\\/]/, "").slice(0, 255) : "project.eote";
    const upload = await repo().uploads.create(fileName, body.size as number, user?.id ?? null);
    return Response.json({ uploadId: upload._id }, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
