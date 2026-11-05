/**
 * The small storage vocabulary underneath Repo. Project metadata, membership
 * and history change in one transaction: a failed history write must never
 * advance the project's revision. Mongo uses database transactions; the laptop
 * store uses an exclusive filesystem lock and an atomically replaced journal.
 * That lock also covers separate Next workers, not just promises in one process.
 * Binary sources are separate files or GridFS streams, never BSON documents.
 *
 * Database v2 (docs/DATABASE_V2.md) added three things here:
 *
 * - **Batch operations.** `putMany`, `removeMany` and `{ _id: { $in } }` turn
 *   the N round trips of a snapshot read, a garbage sweep or a project list
 *   into one each. A free-tier cluster is far away from a function and every
 *   round trip inside a transaction is paid in latency.
 * - **Expiry the database enforces.** Tables whose rows are worthless once
 *   their window passes get a TTL index on a shadow `_expireAt` date (Mongo
 *   only expires real dates; the domain keeps its numeric `expiresAt`). The
 *   opportunistic sweeps stay, for the laptop store and for the 60 s the TTL
 *   monitor may lag.
 * - **A schema version.** Indexes are created once per schema version, not by
 *   twenty `createIndex` calls on every cold start: a cold start reads one
 *   `_meta` document and goes on.
 */
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { GridFSBucket, ObjectId, type ClientSession, type Db, type IndexDescription } from "mongodb";
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
  /** Several rows in one round trip; same semantics as `put` on each. */
  putMany(table: string, rows: Row[]): Promise<void>;
  remove(table: string, id: string): Promise<void>;
  /** Several ids in one round trip; ids that do not exist are ignored. */
  removeMany(table: string, ids: string[]): Promise<void>;
}
/** Metadata transactions and binary storage have separate lifecycles. */
export interface Storage {
  transaction<T>(fn: (data: Data) => Promise<T>): Promise<T>;
  /**
   * Reads that need no transaction. On Mongo a transaction costs a commit
   * round trip even when it only read, and its operations run one at a time
   * on the session; a plain read pays neither, and its queries may run in
   * parallel. Writes inside `read` throw. Optional: a store without it reads
   * in a transaction.
   */
  read?<T>(fn: (data: Data) => Promise<T>): Promise<T>;
  bytes: { put(id: string, bytes: Uint8Array): Promise<void>; get(id: string): Promise<Uint8Array | null>; remove(id: string): Promise<void> };
}
type State = Record<string, Record<string, Row>>;

/** Table names double as directory and collection names. */
const validTable = (table: string) => /^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(table);

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/**
 * Rows that are dead once a time passes, and how long after it the database
 * may delete them. The grace keeps a just-expired row readable for the code
 * that explains *why* something stopped working ("this upload expired"), and
 * covers clock skew between functions. Shares are deliberately absent: an
 * expired link must still say "expired" on /s/<token>, forever.
 */
export const TTL: Record<string, { field: string; graceMs: number }> = {
  presence: { field: "expiresAt", graceMs: HOUR },
  signInAttempts: { field: "resetAt", graceMs: HOUR },
  oauthCodes: { field: "expiresAt", graceMs: HOUR },
  uploads: { field: "expiresAt", graceMs: DAY },
  uploadParts: { field: "expiresAt", graceMs: DAY },
  agentLocks: { field: "expiresAt", graceMs: DAY },
  connectorTokens: { field: "expiresAt", graceMs: 7 * DAY },
};

/**
 * Equality, `$in`, and the two range operators this repository needs: the
 * changes after a revision, and the rows whose window has passed. Written in
 * MongoDB's own shape (`{ $gt: n }`) so the same query object works unchanged
 * against the database - including Mongo's rule that a condition on an array
 * field matches when any element matches (`{ sources: id }`).
 */
function matchesOne(actual: unknown, wanted: unknown): boolean {
  if (wanted && typeof wanted === "object" && !Array.isArray(wanted)) {
    const w = wanted as { $gt?: number; $lte?: number; $in?: unknown[] };
    if ("$in" in w) return Array.isArray(w.$in) && w.$in.includes(actual);
    if ("$gt" in w) return typeof actual === "number" && actual > (w.$gt as number);
    if ("$lte" in w) return typeof actual === "number" && actual <= (w.$lte as number);
  }
  return actual === wanted;
}
function matches(actual: unknown, wanted: unknown): boolean {
  if (Array.isArray(actual)) return actual.some(a => matchesOne(a, wanted));
  return matchesOne(actual, wanted);
}

