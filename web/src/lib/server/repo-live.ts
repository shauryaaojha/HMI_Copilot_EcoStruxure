/**
 * Live co-editing on the server (Phase C): an operation log over plain HTTP.
 *
 * Vercel functions are stateless and cannot hold a WebSocket, so the project's
 * order of events lives in the database. Each accepted change gets the next
 * revision, is appended to the `changes` log and is applied to the project's
 * `heads` record - the latest snapshot, which every reader starts from. The
 * log keeps the last 2,000 changes per project; anything older is already in
 * the head, so a client that fell further behind than that is sent the head
 * whole (a reset) instead of a replay.
 *
 * Conflicts resolve as last writer wins per part or record: changes are
 * applied in the order they reach the server, whatever revision their author
 * had seen. A `setPart` lands the properties it names, or the whole part when it
 * names none, so same-property edits go to the later one; a `removePart` therefore
 * beats a concurrent `setPart` only when it arrived later (has the higher rev),
 * and a later `setPart` brings a removed part back.
 *
 * One transaction covers read-apply-write for a batch, which serialises
 * writers per project: MongoDB retries the transaction when two writers touch
 * the same project document (a compare-and-set on its rev), the file store
 * holds its process-wide lock, and the memory store queues transactions.
 */
import { apply, CollabApplyError, docOf, validStoreChange } from "@/lib/collab/changes";
import type { Change, ChangesResult, LoggedChange, Presence } from "@/lib/collab/types";
import { ServerError } from "./errors";
import type { Data, Row } from "./storage";
import type { Project, Snapshot, StoredVersion, Version, VersionInfo } from "./repo";
import { loadStored, sweepObjects, writeSnapshot, type Stored } from "./snapshots";
import type { Clock, Tx } from "./repo-collab";

/** Changes kept per project before older ones are folded into the head. */
export const LOG_LIMIT = 2000;
/** Most changes a client may send in one request, and most a poll returns. */
export const BATCH_LIMIT = 500;
/** Most StoreChange records in one change: one committed action. */
const OPS_LIMIT = 5000;
/** A live session leaves a version in history at most this often. */
const CHECKPOINT_MS = 10 * 60 * 1000;
/** A presence heartbeat counts for this long. */
export const PRESENCE_TTL_MS = 15_000;

/** The live head. Since v2 it holds a manifest, so a change batch rewrites a few KB, not the project. */
type Head = Row & Stored & { projectId: string; rev: number; author: string; at: number };
/** Versions a live session keeps; matches HISTORY_LIMIT in repo.ts. */
const HISTORY_LIMIT = 50;
type LogRow = Row & LoggedChange & { projectId: string; changeId: string };
type PresenceRow = Row & Presence & { projectId: string };

/**
 * What a reader starts from: the newest of the live head and the last saved
 * version. The snapshot is loaded only when asked for: a poll that is already
 * up to date needs the revision, not the project.
 */
export async function latest(d: Data, p: Project): Promise<{ rev: number; authorId: string; at: number; load(): Promise<Snapshot> } | null> {
  const head = await d.get<Head>("heads", p._id);
  // A head past the last saved version is the answer; the version need not be read.
  if (head && head.rev > (p.headRev ?? p.rev)) return { rev: head.rev, authorId: head.author, at: head.at, load: () => loadStored(d, p._id, head) };
  const version = await d.get<StoredVersion>("versions", `${p._id}:${p.headRev ?? p.rev}`);
  if (head && (!version || head.rev > version.rev)) return { rev: head.rev, authorId: head.author, at: head.at, load: () => loadStored(d, p._id, head) };
  return version ? { rev: version.rev, authorId: version.authorId, at: version.createdAt, load: () => loadStored(d, p._id, version) } : null;
}

/** The newest state as a Version, so Phase A readers see live edits without change. */
export async function latestVersion(d: Data, p: Project): Promise<Version | null> {
  const found = await latest(d, p);
  if (!found) return null;
  return { _id: `${p._id}:${found.rev}`, projectId: p._id, rev: found.rev, authorId: found.authorId, label: "Current", createdAt: found.at, snapshot: await found.load() };
}

