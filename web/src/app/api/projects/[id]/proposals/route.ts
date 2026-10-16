/**
 * The Copilot's proposals for a shared project. Every member may read them;
 * an editor's chat edit is turned into one here, by a dry run on the server
 * snapshot, and broadcast on the project stream.
 */
import { repo } from "@/lib/server/repo";
import { requireReader } from "@/lib/server/access";
import { currentUser } from "@/lib/server/session";
import { proposeEdit } from "@/lib/server/proposals";
import { errorResponse, json, type Context } from "@/lib/server/http";
export const runtime = "nodejs";

/** Every proposal on the project, newest first. */
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    await requireReader(await currentUser(), id, request);
    return Response.json({ proposals: await repo().proposals.list(id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}

/** Body `{ screenId?, request, ops }`: the ops the chat model chose. */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const proposal = await proposeEdit(await currentUser(), id, await json(request));
    return Response.json({ proposal }, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