function project(row: Row, projection: Record<string, 0 | 1>): Row {
  // Mongo's rule: any 1, `_id` included, makes a projection inclusive.
  const inclusive = Object.values(projection).some(value => value === 1);
  return Object.fromEntries(Object.entries(row).filter(([key]) => inclusive
    ? projection[key] === 1 || (key === "_id" && projection._id !== 0)
    : projection[key] !== 0)) as Row;
}

function dataFor(state: State): Data {
  const data: Data = {
    async get<T extends Row>(table: string, id: string): Promise<T | null> { return structuredClone((state[table]?.[id] as T | undefined) ?? null); },
    async list<T extends Row>(table: string, query: Record<string, unknown> = {}, options: ListOptions = {}) {
      let rows = Object.values(state[table] ?? {}).filter(r => Object.entries(query).every(([k, v]) => matches(r[k], v)));
      for (const [key, direction] of Object.entries(options.sort ?? {}).reverse()) {
        rows.sort((a, b) => (a[key] === b[key] ? 0 : (a[key] as number) < (b[key] as number) ? -1 : 1) * direction);
      }
      if (options.limit !== undefined) rows = rows.slice(0, options.limit);
      const projection = options.projection;
      if (projection) rows = rows.map(row => project(row, projection));
      return structuredClone(rows) as T[];
    },
    async put(table, row) { (state[table] ??= {})[row._id] = structuredClone(row); },
    async putMany(table, rows) { for (const row of rows) await data.put(table, row); },
    async remove(table, id) { delete state[table]?.[id]; },
    async removeMany(table, ids) { for (const id of ids) delete state[table]?.[id]; },
  };
  return data;
}
/** A view that refuses writes, so a method mistakenly marked read-only fails loudly in every store. */
export function readOnly(data: Data): Data {
  const refuse = async () => { throw new ServerError(500, "storage", "Write attempted inside a read"); };
  return { get: data.get, list: data.list, put: refuse, putMany: refuse, remove: refuse, removeMany: refuse };
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
  read<T>(fn: (data: Data) => Promise<T>): Promise<T> {
    // Queued behind writes so a test reads what it just wrote, but never commits.
    const result = this.tail.then(() => fn(readOnly(dataFor(this.state))));
    this.tail = result.catch(() => undefined);
    return result;
  }
  /** What a test may inspect: the rows of one table, as stored. */
  rows(table: string): Row[] { return structuredClone(Object.values(this.state[table] ?? {})); }
}

/**
 * Binary fields (compressed snapshot pieces, upload parts) survive the laptop
 * store's JSON files as `{ $b64 }`. The holder is checked rather than the value
 * because a Buffer has already become `{ type: "Buffer" }` by the time a
 * replacer sees it.
 */