export interface LiveRepo {
  /** Apply a batch of changes in order; answers the new rev and what was accepted. */
  append(projectId: string, changes: Change[]): Promise<ChangesResult>;
  /** The log after `since`, or the whole head when the log no longer reaches back that far. */
  since(projectId: string, since: number): Promise<{ rev: number; changes: LoggedChange[] } | { rev: number; reset: Snapshot }>;
  /** The snapshot exactly at `rev`, rebuilt from a version and the log when needed. */
  at(projectId: string, rev: number): Promise<Snapshot | null>;
  presence: {
    put(projectId: string, entry: Omit<Presence, "expiresAt">): Promise<Presence>;
    list(projectId: string): Promise<Presence[]>;
    /** A heartbeat and the answer to it - who is here - in one transaction. */
    beat(projectId: string, entry: Omit<Presence, "expiresAt">): Promise<{ presence: Presence; users: Presence[] }>;
  };
}

/** Why a change cannot be applied, in words the author's client can show. */
function invalid(change: unknown): string | null {
  if (!change || typeof change !== "object") return "not a change";
  const c = change as Partial<Change>;
  if (typeof c.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(c.id)) return "missing id";
  if (!Number.isSafeInteger(c.base) || (c.base as number) < 0) return "missing base revision";
  if (!Array.isArray(c.ops) || c.ops.length === 0) return "no operations";
  if (c.ops.length > OPS_LIMIT) return "too many operations";
  if (!c.ops.every(validStoreChange)) return "malformed operation";
  return null;
}

/** Record one heartbeat. */
async function putPresence(d: Data, projectId: string, entry: Omit<Presence, "expiresAt">, at = Date.now()): Promise<Presence> {
  const row: PresenceRow = { _id: `${projectId}:${entry.userId}`, projectId, ...entry, expiresAt: at + PRESENCE_TTL_MS };
  await d.put("presence", row);
  return entry2presence(row);
}

/** Who is here now; stale heartbeats are dropped as they are found (Mongo's TTL index also takes them). */
async function listPresence(d: Data, projectId: string, at = Date.now()): Promise<Presence[]> {
  const rows = await d.list<PresenceRow>("presence", { projectId });
  const stale = rows.filter(row => row.expiresAt <= at).map(row => row._id);
  await d.removeMany("presence", stale);
  return rows.filter(row => row.expiresAt > at).map(entry2presence);
}

