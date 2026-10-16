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
 * had seen. A whole-part `setPart` replaces the part; a `removePart` therefore
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
import type { Project, Snapshot, Version, VersionInfo } from "./repo";
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

type Head = Row & { projectId: string; rev: number; author: string; at: number; snapshot: Snapshot };
type LogRow = Row & LoggedChange & { projectId: string; changeId: string };
type PresenceRow = Row & Presence & { projectId: string };

/** What a reader starts from: the newest of the live head and the last saved version. */
export async function latest(d: Data, p: Project): Promise<{ rev: number; snapshot: Snapshot; authorId: string; at: number } | null> {
  const head = await d.get<Head>("heads", p._id);
  const version = await d.get<Version>("versions", `${p._id}:${p.headRev ?? p.rev}`);
  if (head && (!version || head.rev > version.rev)) return { rev: head.rev, snapshot: head.snapshot, authorId: head.author, at: head.at };
  return version ? { rev: version.rev, snapshot: version.snapshot, authorId: version.authorId, at: version.createdAt } : null;
}

/** The newest state as a Version, so Phase A readers see live edits without change. */
export async function latestVersion(d: Data, p: Project): Promise<Version | null> {
  const found = await latest(d, p);
  if (!found) return null;
  return { _id: `${p._id}:${found.rev}`, projectId: p._id, rev: found.rev, authorId: found.authorId, label: "Current", createdAt: found.at, snapshot: found.snapshot };
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

/** The live log, head, versions checkpoint and presence, bound to the repository's transaction and clock. */
export function liveRepo(tx: Tx, now: Clock): LiveRepo {
  /** Leave a version behind a long live session, so history still has points to return to. */
  async function checkpoint(d: Data, p: Project, snapshot: Snapshot, author: string): Promise<Project> {
    const last = p.headRev ? await d.get<VersionInfo>("versions", `${p._id}:${p.headRev}`) : null;
    if (last && now() - last.createdAt < CHECKPOINT_MS) return p;
    const version: Version = { _id: `${p._id}:${p.rev}`, projectId: p._id, rev: p.rev, authorId: author, label: "Live edits", createdAt: now(), snapshot };
    await d.put("versions", version);
    const history = await d.list<VersionInfo>("versions", { projectId: p._id }, { projection: { snapshot: 0 }, sort: { rev: -1 } });
    for (const old of history.slice(50)) await d.remove("versions", old._id);
    return { ...p, headRev: p.rev };
  }

  return {
    append: (projectId, changes) => tx(async d => {
      let p = await d.get<Project>("projects", projectId);
      if (!p) throw new ServerError(404, "not-found", "Project not found");
      const start = await latest(d, p);
      if (!start) throw new ServerError(409, "no-snapshot", "The project has no snapshot to edit");
      let snapshot = start.snapshot;
      let doc = docOf(snapshot);
      let rev = Math.max(p.rev, start.rev);
      const result: ChangesResult = { rev, accepted: [], rejected: [] };
      let lastAuthor = "";
      for (const change of changes) {
        const problem = invalid(change);
        if (problem) {
          result.rejected.push({ id: typeof change?.id === "string" ? change.id : "", reason: problem });
          continue;
        }
        // A retried POST must not apply the same edit twice.
        const seen = await d.list<LogRow>("changes", { projectId, changeId: change.id }, { projection: { _id: 1 }, limit: 1 });
        if (seen.length > 0) {
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
        const row: LogRow = { _id: `${projectId}:${rev}`, projectId, changeId: change.id, rev, change, author: change.author, at: now() };
        await d.put("changes", row);
        // Older than the retained window: already part of the head.
        await d.remove("changes", `${projectId}:${rev - LOG_LIMIT}`);
        result.accepted.push(change.id);
        lastAuthor = change.author;
      }
      result.rev = rev;
      if (rev === Math.max(p.rev, start.rev)) return result;
      snapshot = { ...snapshot, ...doc, id: projectId };
      const head: Head = { _id: projectId, projectId, rev, author: lastAuthor, at: now(), snapshot };
      await d.put("heads", head);
      p = { ...p, rev, name: snapshot.name, target: snapshot.target, layout: snapshot.layout ?? p.layout, updatedAt: now() };
      p = await checkpoint(d, p, snapshot, lastAuthor);
      await d.put("projects", p);
      return result;
    }),

    since: (projectId, since) => tx(async d => {
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
        return { rev: start.rev, reset: start.snapshot };
      }
      return { rev, changes: rows.map(r => ({ rev: r.rev, change: r.change, author: r.author, at: r.at })) };
    }),

    at: (projectId, rev) => tx(async d => {
      const p = await d.get<Project>("projects", projectId);
      if (!p) return null;
      const head = await d.get<Head>("heads", projectId);
      if (head?.rev === rev) return head.snapshot;
      const exact = await d.get<Version>("versions", `${projectId}:${rev}`);
      if (exact) return exact.snapshot;
      // The closest version before `rev`, replayed forward through the log.
      const history = await d.list<VersionInfo>("versions", { projectId }, { projection: { snapshot: 0 }, sort: { rev: -1 } });
      const base = history.find(v => v.rev < rev);
      if (!base) return null;
      const version = await d.get<Version>("versions", base._id);
      if (!version) return null;
      const rows = await d.list<LogRow>("changes", { projectId, rev: { $gt: base.rev } }, { sort: { rev: 1 } });
      const needed = rows.filter(r => r.rev <= rev);
      if (needed.length !== rev - base.rev || needed.some((r, i) => r.rev !== base.rev + 1 + i)) return null;
      let doc = docOf(version.snapshot);
      for (const row of needed) doc = apply(doc, row.change.ops);
      return { ...version.snapshot, ...doc };
    }),

    presence: {
      put: (projectId, entry) => tx(async d => {
        const row: PresenceRow = { _id: `${projectId}:${entry.userId}`, projectId, ...entry, expiresAt: now() + PRESENCE_TTL_MS };
        await d.put("presence", row);
        return entry2presence(row);
      }),
      list: projectId => tx(async d => {
        const rows = await d.list<PresenceRow>("presence", { projectId });
        const live: Presence[] = [];
        for (const row of rows) {
          if (row.expiresAt > now()) live.push(entry2presence(row));
          // Stale heartbeats are dropped as they are found; no timer needed.
          else await d.remove("presence", row._id);
        }
        return live;
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
