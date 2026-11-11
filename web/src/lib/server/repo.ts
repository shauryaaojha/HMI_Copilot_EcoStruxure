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
import { randomBytes } from "node:crypto";
import type { PersistedProject } from "@/store/persist";
import { hasMongo } from "@/lib/db/mongo";
import { ServerError } from "./errors";
import { quotas, refuseBytes, refuseCount } from "./quotas";
import { FileStorage, MemoryStorage, MongoStorage, asBytes, validId, type Storage, type Row, type Data } from "./storage";
import { OBJECTS, loadStored, sweepObjects, writeSnapshot, type Manifest } from "./snapshots";
import { sharesRepo, commentsRepo, putMember, ROLE_RANK, type SharesRepo, type CommentsRepo } from "./repo-collab";
import { latestVersion, liveRepo, type LiveRepo } from "./repo-live";
import { locksRepo, proposalsRepo, type LocksRepo, type ProposalsRepo } from "./repo-agent";
import { jobsRepo, type JobsRepo } from "./repo-jobs";
import { connectorRepo, type ConnectorRepo } from "./repo-connector";
import { gapsRepo, type GapsRepo } from "./repo-gaps";
export * from "./repo-collab";
export * from "./repo-agent";
export * from "./repo-jobs";
export * from "./repo-connector";
export * from "./repo-gaps";

/** Every collection whose records belong to one project and go when it is deleted. */
const PROJECT_TABLES = ["versions", "members", "shares", "comments", "changes", "heads", "presence", "proposals", "decisions", "agentLocks", "generationJobs", OBJECTS];
/** Versions kept per project; older ones are trimmed on the next save. */
export const HISTORY_LIMIT = 50;
/** What listings read from a version row: everything but the snapshot and its manifest. */
export const VERSION_INFO = { snapshot: 0, manifest: 0 } as const;

export interface User { id: string; email?: string | null; name: string; image?: string | null; createdAt?: number; sessionVersion?: number }
/**
 * What creating an account needs. `emailKey` is the address folded to one
 * canonical form so that two spellings of the same mailbox cannot both sign
 * up; `email` is kept as the engineer typed it, because that is how they will
 * read it back. Callers hash the password - the repository stores hashes and
 * never sees one in the clear.
 */
export interface NewUser { email: string; emailKey: string; passwordHash: string; name: string }
/**
 * A user together with the one secret the repository holds for them. Asking
 * for this is deliberately separate from reading a profile, so that a route
 * that wants a name cannot accidentally serve a password hash.
 */
export interface Credential { user: User; passwordHash: string }
/** A fixed-window attempt counter; see lib/server/rate-limit.ts for the windows. */
export type Attempt = Row & { count: number; resetAt: number };
/**
 * Account ids are `user:` and twelve random bytes - the shape and length of a
 * Mongo ObjectId, but minted here so the laptop store and the test store issue
 * the same ids as a deployment. Ids are opaque everywhere they are compared
 * (`ownerId`, `members.userId`), and nothing parses them.
 */
export const newUserId = () => `user:${randomBytes(12).toString("hex")}`;
export type Role = "owner" | "editor" | "commenter" | "viewer";
export type Snapshot = Omit<PersistedProject, "activeScreenId">;
/**
 * What a connector - the MCP server, on claude.ai's behalf - may do to one
 * project without a human in the loop. Absent is both the default and the
 * safe answer: an AI change arrives as a proposal an editor accepts, which is
 * what puts a named human decision in the sign-off log. One project at a time
 * can be opted out of that, for the engineer working alone on a sample.
 */