/** The live log, head, versions checkpoint and presence, bound to the repository's transaction and clock. */
export function liveRepo(tx: Tx, now: Clock, read: Tx = tx): LiveRepo {
  /** Leave a version behind a long live session, so history still has points to return to. */
  async function checkpoint(d: Data, p: Project, snapshot: Snapshot, author: string): Promise<Project> {
    // The project row remembers when the last version was left (v2); older rows read the version.
    const lastAt = p.checkpointAt ?? (p.headRev ? (await d.get<VersionInfo>("versions", `${p._id}:${p.headRev}`))?.createdAt : undefined);
    if (lastAt !== undefined && now() - lastAt < CHECKPOINT_MS) return p;
    const manifest = await writeSnapshot(d, p._id, snapshot, now());
    await d.put("versions", { _id: `${p._id}:${p.rev}`, projectId: p._id, rev: p.rev, authorId: author, label: "Live edits", createdAt: now(), manifest });
    const history = await d.list<VersionInfo>("versions", { projectId: p._id }, { projection: { snapshot: 0, manifest: 0 }, sort: { rev: -1 } });
    await d.removeMany("versions", history.slice(HISTORY_LIMIT).map(old => old._id));
    // The heads between two checkpoints left pieces nothing refers to any
    // more. The caller writes the project row in this same transaction, which
    // is what makes sweeping here safe (lib/server/snapshots.ts).
    await sweepObjects(d, p._id);
    return { ...p, headRev: p.rev, checkpointAt: now() };
  }

  return {
    append: (projectId, changes) => tx(async d => {
      let p = await d.get<Project>("projects", projectId);
      if (!p) throw new ServerError(404, "not-found", "Project not found");
      const start = await latest(d, p);
      if (!start) throw new ServerError(409, "no-snapshot", "The project has no snapshot to edit");
      let snapshot = await start.load();
      let doc = docOf(snapshot);
      let rev = Math.max(p.rev, start.rev);
      const result: ChangesResult = { rev, accepted: [], rejected: [] };
      let lastAuthor = "";
      // A retried POST must not apply the same edit twice: every id in the
      // batch is looked up in one query, not one query per change.
      const ids = changes.map(c => c?.id).filter((id): id is string => typeof id === "string");
      const seen = new Set(ids.length ? (await d.list<LogRow>("changes", { projectId, changeId: { $in: ids } }, { projection: { changeId: 1 } })).map(r => r.changeId) : []);
      const logged: LogRow[] = [];
      for (const change of changes) {
        const problem = invalid(change);
        if (problem) {
          result.rejected.push({ id: typeof change?.id === "string" ? change.id : "", reason: problem });
          continue;
        }
        if (seen.has(change.id)) {
          result.accepted.push(change.id);
          continue;
        }
        try {
          doc = apply(doc, change.ops);
        } catch (error) {
          const reason = error instanceof CollabApplyError ? error.reason : "could not be applied";
          result.rejected.push({ id: change.id, reason });
          continue;
        }
        rev += 1;
        logged.push({ _id: `${projectId}:${rev}`, projectId, changeId: change.id, rev, change, author: change.author, at: now() });
        seen.add(change.id);
        result.accepted.push(change.id);
        lastAuthor = change.author;
      }
      result.rev = rev;
      if (rev === Math.max(p.rev, start.rev)) return result;
      await d.putMany("changes", logged);
      // Older than the retained window: already part of the head.
      await d.removeMany("changes", logged.map(r => `${projectId}:${r.rev - LOG_LIMIT}`).filter(id => !logged.some(r => r._id === id)));
      snapshot = { ...snapshot, ...doc, id: projectId };
      const head: Head = { _id: projectId, projectId, rev, author: lastAuthor, at: now(), manifest: await writeSnapshot(d, projectId, snapshot, now()) };
      await d.put("heads", head);
      p = { ...p, rev, name: snapshot.name, target: snapshot.target, layout: snapshot.layout ?? p.layout, updatedAt: now() };
      p = await checkpoint(d, p, snapshot, lastAuthor);
      await d.put("projects", p);
      return result;
    }),

    since: (projectId, since) => read(async d => {
      const p = await d.get<Project>("projects", projectId);
      if (!p) throw new ServerError(404, "not-found", "Project not found");
      const start = await latest(d, p);
      const rev = Math.max(p.rev, start?.rev ?? 0);
      if (since >= rev) return { rev, changes: [] };
      const rows = await d.list<LogRow>("changes", { projectId, rev: { $gt: since } }, { sort: { rev: 1 }, limit: BATCH_LIMIT });
      // A gap means the log no longer reaches back to `since`, or the project
      // was saved or restored whole: either way the client starts again.
      if (rows.length === 0 || rows[0].rev !== since + 1 || rows.some((r, i) => r.rev !== since + 1 + i)) {
        if (!start) throw new ServerError(409, "no-snapshot", "The project has no snapshot");
        return { rev: start.rev, reset: await start.load() };
      }
      return { rev, changes: rows.map(r => ({ rev: r.rev, change: r.change, author: r.author, at: r.at })) };
    }),

    at: (projectId, rev) => read(async d => {
      const p = await d.get<Project>("projects", projectId);
      if (!p) return null;
      const head = await d.get<Head>("heads", projectId);
      if (head?.rev === rev) return loadStored(d, projectId, head);
      const exact = await d.get<StoredVersion>("versions", `${projectId}:${rev}`);
      if (exact) return loadStored(d, projectId, exact);
      // The closest version before `rev`, replayed forward through the log.
      const history = await d.list<VersionInfo>("versions", { projectId }, { projection: { snapshot: 0, manifest: 0 }, sort: { rev: -1 } });
      const base = history.find(v => v.rev < rev);
      if (!base) return null;
      const stored = await d.get<StoredVersion>("versions", base._id);
      if (!stored) return null;
      const version = { snapshot: await loadStored(d, projectId, stored) };
      const rows = await d.list<LogRow>("changes", { projectId, rev: { $gt: base.rev } }, { sort: { rev: 1 } });
      const needed = rows.filter(r => r.rev <= rev);
      if (needed.length !== rev - base.rev || needed.some((r, i) => r.rev !== base.rev + 1 + i)) return null;
      let doc = docOf(version.snapshot);
      for (const row of needed) doc = apply(doc, row.change.ops);
      return { ...version.snapshot, ...doc };
    }),

    presence: {
      put: (projectId, entry) => tx(d => putPresence(d, projectId, entry, now())),
      list: projectId => tx(d => listPresence(d, projectId, now())),
      beat: (projectId, entry) => tx(async d => {
        const presence = await putPresence(d, projectId, entry, now());
        return { presence, users: await listPresence(d, projectId, now()) };
      }),
    },
  };
}

/** A stored heartbeat without its storage keys. */
function entry2presence(row: PresenceRow): Presence {
  const presence: Presence = { userId: row.userId, name: row.name, selection: row.selection, expiresAt: row.expiresAt };
  if (row.screenId) presence.screenId = row.screenId;
  if (row.cursor) presence.cursor = row.cursor;
  return presence;
}
