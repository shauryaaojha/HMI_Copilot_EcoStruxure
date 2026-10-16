/**
 * The collections collaboration added to the repository: share links and
 * comments (Phase B). They run inside the same storage transactions as
 * projects and members, through the factories below, so MongoRepo, FileRepo
 * and MemoryRepo all gain them without a second implementation each.
 *
 * Domain rules live here rather than in routes: a link is stored only as the
 * hash of its token, joining by link never lowers an existing role, and a
 * reply is one level deep and sits where its thread sits on the canvas.
 */
import { ServerError } from "./errors";
import { validId, type Data, type Row } from "./storage";
import type { Member, Project, Role } from "./repo";

/** Run one function inside a storage transaction, as BaseRepo does. */
export type Tx = <T>(fn: (data: Data) => Promise<T>) => Promise<T>;
/** The repository's clock, injectable so expiry can be tested. */
export type Clock = () => number;

/** The roles a share link can hand out. Ownership is never shared by link. */
export type ShareRole = Exclude<Role, "owner">;
export const SHARE_ROLES: readonly ShareRole[] = ["viewer", "commenter", "editor"];

/**
 * A share link. `_id` is the SHA-256 of the token, never the token itself, so
 * a copy of the database is not a set of working invitations.
 */
export type Share = Row & {
  projectId: string;
  role: ShareRole;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  allowExport: boolean;
  revokedAt?: number;
};

/**
 * A comment pinned to a project, and optionally to a screen, an object and a
 * point on the canvas. Replies carry `parentId`, one level deep.
 */
export type Comment = Row & {
  projectId: string;
  screenId?: string;
  objectId?: string;
  x?: number;
  y?: number;
  authorId: string;
  body: string;
  createdAt: number;
  editedAt?: number;
  resolvedAt?: number;
  resolvedBy?: string;
  parentId?: string;
  /** Set when the thread discusses a Copilot proposal (Phase D). */
  proposalId?: string;
};

/** What a new comment may say; the repository fills in identity and time. */
export type CommentDraft = Partial<Pick<Comment, "screenId" | "objectId" | "x" | "y" | "parentId" | "proposalId">> & { body: unknown };

/** Lower ranks are weaker; joining by link never moves someone down this list. */
export const ROLE_RANK: Record<Role, number> = { viewer: 0, commenter: 1, editor: 2, owner: 3 };

/** Long enough for a review note, short enough that a thread stays readable. */
export const COMMENT_MAX = 4000;

/** What creating a link needs; `Omit` would collapse over Row's index signature. */
export interface ShareInput { _id: string; projectId: string; role: ShareRole; createdBy: string; days: number; allowExport: boolean }

export interface SharesRepo {
  create(share: ShareInput): Promise<Share>;
  get(id: string): Promise<Share | null>;
  /** A link and whether it can be used now, judged by the repository's own clock. */
  check(id: string): Promise<{ state: "ok" | "missing" | "revoked" | "expired"; share: Share | null }>;
  list(projectId: string): Promise<Share[]>;
  revoke(projectId: string, id: string): Promise<Share>;
  /** Validate the link and add its holder as a member, never downgrading them. */
  join(id: string, userId: string): Promise<{ projectId: string; role: Role }>;
}

