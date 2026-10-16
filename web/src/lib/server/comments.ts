/**
 * Who may do what to a comment. Reading follows the project: a viewer, even a
 * signed-out one with a link, can read the threads. Writing needs a name and
 * the commenter role or better. A body is edited only by its author; a
 * thread is resolved by any commenter; deleting is the author's, or a
 * manager's when a thread needs tidying.
 *
 * Kept apart from the routes so the matrix is tested without HTTP.
 */
import { accessOf, can } from "./access";
import { ServerError } from "./errors";
import { repo, type Comment, type Repo, type User } from "./repo";

const forbidden = (message: string) => new ServerError(403, "forbidden", message);

/** Threads on a project, with the display names of everyone who wrote in them. */
export async function listComments(user: User | null, projectId: string, tokens: string[] = [], storage: Repo = repo()) {
  if (!await accessOf(user, projectId, storage, tokens)) {
    throw user ? forbidden("You do not have permission for this action") : new ServerError(401, "unauthorized", "Sign in to read comments");
  }
  const comments = await storage.comments.list(projectId);
  const authors: Record<string, string> = {};
  for (const id of new Set(comments.flatMap(c => [c.authorId, c.resolvedBy].filter((x): x is string => !!x)))) {
    authors[id] = (await storage.users.get(id))?.name ?? (id === "local" ? "Local engineer" : "Former member");
  }
  return { comments, authors };
}

/** A comment needs an author: only signed-in commenters and up. */
async function commenter(user: User | null, projectId: string, storage: Repo): Promise<User> {
  if (!user) throw new ServerError(401, "unauthorized", "Sign in to comment");
  if (!await storage.projects.get(projectId)) throw new ServerError(404, "not-found", "Project not found");
  if (!await can(user, projectId, "comment", storage)) throw forbidden("Commenting needs the commenter role or better");
  return user;
}

/** Start a thread or reply to one. */
export async function createComment(user: User | null, projectId: string, draft: Record<string, unknown>, storage: Repo = repo()) {
  const author = await commenter(user, projectId, storage);
  return storage.comments.create(projectId, author.id, {
    body: draft.body,
    screenId: draft.screenId as string | undefined,
    objectId: draft.objectId as string | undefined,
    x: draft.x as number | undefined,
    y: draft.y as number | undefined,
    parentId: draft.parentId as string | undefined,
    proposalId: draft.proposalId as string | undefined,
  });
}

/** Resolve, reopen, or (for the author) reword a comment. */
export async function updateComment(user: User | null, projectId: string, id: string, patch: Record<string, unknown>, storage: Repo = repo()): Promise<Comment> {
  const actor = await commenter(user, projectId, storage);
  const comment = await storage.comments.get(projectId, id);
  if (!comment) throw new ServerError(404, "not-found", "Comment not found");
  if (patch.body !== undefined && comment.authorId !== actor.id) throw forbidden("Only the author can edit a comment");
  if (patch.resolved !== undefined && typeof patch.resolved !== "boolean") throw new ServerError(400, "invalid", "resolved is true or false");
  const resolvedBy = patch.resolved === undefined ? undefined : patch.resolved ? actor.id : null;
  return storage.comments.update(projectId, id, { body: patch.body, resolvedBy });
}

/** Remove a comment (and a thread's replies): the author's call, or a manager's. */
export async function deleteComment(user: User | null, projectId: string, id: string, storage: Repo = repo()) {
  const actor = await commenter(user, projectId, storage);
  const comment = await storage.comments.get(projectId, id);
  if (!comment) throw new ServerError(404, "not-found", "Comment not found");
  if (comment.authorId !== actor.id && !await can(actor, projectId, "manage", storage)) throw forbidden("Only the author or the owner can delete a comment");
  await storage.comments.remove(projectId, id);
}

/**
 * Unresolved threads per screen, for the sign-off report: work still open is
 * part of what a reviewer signs.
 */
export async function unresolvedByScreen(projectId: string, storage: Repo = repo()): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const c of await storage.comments.list(projectId)) {
    if (c.parentId || c.resolvedAt) continue;
    const key = c.screenId ?? "";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
