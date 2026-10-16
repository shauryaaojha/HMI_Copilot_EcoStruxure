/**
 * Durable engineering data behind one repository contract. Routes never know
 * whether they are using MongoDB, a laptop directory or an isolated test store.
 * A save compares revisions and writes history in the same transaction; restore
 * is another save, so history never moves backwards or loses its author.
 *
 * Sources are private, permanent binary objects. Temporary anonymous sources
 * and incomplete uploads have explicit expiry checked on every access, with
 * opportunistic cleanup on new uploads. No correctness depends on a warm
 * function, a background timer, or a server's local disk on Vercel.
 */
import path from "node:path";
import type { PersistedProject } from "@/store/persist";
import { hasMongo } from "@/lib/db/mongo";
import { DEFAULT_LIMITS } from "@/lib/ingest/zip";
import { ServerError } from "./errors";
import { FileStorage, MemoryStorage, MongoStorage, validId, type Storage, type Row, type Data } from "./storage";
import { sharesRepo, commentsRepo, putMember, ROLE_RANK, type SharesRepo, type CommentsRepo } from "./repo-collab";
import { latestVersion, liveRepo, type LiveRepo } from "./repo-live";
export * from "./repo-collab";

/** Every collection whose records belong to one project and go when it is deleted. */
const PROJECT_TABLES = ["versions", "members", "shares", "comments", "changes", "heads", "presence", "proposals", "decisions", "agentLocks"];

export interface User { id: string; email?: string | null; name: string; image?: string | null; createdAt?: number }
export type Role = "owner" | "editor" | "commenter" | "viewer";
export type Snapshot = Omit<PersistedProject, "activeScreenId">;
export type Project = Row & { ownerId: string; name: string; target: PersistedProject["target"]; createdAt: number; updatedAt: number; rev: number; headRev?: number; sources?: string[]; sourceId?: string; layout?: "typed" | "struct" };
/** A version without its snapshot: what listings and history trimming read. */
export type VersionInfo = Row & { projectId: string; rev: number; authorId: string; label: string; createdAt: number };
export type Version = VersionInfo & { snapshot: Snapshot };
/** `exportDenied` is set when someone joined through a link that withheld export. */
export type Member = Row & { projectId: string; userId: string; role: Role; addedAt: number; exportDenied?: boolean };
export type Source = Row & { ownerId: string | null; fileName: string; createdAt: number; expiresAt?: number };
export type Upload = Row & { ownerId: string | null; fileName: string; size: number; expiresAt: number; sourceId?: string };
type Part = Row & { uploadId: string; part: number; size: number; data: string };
export const PART_BYTES = 4 * 1024 * 1024;
export const TTL_MS = 24 * 60 * 60 * 1000;
const missing = () => new ServerError(404, "not-found", "Not found");
export { validId };

