/**
 * The small storage vocabulary underneath Repo. Project metadata, membership
 * and history change in one transaction: a failed history write must never
 * advance the project's revision. Mongo uses database transactions; the laptop
 * store uses an exclusive filesystem lock and an atomically replaced journal.
 * That lock also covers separate Next workers, not just promises in one process.
 * Binary sources are separate files or GridFS streams, never BSON documents.
 */
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { GridFSBucket, ObjectId, type ClientSession, type Db } from "mongodb";
import { mongoClient, mongoDb } from "@/lib/db/mongo";
import { ServerError } from "./errors";

export type Row = { _id: string } & Record<string, unknown>;
/** Keep route ids safe for both filesystem and database keys. */
export const validId = (id: string) => /^[a-zA-Z0-9_-]{1,160}$/.test(id);
/** Bound metadata queries before materializing large snapshot records. */
export interface ListOptions {
  projection?: Record<string, 0 | 1>;
  sort?: Record<string, 1 | -1>;
  limit?: number;
}
/** Transaction-local operations keep repository invariants atomic. */
export interface Data {
  get<T extends Row>(table: string, id: string): Promise<T | null>;
  list<T extends Row>(table: string, query?: Record<string, unknown>, options?: ListOptions): Promise<T[]>;
  put(table: string, row: Row): Promise<void>;
  remove(table: string, id: string): Promise<void>;
}
/** Metadata transactions and binary storage have separate lifecycles. */
export interface Storage {
  transaction<T>(fn: (data: Data) => Promise<T>): Promise<T>;
  bytes: { put(id: string, bytes: Uint8Array): Promise<void>; get(id: string): Promise<Uint8Array | null>; remove(id: string): Promise<void> };
}
type State = Record<string, Record<string, Row>>;

/**
 * Equality, plus the two range operators this repository needs: the changes
 * after a revision, and the rows whose window has passed (sign-in attempts).
 * Written in MongoDB's own shape (`{ $gt: n }`) so the same query object works
 * unchanged against the database.
 */
function matches(actual: unknown, wanted: unknown): boolean {
  if (wanted && typeof wanted === "object" && "$gt" in wanted) {
    const bound = (wanted as { $gt: number }).$gt;
    return typeof actual === "number" && actual > bound;
  }
  if (wanted && typeof wanted === "object" && "$lte" in wanted) {
    const bound = (wanted as { $lte: number }).$lte;
    return typeof actual === "number" && actual <= bound;
  }
  return actual === wanted;
}