function binaryReplacer(this: Record<string, unknown>, key: string, value: unknown) {
  const raw = key === "" ? value : this[key];
  return raw instanceof Uint8Array ? { $b64: Buffer.from(raw).toString("base64") } : value;
}
function binaryReviver(_key: string, value: unknown) {
  return value && typeof value === "object" && typeof (value as { $b64?: unknown }).$b64 === "string" && Object.keys(value).length === 1
    ? new Uint8Array(Buffer.from((value as { $b64: string }).$b64, "base64"))
    : value;
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
      const journal = path.join(this.root, "journal.json");
      const readJson = async (file: string) => {
        try { return JSON.parse(await readFile(file, "utf8"), binaryReviver); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; return null; }
      };
      const apply = async (changed: State) => {
        for (const table of Object.keys(changed)) {
          if (!validTable(table)) throw new Error("Invalid journal table");
          const dir = path.join(this.root, table);
          await mkdir(dir, { recursive: true });
          await writeFile(path.join(dir, "records.tmp"), JSON.stringify(changed[table], binaryReplacer));
          await rename(path.join(dir, "records.tmp"), path.join(dir, "records.json"));
        }
        await rm(journal, { force: true });
      };
      const pending = await readJson(journal) as State | null;
      if (pending) await apply(pending);
      // Tables load on first touch. The old allow-list of table names silently
      // dropped writes to any table it forgot (generationJobs was one); now a
      // table is whatever a valid name the repository asks for.
      const state: State = {};
      const before: Record<string, string> = {};
      const load = async (table: string) => {
        if (!validTable(table)) throw new ServerError(500, "storage", `Invalid table ${table}`);
        if (!(table in state)) {
          state[table] = await readJson(path.join(this.root, table, "records.json")) ?? {};
          before[table] = JSON.stringify(state[table], binaryReplacer);
        }
      };
      const inner = dataFor(state);
      const data: Data = {
        get: async (table, id) => { await load(table); return inner.get(table, id); },
        list: async (table, query, options) => { await load(table); return inner.list(table, query, options); },
        put: async (table, row) => { await load(table); return inner.put(table, row); },
        putMany: async (table, rows) => { await load(table); return inner.putMany(table, rows); },
        remove: async (table, id) => { await load(table); return inner.remove(table, id); },
        removeMany: async (table, ids) => { await load(table); return inner.removeMany(table, ids); },
      };
      const result = await fn(data);
      const changes = Object.fromEntries(Object.keys(state).filter(table => before[table] !== JSON.stringify(state[table], binaryReplacer)).map(table => [table, state[table]]));
      if (Object.keys(changes).length) {
        const temp = path.join(this.root, "journal.tmp");
        await writeFile(temp, JSON.stringify(changes, binaryReplacer));
        await rename(temp, journal);
        await apply(changes);
      }
      return result;
    } finally { await rm(lock, { recursive: true }); }
  }
}

/** The Mongo shape of a row: a TTL table also carries the date its index expires. */
function toMongo(table: string, row: Row): Row {
  const ttl = TTL[table];
  const at = ttl ? row[ttl.field] : undefined;
  return typeof at === "number" ? { ...row, _expireAt: new Date(at + ttl.graceMs) } : row;
}
/** And back: the shadow date is storage's business, never the repository's. */
function fromMongo<T extends Row>(row: T | null): T | null {
  if (row && "_expireAt" in row) delete (row as Row)._expireAt;
  return row;
}

function mongoData(db: Db, session?: ClientSession): Data {
  return {
    async get<T extends Row>(table: string, id: string) { return fromMongo(await db.collection<Row>(table).findOne({ _id: id }, { session }) as T | null); },
    async list<T extends Row>(table: string, query: Record<string, unknown> = {}, options: ListOptions = {}) {
      const cursor = db.collection<Row>(table).find(query, { session, projection: options.projection });
      if (options.sort) cursor.sort(options.sort);
      if (options.limit !== undefined) cursor.limit(options.limit);
      return (await cursor.toArray() as T[]).map(row => fromMongo(row)!);
    },
    async put(table, row) { await db.collection<Row>(table).replaceOne({ _id: row._id }, toMongo(table, row), { upsert: true, session }); },
    async putMany(table, rows) {
      if (!rows.length) return;
      await db.collection<Row>(table).bulkWrite(rows.map(row => ({ replaceOne: { filter: { _id: row._id }, replacement: toMongo(table, row), upsert: true } })), { session, ordered: false });
    },
    async remove(table, id) { await db.collection<Row>(table).deleteOne({ _id: id }, { session }); },
    async removeMany(table, ids) {
      if (!ids.length) return;
      await db.collection<Row>(table).deleteMany({ _id: { $in: ids } }, { session });
    },
  };
}

/**
 * Bumped whenever INDEXES changes. A deployment whose `_meta.schema` is behind
 * creates the indexes (idempotent, so two cold starts racing is harmless) and
 * records the version; one that is current pays a single read per process.
 */
