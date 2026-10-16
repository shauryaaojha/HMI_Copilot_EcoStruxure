/** One comment: resolve or reopen it, reword your own, or delete it. */
import { currentUser } from "@/lib/server/session";
import { deleteComment, updateComment } from "@/lib/server/comments";
import { errorResponse, json, sameOrigin } from "@/lib/server/http";
export const runtime = "nodejs";
type CommentContext = { params: Promise<{ id: string; cid: string }> };

/** Body `{ resolved?: boolean, body?: string }`. */
export async function PATCH(request: Request, context: CommentContext) {
  try {
    const { id, cid } = await context.params;
    const comment = await updateComment(await currentUser(), id, cid, await json(request));
    return Response.json({ comment });
  } catch (e) { return errorResponse(e); }
}

/** Delete a comment; a thread takes its replies with it. */
export async function DELETE(request: Request, context: CommentContext) {
  try {
    sameOrigin(request);
    const { id, cid } = await context.params;
    await deleteComment(await currentUser(), id, cid);
    return Response.json({ deleted: true });
  } catch (e) { return errorResponse(e); }
}
