/**
 * One role matrix for all project operations, including source-file export.
 * Membership is deliberately separate from identity. Phase B can add invitations
 * without changing these checks, and Phase C can use edit for collaborative ops.
 * An original source is readable by its uploader or through a permitted project;
 * knowing a permanent file id alone never grants access to customer data.
 */
import { repo, type Repo, type User, type Role } from "./repo";
import { ServerError } from "./errors";
export type Action = "read" | "comment" | "edit" | "manage" | "export";
const actions: Record<Role, readonly Action[]> = {
  owner: ["read", "comment", "edit", "manage", "export"],
  editor: ["read", "comment", "edit", "export"],
  commenter: ["read", "comment", "export"],
  viewer: ["read", "export"],
};
/** Resolve membership before allowing an operation on private project data. */
export async function can(user: User | null, projectId: string, action: Action, storage: Repo = repo()): Promise<boolean> {
  if (!user || !await storage.projects.get(projectId)) return false;
  const member = await storage.members.get(projectId, user.id);
  return !!member && actions[member.role].includes(action);
}
/** Give route callers a consistent missing-identity or permission failure. */
export async function requireAccess(user: User | null, id: string, action: Action) {
  if (!user) throw new ServerError(401, "unauthorized", "Sign in to access projects");
  if (!await repo().projects.get(id)) throw new ServerError(404, "not-found", "Project not found");
  if (!await can(user, id, action)) throw new ServerError(403, "forbidden", "You do not have permission for this action");
  return user;
}
/** Authorize source references using small project metadata, never snapshots. */
export async function sourceInfo(id: string, user: User | null, action: "read" | "export" = "read", storage: Repo = repo()) {
  const source = await storage.sources.info(id);
  if (!source) return null;
  if (source.ownerId === null) return source;
  if (!user) throw new ServerError(401, "unauthorized", "Sign in to access this source");
  if (source.ownerId === user.id) return source;
  for (const p of await storage.projects.list(user.id)) {
    if (await can(user, p._id, action, storage)) {
      if (p.sourceId === id || p.sources?.includes(id)) return source;
    }
  }
  throw new ServerError(403, "forbidden", "You do not have access to this source");
}

/** Authorize metadata before loading potentially large original bytes. */
export async function readSource(id: string, user: User | null, action: "read" | "export" = "read", storage: Repo = repo()) {
  return await sourceInfo(id, user, action, storage) ? storage.sources.get(id) : null;
}