export const SCHEMA_VERSION = 2;
const ttlIndex = (): IndexDescription => ({ key: { _expireAt: 1 }, expireAfterSeconds: 0, name: "ttl_expireAt" });
export const INDEXES: Record<string, IndexDescription[]> = {
  projects: [{ key: { sources: 1 } }, { key: { ownerId: 1 } }],
  versions: [{ key: { projectId: 1, rev: -1 }, unique: true }],
  // The database, not the application, is what finally makes an address one
  // account: two sign-ups racing on the same email both pass an in-transaction
  // lookup, and this index is what makes the loser fail.
  users: [{ key: { emailKey: 1 }, unique: true, sparse: true }],
  signInAttempts: [{ key: { resetAt: 1 } }, ttlIndex()],
  members: [{ key: { userId: 1, projectId: 1 } }, { key: { projectId: 1, addedAt: 1 } }],
  uploads: [{ key: { expiresAt: 1 } }, ttlIndex()],
  uploadParts: [{ key: { uploadId: 1, part: 1 }, unique: true }, ttlIndex()],
  sources: [{ key: { expiresAt: 1 }, sparse: true }],
  "sources.files": [{ key: { filename: 1 } }],
  shares: [{ key: { projectId: 1 } }],
  comments: [{ key: { projectId: 1, createdAt: 1 } }, { key: { projectId: 1, parentId: 1 } }],
  changes: [{ key: { projectId: 1, rev: 1 }, unique: true }, { key: { projectId: 1, changeId: 1 } }],
  presence: [{ key: { projectId: 1 } }, ttlIndex()],
  proposals: [{ key: { projectId: 1, createdAt: -1 } }],
  decisions: [{ key: { projectId: 1, at: 1 } }],
  agentLocks: [{ key: { projectId: 1 } }, ttlIndex()],
  generationJobs: [{ key: { projectId: 1, createdAt: -1 } }],
  // Content-addressed snapshot pieces (lib/server/snapshots.ts). The sweep
  // lists a project's pieces by id only, which this index covers.
  objects: [{ key: { projectId: 1, _id: 1 } }],
  // Every MCP call looks a token up by its hash, so that lookup is the one
  // on the hot path; unique because two rows for one secret would mean one
  // of them survived a revocation.
  connectorTokens: [{ key: { hash: 1 }, unique: true }, { key: { userId: 1, kind: 1, createdAt: -1 } }, { key: { grantId: 1 } }, { key: { expiresAt: 1 } }, ttlIndex()],
  connectorGrants: [{ key: { userId: 1, clientId: 1, createdAt: -1 } }],
  oauthCodes: [{ key: { expiresAt: 1 } }, ttlIndex()],
};

/** Create every index the current schema needs. Exported for `npm run db:migrate`. */
export async function ensureSchema(db: Db, force = false): Promise<{ from: number; to: number }> {
  const meta = db.collection<{ _id: string; version: number; at: Date }>("_meta");
  const from = (await meta.findOne({ _id: "schema" }))?.version ?? 0;
  if (from >= SCHEMA_VERSION && !force) return { from, to: from };
  await Promise.all(Object.entries(INDEXES).map(([table, indexes]) => db.collection(table).createIndexes(indexes)));
  await meta.updateOne({ _id: "schema" }, { $max: { version: SCHEMA_VERSION }, $set: { at: new Date() } }, { upsert: true });
  return { from, to: SCHEMA_VERSION };
}

/** Durable deployment storage; transactions retry competing project writes. */
export class MongoStorage implements Storage {
  private static ready?: Promise<unknown>;
  private schema() {
    return MongoStorage.ready ??= mongoDb().then(db => ensureSchema(db)).catch(error => { MongoStorage.ready = undefined; throw error; });
  }
  async transaction<T>(fn: (data: Data) => Promise<T>): Promise<T> {
    await this.schema();
    const session = (await mongoClient()).startSession();
    try { return await session.withTransaction(async () => fn(mongoData(await mongoDb(), session))); }
    finally { await session.endSession(); }
  }
  async read<T>(fn: (data: Data) => Promise<T>): Promise<T> {
    await this.schema();
    return fn(readOnly(mongoData(await mongoDb())));
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

/** A binary field as bytes, whichever store it came back from. */
export function asBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") return new Uint8Array(Buffer.from(value, "base64"));
  // A BSON Binary: `.buffer` is its bytes.
  const buffer = (value as { buffer?: unknown } | null)?.buffer;
  if (buffer instanceof Uint8Array) return buffer;
  throw new ServerError(500, "storage", "Expected a binary field");
}