/** Domain contract shared by routes and isolated collaboration tests. */
export interface Repo {
  users: { upsert(user: User): Promise<User>; get(id: string): Promise<User | null> };
  projects: {
    create(ownerId: string, snapshot: Snapshot, layout?: "typed" | "struct"): Promise<Project>;
    get(id: string): Promise<Project | null>;
    list(userId: string): Promise<Project[]>;
    save(id: string, rev: number, snapshot: Snapshot, authorId: string, label?: string): Promise<Version>;
    delete(id: string): Promise<void>;
  };
  versions: { list(projectId: string): Promise<VersionInfo[]>; get(projectId: string, rev: number): Promise<Version | null>; current(projectId: string): Promise<Version | null>; restore(projectId: string, rev: number, authorId: string): Promise<Version> };
  members: {
    get(projectId: string, userId: string): Promise<Member | null>;
    put(projectId: string, userId: string, role: Role, options?: { exportDenied?: boolean }): Promise<void>;
    list(projectId: string): Promise<Member[]>;
    remove(projectId: string, userId: string): Promise<void>;
  };
  shares: SharesRepo;
  comments: CommentsRepo;
  live: LiveRepo;
  sources: { info(id: string): Promise<Source | null>; put(bytes: Uint8Array, fileName: string, ownerId: string | null, expiresAt?: number): Promise<string>; get(id: string): Promise<{ meta: Source; bytes: Uint8Array } | null> };
  uploads: { create(fileName: string, size: number, ownerId: string | null): Promise<Upload>; get(id: string): Promise<Upload | null>; part(id: string, part: number, bytes: Uint8Array, ownerId: string | null): Promise<void>; complete(id: string, ownerId: string | null): Promise<string>; sweep(): Promise<void> };
}
/** Apply domain invariants inside the storage transaction. */
export class BaseRepo implements Repo {
  constructor(private storage: Storage, private now = () => Date.now()) {}
  private tx<T>(fn: (data: Data) => Promise<T>) { return this.storage.transaction(fn); }
  users: Repo["users"] = {
    upsert: user => this.tx(async d => {
      const old = await d.get<Row & User>("users", user.id);
      const next = { ...user, createdAt: old?.createdAt ?? this.now() };
      await d.put("users", { ...next, _id: user.id });
      return next;
    }),
    get: id => this.tx(async d => { const row = await d.get<Row & User>("users", id); if (!row) return null; const { _id, ...user } = row; void _id; return user; }),
  };
  private async history(d: Data, projectId: string) {
    return d.list<VersionInfo>("versions", { projectId }, { projection: { snapshot: 0 }, sort: { rev: -1 } });
  }
  private async save(d: Data, p: Project, rev: number, snapshot: Snapshot, authorId: string, label: string) {
    const history = await this.history(d, p._id);
    if (p.rev !== rev) {
      const current = await latestVersion(d, p);
      throw new ServerError(409, "conflict", "Changed elsewhere", { rev: p.rev, snapshot: current?.snapshot });
    }
    const next = { ...p, rev: rev + 1, headRev: rev + 1, sources: [...new Set([...(p.sources ?? []), p.sourceId, snapshot.source, snapshot.sourceId].filter((id): id is string => !!id))], name: snapshot.name, target: snapshot.target, sourceId: snapshot.sourceId ?? snapshot.source, layout: snapshot.layout ?? p.layout, updatedAt: this.now() };
    const version: Version = { _id: `${p._id}:${next.rev}`, projectId: p._id, rev: next.rev, authorId, label, createdAt: this.now(), snapshot: { ...snapshot, id: p._id } };
    await d.put("projects", next);
    await d.put("versions", version);
    for (const old of history.slice(49)) await d.remove("versions", old._id);
    return version;
  }
  projects: Repo["projects"] = {
    create: (ownerId, snapshot, layout) => this.tx(async d => {
      if (!validId(snapshot.id)) throw new ServerError(400, "invalid", "Invalid project id");
      if (await d.get("projects", snapshot.id)) throw new ServerError(409, "exists", "Project already exists");
      const p: Project = { _id: snapshot.id, ownerId, name: snapshot.name, target: snapshot.target, createdAt: this.now(), updatedAt: this.now(), rev: 0, ...(layout ? { layout } : {}) };
      await d.put("members", { _id: `${p._id}:${ownerId}`, projectId: p._id, userId: ownerId, role: "owner", addedAt: this.now() });
      await this.save(d, p, 0, snapshot, ownerId, "Created");
      return (await d.get<Project>("projects", p._id))!;
    }),
    get: id => this.tx(d => d.get<Project>("projects", id)),
    list: userId => this.tx(async d => {
      const members = await d.list<Member>("members", { userId });
      const projects: (Project | null)[] = [];
      for (const m of members) projects.push(await d.get<Project>("projects", m.projectId));
      return projects.filter((p): p is Project => !!p).sort((a, b) => b.updatedAt - a.updatedAt);
    }),
    save: (id, rev, snapshot, authorId, label = "Saved") => this.tx(async d => {
      const p = await d.get<Project>("projects", id); if (!p) throw missing();
      return this.save(d, p, rev, snapshot, authorId, label);
    }),
    delete: id => this.tx(async d => {
      await d.remove("projects", id);
      for (const table of PROJECT_TABLES) {
        for (const row of await d.list(table, { projectId: id }, { projection: { _id: 1 } })) await d.remove(table, row._id);
      }
    }),
  };
  versions: Repo["versions"] = {
    list: id => this.tx(d => this.history(d, id)),
    get: (id, rev) => this.tx(d => d.get<Version>("versions", `${id}:${rev}`)),
    current: id => this.tx(async d => {
      const p = await d.get<Project>("projects", id);
      // Live edits (Phase C) move a head ahead of the last saved version.
      return p ? latestVersion(d, p) : null;
    }),
    restore: (id, rev, authorId) => this.tx(async d => {
      const p = await d.get<Project>("projects", id);
      const v = await d.get<Version>("versions", `${id}:${rev}`);
      if (!p || !v) throw missing();
      return this.save(d, p, p.rev, v.snapshot, authorId, `Restored version ${rev}`);
    }),
  };
  members: Repo["members"] = {
    get: (projectId, userId) => this.tx(d => d.get<Member>("members", `${projectId}:${userId}`)),
    put: (projectId, userId, role, options = {}) => this.tx(async d => {
      const p = await d.get<Project>("projects", projectId); if (!p) throw missing();
      await putMember(d, p, userId, role, this.now(), options.exportDenied);
    }),
    list: projectId => this.tx(async d => {
      const members = await d.list<Member>("members", { projectId });
      return members.sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.addedAt - b.addedAt);
    }),
    remove: (projectId, userId) => this.tx(async d => {
      const p = await d.get<Project>("projects", projectId);
      if (!p) throw missing();
      if (p.ownerId === userId) throw new ServerError(400, "owner", "The owner cannot be removed from a project");
      await d.remove("members", `${projectId}:${userId}`);
    }),
  };
  shares = sharesRepo(fn => this.tx(fn), () => this.now());
  comments = commentsRepo(fn => this.tx(fn), () => this.now());
  live = liveRepo(fn => this.tx(fn), () => this.now());
  sources: Repo["sources"] = {
    put: async (bytes, fileName, ownerId, expiresAt) => {
      if (bytes.length > DEFAULT_LIMITS.maxBytes) throw new ServerError(413, "too-large", "File exceeds 100 MB");
      const id = crypto.randomUUID();
      await this.storage.bytes.put(id, bytes);
      try { await this.tx(d => d.put("sources", { _id: id, ownerId, fileName, createdAt: this.now(), ...(expiresAt ? { expiresAt } : {}) })); }
      catch (error) { await this.storage.bytes.remove(id); throw error; }
      return id;
    },
    info: async id => {
      if (!validId(id)) return null;
      const meta = await this.tx(d => d.get<Source>("sources", id));
      return meta && (!meta.expiresAt || meta.expiresAt > this.now()) ? meta : null;
    },
    get: async id => {
      const meta = await this.sources.info(id);
      if (!meta) return null;
      const bytes = await this.storage.bytes.get(id);
      return bytes ? { meta, bytes } : null;
    },
  };
  private async upload(d: Data, id: string, ownerId: string | null) {
    const u = await d.get<Upload>("uploads", id);
    if (!u || u.expiresAt <= this.now()) throw missing();
    if (u.ownerId !== ownerId) throw new ServerError(403, "forbidden", "This upload belongs to another user");
    return u;
  }
  uploads: Repo["uploads"] = {
    create: async (fileName, size, ownerId) => {
      if (!Number.isSafeInteger(size) || size <= 0) throw new ServerError(400, "invalid", "Expected a positive file size");
      if (size > DEFAULT_LIMITS.maxBytes) throw new ServerError(413, "too-large", "File exceeds 100 MB");
      await this.uploads.sweep();
      const u: Upload = { _id: crypto.randomUUID(), fileName, size, ownerId, expiresAt: this.now() + TTL_MS };
      await this.tx(d => d.put("uploads", u)); return u;
    },
    get: id => this.tx(async d => { const u = await d.get<Upload>("uploads", id); return u && u.expiresAt > this.now() ? u : null; }),
    part: (id, part, bytes, ownerId) => this.tx(async d => {
      const u = await this.upload(d, id, ownerId);
      if (u.sourceId) throw new ServerError(409, "complete", "Upload already completed");
      if (!Number.isInteger(part) || part < 0 || part >= u.size) throw new ServerError(400, "invalid", "Invalid part number");
      if (!bytes.length) throw new ServerError(400, "invalid", "Empty upload part");
      if (bytes.length > PART_BYTES) throw new ServerError(413, "too-large", "Part exceeds 4 MB");
      const parts = await d.list<Part>("uploadParts", { uploadId: id });
      const total = parts.filter(p => p.part !== part).reduce((sum, p) => sum + p.size, bytes.length);
      if (total > u.size || total > DEFAULT_LIMITS.maxBytes) throw new ServerError(413, "too-large", "Parts exceed declared file size");
      // Writing the shared upload row serializes competing part transactions,
      // including different part numbers, before either can exceed the cap.
      await d.put("uploads", { ...u, receivedBytes: total });
      await d.put("uploadParts", { _id: `${id}:${part}`, uploadId: id, part, size: bytes.length, data: Buffer.from(bytes).toString("base64") });
    }),
    complete: async (id, ownerId) => {
      const { u, parts } = await this.tx(async d => ({ u: await this.upload(d, id, ownerId), parts: await d.list<Part>("uploadParts", { uploadId: id }) }));
      if (u.sourceId) return u.sourceId;
      parts.sort((a, b) => a.part - b.part);
      if (!parts.length || parts.some((p, i) => p.part !== i) || parts.reduce((sum, p) => sum + p.size, 0) !== u.size) throw new ServerError(400, "incomplete", "Upload is missing parts");
      const bytes = Buffer.concat(parts.sort((a, b) => a.part - b.part).map(p => Buffer.from(p.data, "base64")));
      if (bytes.length !== u.size || bytes.length > DEFAULT_LIMITS.maxBytes) throw new ServerError(413, "too-large", "Upload size mismatch");
      const sourceId = await this.sources.put(bytes, u.fileName, ownerId, ownerId ? undefined : this.now() + TTL_MS);
      const chosen = await this.tx(async d => {
        const current = await this.upload(d, id, ownerId);
        if (current.sourceId) return current.sourceId;
        await d.put("uploads", { ...current, sourceId });
        for (const p of parts) await d.remove("uploadParts", p._id);
        return sourceId;
      });
      if (chosen !== sourceId) { await this.storage.bytes.remove(sourceId); await this.tx(d => d.remove("sources", sourceId)); }
      return chosen;
    },
    sweep: async () => {
      const expired = await this.tx(async d => {
        for (const u of await d.list<Upload>("uploads")) if (u.expiresAt <= this.now()) {
          for (const p of await d.list<Part>("uploadParts", { uploadId: u._id })) await d.remove("uploadParts", p._id);
          await d.remove("uploads", u._id);
        }
        return (await d.list<Source>("sources")).filter(s => s.expiresAt && s.expiresAt <= this.now());
      });
      for (const s of expired) { await this.storage.bytes.remove(s._id); await this.tx(d => d.remove("sources", s._id)); }
    },
  };
}
/** In-memory repository with the same transaction rules as deployment. */
export class MemoryRepo extends BaseRepo { constructor(now?: () => number) { super(new MemoryStorage(), now); } }
/** Durable local repository for an engineer without MongoDB. */
export class FileRepo extends BaseRepo { constructor(root = path.join(process.cwd(), ".data"), now?: () => number) { super(new FileStorage(root), now); } }
/** Shared deployment repository backed by MongoDB transactions. */
export class MongoRepo extends BaseRepo { constructor() { super(new MongoStorage()); } }
let local: Repo | undefined;
let mongo: Repo | undefined;
/** Refuse ephemeral deployment storage rather than silently losing projects. */
export function repo(): Repo {
  if (hasMongo()) return mongo ??= new MongoRepo();
  if (process.env.VERCEL) throw new ServerError(503, "configuration", "MONGODB_URI is required for server storage on Vercel");
  return local ??= new FileRepo();
}