function dataFor(state: State): Data {
  return {
    async get<T extends Row>(table: string, id: string): Promise<T | null> { return structuredClone((state[table]?.[id] as T | undefined) ?? null); },
    async list<T extends Row>(table: string, query: Record<string, unknown> = {}, options: ListOptions = {}) {
      let rows = Object.values(state[table] ?? {}).filter(r => Object.entries(query).every(([k, v]) => matches(r[k], v)));
      for (const [key, direction] of Object.entries(options.sort ?? {}).reverse()) {
        rows.sort((a, b) => (a[key] === b[key] ? 0 : (a[key] as number) < (b[key] as number) ? -1 : 1) * direction);
      }
      if (options.limit !== undefined) rows = rows.slice(0, options.limit);
      const projection = options.projection;
      if (projection) rows = rows.map(row => {
        const inclusive = Object.entries(projection).some(([key, value]) => key !== "_id" && value === 1);
        return Object.fromEntries(Object.entries(row).filter(([key]) => inclusive
          ? projection[key] === 1 || (key === "_id" && projection._id !== 0)
          : projection[key] !== 0)) as Row;
      });
      return structuredClone(rows) as T[];
    },
    async put(table, row) { (state[table] ??= {})[row._id] = structuredClone(row); },
    async remove(table, id) { delete state[table]?.[id]; },
  };
}
/** Isolated transactional storage for deterministic repository tests. */
export class MemoryStorage implements Storage {
  private state: State = {};
  private tail: Promise<unknown> = Promise.resolve();
  private blobs = new Map<string, Uint8Array>();
  bytes = {
    put: async (id: string, bytes: Uint8Array) => { this.blobs.set(id, new Uint8Array(bytes)); },
    get: async (id: string) => this.blobs.get(id)?.slice() ?? null,
    remove: async (id: string) => { this.blobs.delete(id); },
  };
  transaction<T>(fn: (data: Data) => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const next = structuredClone(this.state);
      const result = await fn(dataFor(next));
      this.state = next;
      return result;
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
}
/** The local journal survives interrupted writes across Next workers. */
export class FileStorage implements Storage {
  constructor(private root: string) {}
  private file(id: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new ServerError(400, "invalid", "Invalid source id");
    return path.join(this.root, "sources", `${id}.bin`);
  }
  bytes = {
    put: async (id: string, bytes: Uint8Array) => {
      await mkdir(path.join(this.root, "sources"), { recursive: true });
      await writeFile(this.file(id), bytes, { flag: "wx" });
    },
    get: async (id: string) => {
      try { return new Uint8Array(await readFile(this.file(id))); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
    },
    remove: async (id: string) => { await rm(this.file(id), { force: true }); },
  };
  async transaction<T>(fn: (data: Data) => Promise<T>): Promise<T> {
    await mkdir(this.root, { recursive: true });
    const lock = path.join(this.root, ".lock");
    const deadline = Date.now() + 10000;
    for (;;) {
      try { await mkdir(lock); break; }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        if (Date.now() > deadline) throw new ServerError(503, "storage-busy", "Local storage is locked; retry, or remove .data/.lock if its writer stopped");
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    try {
      // A write-ahead journal makes a multi-directory commit recoverable.
      // Readers take the same lock and finish an interrupted commit first.
      const tables = [
        "users", "projects", "versions", "members", "sources", "uploads", "uploadParts",
        // Collaboration phases B, C and D.
        "shares", "comments", "changes", "heads", "presence", "proposals", "decisions", "agentLocks",
        // Sign-in attempt counters (lib/server/rate-limit.ts).
        "signInAttempts",
      ];
      const journal = path.join(this.root, "journal.json");
      const readJson = async (file: string) => {
        try { return JSON.parse(await readFile(file, "utf8")); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; return null; }
      };
      const apply = async (state: State) => {
        for (const table of Object.keys(state)) {
          if (!tables.includes(table)) throw new Error("Invalid journal table");
          const dir = path.join(this.root, table);
          await mkdir(dir, { recursive: true });
          await writeFile(path.join(dir, "records.tmp"), JSON.stringify(state[table]));
          await rename(path.join(dir, "records.tmp"), path.join(dir, "records.json"));
        }
        await rm(journal, { force: true });
      };
      const pending = await readJson(journal) as State | null;
      if (pending) await apply(pending);
      const state: State = {};
      for (const table of tables) state[table] = await readJson(path.join(this.root, table, "records.json")) ?? {};
      const before = Object.fromEntries(tables.map(table => [table, JSON.stringify(state[table])]));
      const result = await fn(dataFor(state));
      const changes = Object.fromEntries(tables.filter(table => before[table] !== JSON.stringify(state[table])).map(table => [table, state[table]]));
      if (Object.keys(changes).length) {
        const temp = path.join(this.root, "journal.tmp");
        await writeFile(temp, JSON.stringify(changes));
        await rename(temp, journal);
        await apply(changes);
      }
      return result;
    } finally { await rm(lock, { recursive: true }); }
  }
}
function mongoData(db: Db, session: ClientSession): Data {
  return {
    async get<T extends Row>(table: string, id: string) { return await db.collection<Row>(table).findOne({ _id: id }, { session }) as T | null; },
    async list<T extends Row>(table: string, query: Record<string, unknown> = {}, options: ListOptions = {}) {
      const cursor = db.collection<Row>(table).find(query, { session, projection: options.projection });
      if (options.sort) cursor.sort(options.sort);
      if (options.limit !== undefined) cursor.limit(options.limit);
      return await cursor.toArray() as T[];
    },
    async put(table, row) { await db.collection<Row>(table).replaceOne({ _id: row._id }, row, { upsert: true, session }); },
    async remove(table, id) { await db.collection<Row>(table).deleteOne({ _id: id }, { session }); },
  };
}
/** Durable deployment storage; transactions retry competing project writes. */
export class MongoStorage implements Storage {
  private ready?: Promise<void>;
  private indexes() {
    return this.ready ??= (async () => {
      const db = await mongoDb();
      await db.collection("versions").createIndex({ projectId: 1, rev: -1 }, { unique: true });
      // The database, not the application, is what finally makes an address one
      // account: two sign-ups racing on the same email both pass an in-transaction
      // lookup, and this index is what makes the loser fail.
      await db.collection("users").createIndex({ emailKey: 1 }, { unique: true, sparse: true });
      await db.collection("signInAttempts").createIndex({ resetAt: 1 });
      await db.collection("members").createIndex({ userId: 1, projectId: 1 });
      await db.collection("uploadParts").createIndex({ uploadId: 1, part: 1 }, { unique: true });
      await db.collection("sources.files").createIndex({ filename: 1 });
      await db.collection("shares").createIndex({ projectId: 1 });
      await db.collection("comments").createIndex({ projectId: 1, createdAt: 1 });
      await db.collection("changes").createIndex({ projectId: 1, rev: 1 }, { unique: true });
      await db.collection("presence").createIndex({ projectId: 1 });
      await db.collection("proposals").createIndex({ projectId: 1, createdAt: -1 });
      await db.collection("decisions").createIndex({ projectId: 1, at: 1 });
      // Every MCP call looks a token up by its hash, so that lookup is the one
      // on the hot path; unique because two rows for one secret would mean one
      // of them survived a revocation.
      await db.collection("connectorTokens").createIndex({ hash: 1 }, { unique: true });
      await db.collection("connectorTokens").createIndex({ userId: 1, kind: 1, createdAt: -1 });
      await db.collection("connectorTokens").createIndex({ grantId: 1 });
      await db.collection("connectorTokens").createIndex({ expiresAt: 1 });
      await db.collection("connectorGrants").createIndex({ userId: 1, clientId: 1, createdAt: -1 });
      await db.collection("oauthCodes").createIndex({ expiresAt: 1 });
    })().catch(error => { this.ready = undefined; throw error; });
  }
  async transaction<T>(fn: (data: Data) => Promise<T>): Promise<T> {
    await this.indexes();
    const session = (await mongoClient()).startSession();
    try { return await session.withTransaction(async () => fn(mongoData(await mongoDb(), session))); }
    finally { await session.endSession(); }
  }
  bytes = {
    put: async (id: string, bytes: Uint8Array) => {
      const bucket = new GridFSBucket(await mongoDb(), { bucketName: "sources" });
      await new Promise<void>((resolve, reject) => {
        const stream = bucket.openUploadStream(id, { metadata: { sourceId: id } });
        stream.on("error", reject).on("finish", resolve);
        stream.end(Buffer.from(bytes));
      });
    },
    get: async (id: string) => {
      const bucket = new GridFSBucket(await mongoDb(), { bucketName: "sources" });
      const file = await bucket.find({ filename: id }).next();
      if (!file) return null;
      const chunks: Buffer[] = [];
      for await (const chunk of bucket.openDownloadStream(file._id)) chunks.push(Buffer.from(chunk));
      return new Uint8Array(Buffer.concat(chunks));
    },
    remove: async (id: string) => {
      const bucket = new GridFSBucket(await mongoDb(), { bucketName: "sources" });
      for await (const file of bucket.find({ filename: id })) await bucket.delete(file._id as ObjectId);
    },
  };
}