export interface CommentsRepo {
  list(projectId: string): Promise<Comment[]>;
  get(projectId: string, id: string): Promise<Comment | null>;
  create(projectId: string, authorId: string, draft: CommentDraft): Promise<Comment>;
  /** `resolvedBy: null` reopens a thread; a string resolves it as that user. */
  update(projectId: string, id: string, patch: { body?: unknown; resolvedBy?: string | null }): Promise<Comment>;
  remove(projectId: string, id: string): Promise<void>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const missing = () => new ServerError(404, "not-found", "Not found");

/**
 * The one place a membership is written, so the single-owner rule and the
 * original join date survive every route that changes a role.
 */
export async function putMember(d: Data, p: Project, userId: string, role: Role, now: number, exportDenied?: boolean) {
  if ((p.ownerId === userId) !== (role === "owner")) throw new ServerError(400, "owner", "A project has one owner");
  const old = await d.get<Member>("members", `${p._id}:${userId}`);
  const member: Member = { _id: `${p._id}:${userId}`, projectId: p._id, userId, role, addedAt: old?.addedAt ?? now };
  if (exportDenied) member.exportDenied = true;
  await d.put("members", member);
}

/**
 * Whether a stored link can still be used, and if not, why. Returned rather
 * than thrown so the /s/<token> page can say "expired" or "revoked" plainly.
 */
export function shareState(share: Share | null, now: number): "ok" | "missing" | "revoked" | "expired" {
  if (!share) return "missing";
  if (share.revokedAt) return "revoked";
  if (share.expiresAt <= now) return "expired";
  return "ok";
}

/** A link that cannot be used, as the HTTP failure a route returns. */
function unusable(state: "missing" | "revoked" | "expired"): ServerError {
  if (state === "revoked") return new ServerError(410, "revoked", "This link has been revoked");
  if (state === "expired") return new ServerError(410, "expired", "This link has expired");
  return new ServerError(404, "not-found", "This link does not exist");
}

/** Share links, bound to the repository's transaction and clock. */
export function sharesRepo(tx: Tx, now: Clock): SharesRepo {
  return {
    create: share => tx(async d => {
      if (!validId(share._id)) throw new ServerError(400, "invalid", "Invalid share id");
      if (!SHARE_ROLES.includes(share.role)) throw new ServerError(400, "invalid", "A link grants viewer, commenter or editor");
      if (!await d.get<Project>("projects", share.projectId)) throw missing();
      const { days, ...rest } = share;
      const row: Share = { ...rest, createdAt: now(), expiresAt: now() + days * DAY_MS };
      await d.put("shares", row);
      return row;
    }),
    get: id => tx(async d => {
      if (!validId(id)) return null;
      return d.get<Share>("shares", id);
    }),
    check: id => tx(async d => {
      const share = validId(id) ? await d.get<Share>("shares", id) : null;
      return { state: shareState(share, now()), share };
    }),
    list: projectId => tx(async d => {
      const shares = await d.list<Share>("shares", { projectId });
      return shares.sort((a, b) => b.createdAt - a.createdAt);
    }),
    revoke: (projectId, id) => tx(async d => {
      const share = validId(id) ? await d.get<Share>("shares", id) : null;
      if (!share || share.projectId !== projectId) throw missing();
      const revoked: Share = { ...share, revokedAt: share.revokedAt ?? now() };
      await d.put("shares", revoked);
      return revoked;
    }),
    join: (id, userId) => tx(async d => {
      const share = validId(id) ? await d.get<Share>("shares", id) : null;
      const state = shareState(share, now());
      if (state !== "ok" || !share) throw unusable(state === "ok" ? "missing" : state);
      const p = await d.get<Project>("projects", share.projectId);
      if (!p) throw missing();
      const old = await d.get<Member>("members", `${p._id}:${userId}`);
      if (old && ROLE_RANK[old.role] > ROLE_RANK[share.role]) return { projectId: p._id, role: old.role };
      if (old && old.role === share.role) {
        // The same role again: a link that allows export lifts an earlier
        // denial, and one that does not never takes export away.
        if (old.exportDenied && share.allowExport) await putMember(d, p, userId, old.role, now(), false);
        return { projectId: p._id, role: old.role };
      }
      await putMember(d, p, userId, share.role, now(), !share.allowExport);
      return { projectId: p._id, role: share.role };
    }),
  };
}

/** Plain text, trimmed, never empty and never longer than COMMENT_MAX. */
function commentBody(value: unknown): string {
  if (typeof value !== "string") throw new ServerError(400, "invalid", "A comment needs a body");
  const body = value.trim();
  if (!body) throw new ServerError(400, "invalid", "A comment cannot be empty");
  if (body.length > COMMENT_MAX) throw new ServerError(400, "too-large", `A comment is at most ${COMMENT_MAX} characters`);
  return body;
}

/** Copy where a new top-level comment is pinned, refusing anything malformed. */
function pinInto(comment: Comment, draft: CommentDraft) {
  for (const key of ["screenId", "objectId", "proposalId"] as const) {
    const value = draft[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || !validId(value)) throw new ServerError(400, "invalid", `Invalid ${key}`);
    comment[key] = value;
  }
  for (const key of ["x", "y"] as const) {
    const value = draft[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new ServerError(400, "invalid", `Invalid ${key}`);
    comment[key] = value;
  }
}

/** Comments and their one level of replies, bound to the repository's transaction and clock. */
export function commentsRepo(tx: Tx, now: Clock): CommentsRepo {
  const find = async (d: Data, projectId: string, id: string) => {
    const comment = validId(id) ? await d.get<Comment>("comments", id) : null;
    return comment && comment.projectId === projectId ? comment : null;
  };
  return {
    list: projectId => tx(async d => {
      const comments = await d.list<Comment>("comments", { projectId });
      return comments.sort((a, b) => a.createdAt - b.createdAt);
    }),
    get: (projectId, id) => tx(d => find(d, projectId, id)),
    create: (projectId, authorId, draft) => tx(async d => {
      if (!await d.get<Project>("projects", projectId)) throw missing();
      const comment: Comment = { _id: crypto.randomUUID(), projectId, authorId, body: commentBody(draft.body), createdAt: now() };
      if (draft.parentId !== undefined && draft.parentId !== null) {
        const parent = typeof draft.parentId === "string" ? await find(d, projectId, draft.parentId) : null;
        if (!parent) throw new ServerError(404, "not-found", "The comment being replied to does not exist");
        if (parent.parentId) throw new ServerError(400, "invalid", "Replies are one level deep: reply to the thread instead");
        // A reply belongs where its thread is pinned, not somewhere new.
        comment.parentId = parent._id;
        for (const key of ["screenId", "objectId", "x", "y", "proposalId"] as const) {
          if (parent[key] !== undefined) Object.assign(comment, { [key]: parent[key] });
        }
      } else {
        pinInto(comment, draft);
      }
      await d.put("comments", comment);
      return comment;
    }),
    update: (projectId, id, patch) => tx(async d => {
      const comment = await find(d, projectId, id);
      if (!comment) throw missing();
      const next: Comment = { ...comment };
      if (patch.body !== undefined) {
        next.body = commentBody(patch.body);
        next.editedAt = now();
      }
      if (patch.resolvedBy === null) {
        delete next.resolvedAt;
        delete next.resolvedBy;
      } else if (patch.resolvedBy !== undefined) {
        next.resolvedAt = now();
        next.resolvedBy = patch.resolvedBy;
      }
      await d.put("comments", next);
      return next;
    }),
    remove: (projectId, id) => tx(async d => {
      const comment = await find(d, projectId, id);
      if (!comment) throw missing();
      // Deleting a thread takes its replies with it; a reply goes alone.
      const replies = await d.list<Comment>("comments", { projectId, parentId: id });
      for (const reply of replies) await d.remove("comments", reply._id);
      await d.remove("comments", id);
    }),
  };
}