export type ConnectorSettings = { directWrites: boolean };
export type Project = Row & { ownerId: string; name: string; target: PersistedProject["target"]; createdAt: number; updatedAt: number; rev: number; headRev?: number; sources?: string[]; sourceId?: string; layout?: "typed" | "struct"; connector?: ConnectorSettings; checkpointAt?: number };
/** A version without its snapshot: what listings and history trimming read. */
export type VersionInfo = Row & { projectId: string; rev: number; authorId: string; label: string; createdAt: number };
export type Version = VersionInfo & { snapshot: Snapshot };
/** A version as stored: a manifest of pieces since v2, a whole snapshot before (docs/DATABASE_V2.md). */
export type StoredVersion = VersionInfo & { manifest?: Manifest; snapshot?: Snapshot };
/** `exportDenied` is set when someone joined through a link that withheld export. */
export type Member = Row & { projectId: string; userId: string; role: Role; addedAt: number; exportDenied?: boolean };
export type Source = Row & { ownerId: string | null; fileName: string; size?: number; createdAt: number; expiresAt?: number };
export type Upload = Row & { ownerId: string | null; fileName: string; size: number; expiresAt: number; sourceId?: string };
/** `data` is bytes since v2; base64 text in parts written before it. */
type Part = Row & { uploadId: string; part: number; size: number; data: Uint8Array | string; expiresAt?: number };
export const PART_BYTES = 4 * 1024 * 1024;
export const TTL_MS = 24 * 60 * 60 * 1000;
/** Expired rows one upload tidies away. */
const SWEEP_PAGE = 50;
const missing = () => new ServerError(404, "not-found", "Not found");
/**
 * One address, one account - and one refusal, which deliberately does not
 * confirm that the address is registered here. See lib/server/credentials.ts
 * for why that is the best this can do without a confirmation email.
 */
const taken = () => new ServerError(409, "unavailable", "That email cannot be used for a new account. If the account is yours, sign in instead.");
/** The stored user row. The password hash lives here and nowhere else. */
type UserRow = Row & User & { emailKey?: string; passwordHash?: string };
/**
 * What a user looks like outside the repository. The hash and the lookup key
 * are dropped here, in the one place every read goes through, rather than left
 * to each caller to remember - a route that forgets would serve the hash.
 */
/**
 * The implicit identity on a laptop with no sign-in (session.ts), which a
 * deployment can never have. One engineer on their own machine is not who the
 * account quotas are for, and an installation can hold more than ten projects.
 */
const LOCAL_ENGINEER = "local";

function profile(row: UserRow): User {
  const { _id, emailKey, passwordHash, ...user } = row;
  void _id; void emailKey; void passwordHash;
  return user;
}
export { validId };

