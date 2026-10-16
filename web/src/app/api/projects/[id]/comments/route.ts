/** Comment threads on a project: everyone who can read sees them; commenters write them. */
import { currentUser } from "@/lib/server/session";
import { createComment, listComments } from "@/lib/server/comments";
import { shareTokens } from "@/lib/server/shares";
import { errorResponse, json, type Context } from "@/lib/server/http";
export const runtime = "nodejs";

/** Every comment on the project, oldest first, with author names. */
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const result = await listComments(await currentUser(), id, shareTokens(request));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}

/** Body `{ screenId?, objectId?, x?, y?, body, parentId? }`. */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const comment = await createComment(await currentUser(), id, await json(request));
    return Response.json({ comment }, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
