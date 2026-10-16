/**
 * One role matrix for all project operations, including source-file export.
 * Membership is deliberately separate from identity. A share link adds a
 * second way in: a signed-in visitor becomes a member, and a signed-out one
 * holding a viewer link in the `hmi_share` cookie may read that one project
 * and nothing else. Phase C uses `edit` for collaborative changes.
 * An original source is readable by its uploader or through a permitted project;
 * knowing a permanent file id alone never grants access to customer data.
 */
import { repo, type Repo, type User, type Role } from "./repo";
import { ServerError } from "./errors";
import { cookieShares, hashShareToken, shareTokens } from "./shares";
export type Action = "read" | "comment" | "edit" | "manage" | "export";
const actions: Record<Role, readonly Action[]> = {
  owner: ["read", "comment", "edit", "manage", "export"],
  editor: ["read", "comment", "edit", "export"],
  commenter: ["read", "comment", "export"],
  viewer: ["read", "export"],
};

/** What one person may do on one project, and how they came by it. */
export interface ProjectAccess {
  role: Role;
  actions: Action[];
  via: "member" | "share";
}

/**
 * The effective access to a project: membership first, then any viewer link
 * the request carries. A membership that joined through a link withholding
 * export keeps that restriction; so does a viewer link without export.
 */
export async function accessOf(user: User | null, projectId: string, storage: Repo = repo(), tokens: string[] = []): Promise<ProjectAccess | null> {
  if (!await storage.projects.get(projectId)) return null;
  if (user) {
    const member = await storage.members.get(projectId, user.id);
    if (member) {
      const allowed = actions[member.role].filter(a => a !== "export" || !member.exportDenied);
      return { role: member.role, actions: allowed, via: "member" };
    }
  }
  const shares = await cookieShares(projectId, tokens, storage);
  if (shares.length === 0) return null;
  const exportable = shares.some(s => s.allowExport);
  return { role: "viewer", actions: actions.viewer.filter(a => a !== "export" || exportable), via: "share" };
}

/** Resolve membership (or a viewer link) before allowing an operation on private project data. */
export async function can(user: User | null, projectId: string, action: Action, storage: Repo = repo(), tokens: string[] = []): Promise<boolean> {
  const access = await accessOf(user, projectId, storage, tokens);
  return !!access && access.actions.includes(action);
}

/** Give route callers a consistent missing-identity or permission failure. */
export async function requireAccess(user: User | null, id: string, action: Action, request?: Request) {
  if (!user) throw new ServerError(401, "unauthorized", "Sign in to access projects");
  if (!await repo().projects.get(id)) throw new ServerError(404, "not-found", "Project not found");
  if (!await can(user, id, action, repo(), shareTokens(request))) throw new ServerError(403, "forbidden", "You do not have permission for this action");
  return user;
}

/**
 * The same check for routes a signed-out viewer link may use: reading the
 * project, its comments and its pictures, and exporting when the link allows.
 * Returns the access so the editor can hide what it may not do.
 */
export async function requireReader(user: User | null, id: string, request: Request | undefined, action: "read" | "export" = "read") {
  if (!await repo().projects.get(id)) throw new ServerError(404, "not-found", "Project not found");
  const tokens = shareTokens(request);
  if (!user && tokens.length === 0) throw new ServerError(401, "unauthorized", "Sign in to access projects");
  const access = await accessOf(user, id, repo(), tokens);
  if (!access || !access.actions.includes(action)) {
    if (!user) throw new ServerError(401, "unauthorized", "Sign in to access projects");
    throw new ServerError(403, "forbidden", "You do not have permission for this action");
  }
  return { user, access };
}

/** Authorize source references using small project metadata, never snapshots. */
export async function sourceInfo(id: string, user: User | null, action: "read" | "export" = "read", storage: Repo = repo(), tokens: string[] = []) {
  const source = await storage.sources.info(id);
  if (!source) return null;
  if (source.ownerId === null) return source;
  if (!user) {
    // A viewer link opens the files its own project references, nothing more.
    if (await sourceViaShare(id, action, storage, tokens)) return source;
    throw new ServerError(401, "unauthorized", "Sign in to access this source");
  }
  if (source.ownerId === user.id) return source;
  for (const p of await storage.projects.list(user.id)) {
    if (await can(user, p._id, action, storage)) {
      if (p.sourceId === id || p.sources?.includes(id)) return source;
    }
  }
  throw new ServerError(403, "forbidden", "You do not have access to this source");
}

/** Whether any viewer link in the request belongs to a project that references this source. */
async function sourceViaShare(sourceId: string, action: "read" | "export", storage: Repo, tokens: string[]) {
  for (const token of tokens) {
    const share = await storage.shares.get(hashShareToken(token));
    if (!share) continue;
    const p = await storage.projects.get(share.projectId);
    if (!p || !(p.sourceId === sourceId || p.sources?.includes(sourceId))) continue;
    if (await can(null, p._id, action, storage, [token])) return true;
  }
  return false;
}

/** Authorize metadata before loading potentially large original bytes. */
export async function readSource(id: string, user: User | null, action: "read" | "export" = "read", storage: Repo = repo(), tokens: string[] = []) {
  return await sourceInfo(id, user, action, storage, tokens) ? storage.sources.get(id) : null;
}