/** Domain contract shared by routes and isolated collaboration tests. */
export interface Repo {
  users: {
    upsert(user: User): Promise<User>;
    get(id: string): Promise<User | null>;
    create(user: NewUser): Promise<User>;
    credential(emailKey: string): Promise<Credential | null>;
    sessionValid(id: string, version: number, sid: string): Promise<boolean>;
    revokeSession(id: string, sid: string, expiresAt: number): Promise<void>;
    bumpSessionVersion(id: string): Promise<number>;
    replacePassword(id: string, passwordHash: string): Promise<void>;
    deleteAccount(id: string): Promise<{ retainedSources: string[] }>;
    issueReset(emailKey: string, tokenHash: string, expiresAt: number): Promise<boolean>;
    consumeReset(tokenHash: string, passwordHash: string): Promise<string | null>;
  };
  attempts: { hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>; clear(key: string): Promise<void> };
  projects: {
    create(ownerId: string, snapshot: Snapshot, layout?: "typed" | "struct"): Promise<Project>;
    get(id: string): Promise<Project | null>;
    list(userId: string): Promise<Project[]>;
    owned(userId: string): Promise<Project[]>;
    /** The projects that refer to a stored source, whoever their members are. */
    referencing(sourceId: string): Promise<Project[]>;
    /** A project and one user's membership of it, in one read: what every access check needs. */
    access(projectId: string, userId: string | null): Promise<{ project: Project; member: Member | null } | null>;
    save(id: string, rev: number, snapshot: Snapshot, authorId: string, label?: string): Promise<Version>;
    /** Connector settings, which are project metadata and not part of the synced document. */
    connector(id: string, settings: ConnectorSettings): Promise<Project>;
    delete(id: string, soleMemberOwnerId?: string): Promise<void>;
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
  /** Registered clients, consents and bearer tokens; see lib/server/repo-connector.ts. */
  connector: ConnectorRepo;
  live: LiveRepo;
  proposals: ProposalsRepo;
  locks: LocksRepo;
  jobs: JobsRepo;
  /** What the product could not do when asked; see lib/server/repo-gaps.ts. */
  gaps: GapsRepo;
  sources: { info(id: string): Promise<Source | null>; put(bytes: Uint8Array, fileName: string, ownerId: string | null, expiresAt?: number, creditUploadId?: string): Promise<string>; get(id: string): Promise<{ meta: Source; bytes: Uint8Array } | null>; remove(id: string): Promise<void> };
  uploads: { create(fileName: string, size: number, ownerId: string | null): Promise<Upload>; get(id: string): Promise<Upload | null>; part(id: string, part: number, bytes: Uint8Array, ownerId: string | null): Promise<void>; complete(id: string, ownerId: string | null): Promise<string>; sweep(): Promise<void>; removeOwned(ownerId: string): Promise<void> };
}
/** Apply domain invariants inside the storage transaction. */
export class BaseRepo implements Repo {
  constructor(private storage: Storage, private now = () => Date.now()) {}
  private tx<T>(fn: (data: Data) => Promise<T>) { return this.storage.transaction(fn); }
  /**
   * A read with no transaction (Storage.read). The one thing a transaction
   * gave a read for free is a consistent view across queries; the case where
   * that matters is a snapshot whose pieces a concurrent sweep removed between
   * reading the manifest and reading the pieces. That read is retried once in
   * a transaction, which cannot see it torn.
   */
  private async read<T>(fn: (data: Data) => Promise<T>): Promise<T> {
    if (!this.storage.read) return this.tx(fn);
    try { return await this.storage.read(fn); }
    catch (error) {
      if (error instanceof ServerError && error.code === "corrupt") return this.tx(fn);
      throw error;
    }
  }
  private async storedBytes(d: Data, ownerId: string): Promise<number> {
    let total = 0;
    for (const source of await d.list<Source>("sources", { ownerId })) {
      if (source.size !== undefined) { total += source.size; continue; }
      // Rows written before quotas have no size. Read their bytes rather than
      // undercounting an existing account, and backfill on the next write.
      const bytes = await this.storage.bytes.get(source._id);
      if (!bytes) throw new ServerError(500, "storage", `Could not measure stored source ${source.fileName}`);
      total += bytes.length;
      await d.put("sources", { ...source, size: bytes.length });
    }
    return total;
  }
  users: Repo["users"] = {
    upsert: user => this.tx(async d => {
      const old = await d.get<UserRow>("users", user.id);
      const next = { ...user, createdAt: old?.createdAt ?? this.now() };
      // An upsert carries a profile, never a credential, so whatever the row
      // already holds about signing in survives a change of name or picture.
      await d.put("users", { ...old, ...next, _id: user.id });
      return next;
    }),
    get: id => this.read(async d => { const row = await d.get<UserRow>("users", id); return row ? profile(row) : null; }),
    create: user => this.tx(async d => {
      // Checked inside the transaction, and backed by a unique index on
      // `emailKey` in MongoStorage: the check alone would let two concurrent
      // sign-ups past, and the index alone would not work on the laptop store.
      if ((await d.list<UserRow>("users", { emailKey: user.emailKey }, { projection: { _id: 1 }, limit: 1 })).length) throw taken();
      const id = newUserId();
      const row: UserRow = { ...user, _id: id, id, createdAt: this.now() };
      try { await d.put("users", row); }
      catch (error) {
        // The loser of that race hears it from the index instead, and must be
        // told the same thing - not a storage failure.
        if ((error as { code?: number }).code === 11000) throw taken();
        throw error;
      }
      return profile(row);
    }),
    credential: emailKey => this.read(async d => {
      const [row] = await d.list<UserRow>("users", { emailKey }, { limit: 1 });
      return row?.passwordHash ? { user: profile(row), passwordHash: row.passwordHash } : null;
    }),
    sessionValid: (id, version, sid) => this.read(async d => {
      const [user, revoked] = await Promise.all([d.get<UserRow>("users", id), d.get("revokedSessions", sid)]);
      return !!user && (user.sessionVersion ?? 0) <= version && !revoked;
    }),
    revokeSession: (id, sid, expiresAt) => this.tx(async d => {
      await d.put("revokedSessions", { _id: sid, userId: id, expiresAt });
    }),
    bumpSessionVersion: id => this.tx(async d => {
      const user = await d.get<UserRow>("users", id);
      if (!user) throw missing();
      const version = (user.sessionVersion ?? 0) + 1;
      await d.put("users", { ...user, sessionVersion: version });
      return version;
    }),
    replacePassword: (id, passwordHash) => this.tx(async d => {
      const user = await d.get<UserRow>("users", id);
      if (!user) throw missing();
      await d.put("users", { ...user, passwordHash, sessionVersion: (user.sessionVersion ?? 0) + 1 });
      for (const table of ["connectorGrants", "connectorTokens", "oauthCodes"]) {
        await d.removeMany(table, (await d.list(table, { userId: id }, { projection: { _id: 1 } })).map(row => row._id));
      }
    }),
    deleteAccount: async id => {
      const owned = await this.projects.owned(id);
      const shared: string[] = [];
      for (const project of owned) if ((await this.members.list(project._id)).some(member => member.userId !== id)) shared.push(project.name);
      if (shared.length) throw new ServerError(409, "shared-projects", `Remove members or transfer ownership first: ${shared.join(", ")}`, { projects: shared });
      const step = async (name: string, action: () => Promise<unknown>) => {
        try { await action(); }
        catch (error) {
          if (error instanceof ServerError && error.code === "shared-projects") throw error;
          throw new ServerError(500, "cleanup-failed", `Could not remove ${name}. The account remains so you can retry.`, { item: name });
        }
      };
      for (const project of owned) await step(`project ${project.name}`, () => this.projects.delete(project._id, id));
      for (const project of await this.projects.list(id)) await step(`membership in ${project.name}`, () => this.members.remove(project._id, id));
      await step("uploads", () => this.uploads.removeOwned(id));
      const sources = await this.read(d => d.list<Source>("sources", { ownerId: id }));
      const retainedSources: string[] = [];
      for (const source of sources) {
        const referencing = await this.projects.referencing(source._id);
        if (referencing.length) { retainedSources.push(`${source.fileName} (used by ${referencing.map(p => p.name).join(", ")})`); continue; }
        await step(`source ${source.fileName}`, () => this.sources.remove(source._id));
      }
      await step("connector access, sessions and account", () => this.tx(async d => {
        for (const table of ["connectorGrants", "connectorTokens", "oauthCodes", "revokedSessions", "passwordResets"]) {
          await d.removeMany(table, (await d.list(table, { userId: id }, { projection: { _id: 1 } })).map(row => row._id));
        }
        await d.remove("users", id);
      }));
      return { retainedSources };
    },
    issueReset: (emailKey, tokenHash, expiresAt) => this.tx(async d => {
      const [user] = await d.list<UserRow>("users", { emailKey }, { limit: 1 });
      if (!user) return false;
      await d.removeMany("passwordResets", (await d.list("passwordResets", { userId: user.id }, { projection: { _id: 1 } })).map(row => row._id));
      await d.put("passwordResets", { _id: tokenHash, userId: user.id, expiresAt });
      return true;
    }),
    consumeReset: (tokenHash, passwordHash) => this.tx(async d => {
      const reset = await d.get<Row & { userId: string; expiresAt: number }>("passwordResets", tokenHash);
      if (!reset || reset.expiresAt <= this.now()) return null;
      const user = await d.get<UserRow>("users", reset.userId);
      if (!user) return null;
      await d.remove("passwordResets", tokenHash);
      await d.put("users", { ...user, passwordHash, sessionVersion: (user.sessionVersion ?? 0) + 1 });
      for (const table of ["connectorGrants", "connectorTokens", "oauthCodes"]) {
        await d.removeMany(table, (await d.list(table, { userId: user.id }, { projection: { _id: 1 } })).map(row => row._id));
      }
      return user.id;
    }),
  };
  /** Fixed-window attempt counters. The policy - which key, how many, how long - is lib/server/rate-limit.ts. */
  attempts: Repo["attempts"] = {
    hit: (key, windowMs) => this.tx(async d => {
      const now = this.now();
      const row = await d.get<Attempt>("signInAttempts", key);
      const next: Attempt = !row || row.resetAt <= now ? { _id: key, count: 1, resetAt: now + windowMs } : { ...row, count: row.count + 1 };
      await d.put("signInAttempts", next);
      // A counter whose window has passed is never read again, so an attempt
      // is also when the table is tidied. Bounded, so one sign-in stays cheap
      // and a long-idle instance catches up over the next few attempts.
      for (const stale of await d.list<Row>("signInAttempts", { resetAt: { $lte: now } }, { projection: { _id: 1 }, limit: 50 })) await d.remove("signInAttempts", stale._id);
      return { count: next.count, resetAt: next.resetAt };
    }),
    clear: key => this.tx(d => d.remove("signInAttempts", key)),
  };
  private async history(d: Data, projectId: string) {
    return d.list<VersionInfo>("versions", { projectId }, { projection: VERSION_INFO, sort: { rev: -1 } });
  }
  private async save(d: Data, p: Project, rev: number, snapshot: Snapshot, authorId: string, label: string) {
    const history = await this.history(d, p._id);
    if (p.rev !== rev) {
      const current = await latestVersion(d, p);
      throw new ServerError(409, "conflict", "Changed elsewhere", { rev: p.rev, snapshot: current?.snapshot });
    }
    const next = { ...p, rev: rev + 1, headRev: rev + 1, sources: [...new Set([...(p.sources ?? []), p.sourceId, snapshot.source, snapshot.sourceId].filter((id): id is string => !!id))], name: snapshot.name, target: snapshot.target, sourceId: snapshot.sourceId ?? snapshot.source, layout: snapshot.layout ?? p.layout, updatedAt: this.now(), checkpointAt: this.now() };
    const stored = { ...snapshot, id: p._id };
    const info: VersionInfo = { _id: `${p._id}:${next.rev}`, projectId: p._id, rev: next.rev, authorId, label, createdAt: this.now() };
    const manifest = await writeSnapshot(d, p._id, stored, this.now());
    await d.put("projects", next);
    await d.put("versions", { ...info, manifest });
    const trimmed = history.slice(HISTORY_LIMIT - 1).map(old => old._id);
    await d.removeMany("versions", trimmed);
    // Pieces only become garbage when a version is trimmed or a live head is
    // superseded; a plain save keeps everything the previous version held.
    // The save has just written the project row, which is what makes the
    // sweep safe against a concurrent writer (lib/server/snapshots.ts).
    const head = await d.get<Row & { rev: number }>("heads", p._id);
    if (trimmed.length || (head && head.rev < next.rev)) {
      if (head && head.rev < next.rev) await d.remove("heads", p._id);
      await sweepObjects(d, p._id);
    }
    return { ...info, snapshot: stored } as Version;
  }
  projects: Repo["projects"] = {
    create: (ownerId, snapshot, layout) => this.tx(async d => {
      if (!validId(snapshot.id)) throw new ServerError(400, "invalid", "Invalid project id");
      if (await d.get("projects", snapshot.id)) throw new ServerError(409, "exists", "Project already exists");
      const limit = quotas().projects;
      if (ownerId !== LOCAL_ENGINEER && (await d.list("projects", { ownerId }, { projection: { _id: 1 }, limit })).length >= limit) refuseCount("Projects per account", limit);
      const p: Project = { _id: snapshot.id, ownerId, name: snapshot.name, target: snapshot.target, createdAt: this.now(), updatedAt: this.now(), rev: 0, ...(layout ? { layout } : {}) };
      await d.put("members", { _id: `${p._id}:${ownerId}`, projectId: p._id, userId: ownerId, role: "owner", addedAt: this.now() });
      await this.save(d, p, 0, snapshot, ownerId, "Created");
      return (await d.get<Project>("projects", p._id))!;
    }),
    get: id => this.read(d => d.get<Project>("projects", id)),
    access: (projectId, userId) => this.read(async d => {
      // Both lookups at once: outside a transaction Mongo runs them in parallel.
      const [project, member] = await Promise.all([
        d.get<Project>("projects", projectId),
        userId ? d.get<Member>("members", `${projectId}:${userId}`) : Promise.resolve(null),
      ]);
      return project ? { project, member } : null;
    }),
    list: userId => this.read(async d => {
      const members = await d.list<Member>("members", { userId }, { projection: { projectId: 1 } });
      if (!members.length) return [];
      // One query for every project, not one per membership.
      const projects = await d.list<Project>("projects", { _id: { $in: members.map(m => m.projectId) } });
      return projects.sort((a, b) => b.updatedAt - a.updatedAt);
    }),
    owned: userId => this.read(d => d.list<Project>("projects", { ownerId: userId })),
    referencing: sourceId => this.read(async d => {
      const [listed, primary] = await Promise.all([d.list<Project>("projects", { sources: sourceId }), d.list<Project>("projects", { sourceId })]);
      return [...new Map([...listed, ...primary].map(p => [p._id, p])).values()];
    }),
    save: (id, rev, snapshot, authorId, label = "Saved") => this.tx(async d => {
      const p = await d.get<Project>("projects", id); if (!p) throw missing();
      return this.save(d, p, rev, snapshot, authorId, label);
    }),
    connector: (id, settings) => this.tx(async d => {
      const p = await d.get<Project>("projects", id); if (!p) throw missing();
      // Not a revision-bearing change: the setting says who may write, not
      // what the project contains, so it does not belong in history and must
      // not make a concurrent editor's save conflict.
      const next: Project = { ...p, connector: { directWrites: !!settings.directWrites } };
      await d.put("projects", next);
      return next;
    }),
    delete: (id, soleMemberOwnerId) => this.tx(async d => {
      if (soleMemberOwnerId) {
        const project = await d.get<Project>("projects", id);
        const members = await d.list<Member>("members", { projectId: id });
        if (project?.ownerId !== soleMemberOwnerId || members.some(member => member.userId !== soleMemberOwnerId)) {
          throw new ServerError(409, "shared-projects", `Remove members or transfer ownership first: ${project?.name ?? id}`);
        }
      }
      await d.remove("projects", id);
      for (const table of PROJECT_TABLES) {
        await d.removeMany(table, (await d.list(table, { projectId: id }, { projection: { _id: 1 } })).map(row => row._id));
      }
    }),
  };
  versions: Repo["versions"] = {
    list: id => this.read(d => this.history(d, id)),
    get: (id, rev) => this.read(async d => {
      const row = await d.get<StoredVersion>("versions", `${id}:${rev}`);
      if (!row) return null;
      const { manifest, snapshot, ...info } = row;
      return { ...info, snapshot: await loadStored(d, id, { manifest, snapshot }) } as Version;
    }),
    current: id => this.read(async d => {
      const p = await d.get<Project>("projects", id);
      // Live edits (Phase C) move a head ahead of the last saved version.
      return p ? latestVersion(d, p) : null;
    }),
    restore: (id, rev, authorId) => this.tx(async d => {
      const p = await d.get<Project>("projects", id);
      const v = await d.get<StoredVersion>("versions", `${id}:${rev}`);
      if (!p || !v) throw missing();
      return this.save(d, p, p.rev, await loadStored(d, id, v), authorId, `Restored version ${rev}`);
    }),
  };
  members: Repo["members"] = {
    get: (projectId, userId) => this.read(d => d.get<Member>("members", `${projectId}:${userId}`)),
    put: (projectId, userId, role, options = {}) => this.tx(async d => {
      const p = await d.get<Project>("projects", projectId); if (!p) throw missing();
      await putMember(d, p, userId, role, this.now(), options.exportDenied);
    }),
    list: projectId => this.read(async d => {
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
  shares = sharesRepo(fn => this.tx(fn), () => this.now(), fn => this.read(fn));
  comments = commentsRepo(fn => this.tx(fn), () => this.now(), fn => this.read(fn));
  live = liveRepo(fn => this.tx(fn), () => this.now(), fn => this.read(fn));
  proposals = proposalsRepo(fn => this.tx(fn), () => this.now(), fn => this.read(fn));
  locks = locksRepo(fn => this.tx(fn), () => this.now(), fn => this.read(fn));
  jobs = jobsRepo(fn => this.tx(fn), () => this.now(), fn => this.read(fn));
  connector = connectorRepo(fn => this.tx(fn), () => this.now(), fn => this.read(fn));
  gaps = gapsRepo(fn => this.tx(fn), () => this.now(), fn => this.read(fn));
  sources: Repo["sources"] = {
    remove: async id => {
      await this.storage.bytes.remove(id);
      await this.tx(d => d.remove("sources", id));
    },
    put: async (bytes, fileName, ownerId, expiresAt, creditUploadId) => {
      const limits = quotas();
      const maximum = ownerId ? limits.sourceBytes : Math.min(limits.sourceBytes, limits.anonymousUploadBytes);
      if (bytes.length > maximum) refuseBytes(ownerId ? "Stored source" : "Anonymous source", maximum);
      const id = crypto.randomUUID();
      await this.tx(async d => {
        if (ownerId) {
          const stored = await this.storedBytes(d, ownerId);
          const pending = (await d.list<Upload>("uploads", { ownerId })).filter(upload => upload.expiresAt > this.now() && !upload.sourceId && upload._id !== creditUploadId).reduce((sum, upload) => sum + upload.size, 0);
          if (ownerId !== LOCAL_ENGINEER && stored + pending + bytes.length > limits.accountSourceBytes) refuseBytes("Stored and pending sources per account", limits.accountSourceBytes);
        }
        await d.put("sources", { _id: id, ownerId, fileName, size: bytes.length, createdAt: this.now(), ...(expiresAt ? { expiresAt } : {}) });
      });
      try { await this.storage.bytes.put(id, bytes); }
      catch (error) { await this.tx(d => d.remove("sources", id)); throw error; }
      return id;
    },
    info: async id => {
      if (!validId(id)) return null;
      const meta = await this.read(d => d.get<Source>("sources", id));
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
    removeOwned: ownerId => this.tx(async d => {
      for (const upload of await d.list<Upload>("uploads", { ownerId })) {
        await d.removeMany("uploadParts", (await d.list<Part>("uploadParts", { uploadId: upload._id }, { projection: { _id: 1 } })).map(part => part._id));
        await d.remove("uploads", upload._id);
      }
    }),
    create: async (fileName, size, ownerId) => {
      if (!Number.isSafeInteger(size) || size <= 0) throw new ServerError(400, "invalid", "Expected a positive file size");
      const limits = quotas();
      const maximum = ownerId ? limits.uploadBytes : Math.min(limits.uploadBytes, limits.anonymousUploadBytes);
      if (size > maximum) refuseBytes(ownerId ? "Upload" : "Anonymous upload", maximum);
      await this.uploads.sweep();
      const u: Upload = { _id: crypto.randomUUID(), fileName, size, ownerId, expiresAt: this.now() + TTL_MS };
      await this.tx(async d => {
        if (ownerId) {
          const stored = await this.storedBytes(d, ownerId);
          const pending = (await d.list<Upload>("uploads", { ownerId })).filter(upload => upload.expiresAt > this.now() && !upload.sourceId).reduce((sum, upload) => sum + upload.size, 0);
          if (ownerId !== LOCAL_ENGINEER && stored + pending + size > limits.accountSourceBytes) refuseBytes("Stored and pending sources per account", limits.accountSourceBytes);
        } else {
          // Completion turns an upload into an expiring source; only handles
          // still receiving parts belong to the anonymous in-flight budget.
          const pending = (await d.list<Upload>("uploads", { ownerId: null })).filter(upload => upload.expiresAt > this.now() && !upload.sourceId).reduce((sum, upload) => sum + upload.size, 0);
          if (pending + size > limits.anonymousUploadTotalBytes) refuseBytes("Anonymous uploads in flight", limits.anonymousUploadTotalBytes);
        }
        await d.put("uploads", u);
      });
      return u;
    },
    get: id => this.read(async d => { const u = await d.get<Upload>("uploads", id); return u && u.expiresAt > this.now() ? u : null; }),
    part: (id, part, bytes, ownerId) => this.tx(async d => {
      const u = await this.upload(d, id, ownerId);
      if (u.sourceId) throw new ServerError(409, "complete", "Upload already completed");
      if (!Number.isInteger(part) || part < 0 || part >= u.size) throw new ServerError(400, "invalid", "Invalid part number");
      if (!bytes.length) throw new ServerError(400, "invalid", "Empty upload part");
      if (bytes.length > PART_BYTES) throw new ServerError(413, "too-large", "Part exceeds 4 MB");
      const parts = await d.list<Part>("uploadParts", { uploadId: id });
      const total = parts.filter(p => p.part !== part).reduce((sum, p) => sum + p.size, bytes.length);
      if (total > u.size) throw new ServerError(413, "too-large", `Parts exceed the declared ${u.size} bytes`);
      // Writing the shared upload row serializes competing part transactions,
      // including different part numbers, before either can exceed the cap.
      await d.put("uploads", { ...u, receivedBytes: total });
      // Bytes, not base64: a 4 MB part was 5.3 MB of BSON before v2.
      await d.put("uploadParts", { _id: `${id}:${part}`, uploadId: id, part, size: bytes.length, data: new Uint8Array(bytes), expiresAt: u.expiresAt });
    }),
    complete: async (id, ownerId) => {
      const { u, parts } = await this.tx(async d => ({ u: await this.upload(d, id, ownerId), parts: await d.list<Part>("uploadParts", { uploadId: id }) }));
      if (u.sourceId) return u.sourceId;
      parts.sort((a, b) => a.part - b.part);
      if (!parts.length || parts.some((p, i) => p.part !== i) || parts.reduce((sum, p) => sum + p.size, 0) !== u.size) throw new ServerError(400, "incomplete", "Upload is missing parts");
      const bytes = Buffer.concat(parts.map(p => asBytes(p.data)));
      if (bytes.length !== u.size) throw new ServerError(413, "too-large", `Upload does not match the declared ${u.size} bytes`);
      const sourceId = await this.sources.put(bytes, u.fileName, ownerId, ownerId ? undefined : this.now() + TTL_MS, id);
      const chosen = await this.tx(async d => {
        const current = await this.upload(d, id, ownerId);
        if (current.sourceId) return current.sourceId;
        await d.put("uploads", { ...current, sourceId });
        await d.removeMany("uploadParts", parts.map(p => p._id));
        return sourceId;
      });
      if (chosen !== sourceId) { await this.storage.bytes.remove(sourceId); await this.tx(d => d.remove("sources", sourceId)); }
      return chosen;
    },
    sweep: async () => {
      // Bounded and index-backed: an upload pays for tidying at most a page of
      // expired rows, never a scan of every upload and source ever stored.
      const expired = await this.tx(async d => {
        const now = this.now();
        for (const u of await d.list<Upload>("uploads", { expiresAt: { $lte: now } }, { projection: { _id: 1 }, limit: SWEEP_PAGE })) {
          await d.removeMany("uploadParts", (await d.list<Part>("uploadParts", { uploadId: u._id }, { projection: { _id: 1 } })).map(p => p._id));
          await d.remove("uploads", u._id);
        }
        return d.list<Source>("sources", { expiresAt: { $lte: now } }, { projection: { _id: 1 }, limit: SWEEP_PAGE });
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
