/**
 * Database v2 operations, against the cluster in .env.local (docs/DATABASE_V2.md).
 *
 *   npm run db -- stats              what is stored where, and how much of the free 512 MB it uses
 *   npm run db -- verify             encode every stored snapshot with the v2 codec in memory and
 *                                    prove it reads back byte for byte; writes nothing
 *   npm run db -- migrate            dry run: what migrating would rewrite and save
 *   npm run db -- migrate --apply    create the v2 indexes, back up each v1 version to
 *                                    .backups/<stamp>/, rewrite it as a manifest, sweep
 *   npm run db -- gc                 sweep unreferenced pieces in every project
 *
 * Migrating is optional for correctness - v2 reads v1 rows - and is what
 * returns the space. It works one version per transaction, verifies each
 * rewritten version reads back identical before replacing it, and never
 * deletes a v1 snapshot it has not backed up.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function loadEnv() {
  const text = await readFile(join(process.cwd(), ".env.local"), "utf8").catch(() => "");
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
await loadEnv();

const { mongoClient, mongoDb, hasMongo, DB_NAME } = await import("@/lib/db/mongo");
const { MemoryStorage, MongoStorage, ensureSchema, SCHEMA_VERSION } = await import("@/lib/server/storage");
const { readSnapshot, sweepObjects, writeSnapshot } = await import("@/lib/server/snapshots");

const FREE_TIER_BYTES = 512 * 1024 * 1024;
const mb = (n: number) => `${(n / 1048576).toFixed(2)} MB`;
const [command = "stats", ...flags] = process.argv.slice(2);
const apply = flags.includes("--apply");

if (!hasMongo()) {
  console.error("MONGODB_URI is not set (in .env.local or the environment).");
  process.exit(1);
}
const db = await mongoDb();

async function stats() {
  const s = await db.stats();
  const meta = await db.collection<{ _id: string; version: number }>("_meta").findOne({ _id: "schema" });
  console.log(`database ${DB_NAME}  schema v${meta?.version ?? 0} (code expects v${SCHEMA_VERSION})`);
  console.log(`data ${mb(s.dataSize)}  on disk ${mb(s.storageSize)}  indexes ${mb(s.indexSize)}  = ${((s.dataSize + s.indexSize) / FREE_TIER_BYTES * 100).toFixed(1)}% of the free 512 MB`);
  const rows: [string, number, number][] = [];
  for (const { name } of await db.listCollections().toArray()) {
    const c = await db.command({ collStats: name }).catch(() => null);
    rows.push([name, c?.count ?? 0, c?.size ?? 0]);
  }
  for (const [name, count, size] of rows.sort((a, b) => b[2] - a[2])) console.log(`  ${name.padEnd(22)} ${String(count).padStart(7)} rows ${mb(size).padStart(11)}`);
  const legacy = await db.collection("versions").countDocuments({ snapshot: { $exists: true } });
  const legacyHeads = await db.collection("heads").countDocuments({ snapshot: { $exists: true } });
  console.log(`v1 rows still holding a whole snapshot: ${legacy} versions, ${legacyHeads} heads${legacy + legacyHeads ? "  (npm run db -- migrate)" : ""}`);
}

type AnyRow = { _id: string; projectId: string; snapshot?: Record<string, unknown>; manifest?: unknown };

/** Encode a v1 snapshot with the v2 codec in an isolated store, and read it back. */
async function roundTrip(projectId: string, snapshot: Record<string, unknown>) {
  const scratch = new MemoryStorage();
  const manifest = await scratch.transaction(d => writeSnapshot(d, projectId, snapshot as never, Date.now()));
  const back = await scratch.transaction(d => readSnapshot(d, projectId, manifest));
  return { manifest, same: JSON.stringify(back) === JSON.stringify(snapshot), stored: scratch.rows("objects").reduce((n, r) => n + (r.z as Uint8Array).length, 0) };
}

async function verify() {
  let checked = 0, failed = 0, raw = 0;
  const unique = new Map<string, number>();
  for (const table of ["versions", "heads"]) {
    for await (const row of db.collection<AnyRow>(table).find({ snapshot: { $exists: true } })) {
      const r = await roundTrip(row.projectId, row.snapshot!);
      checked++; raw += JSON.stringify(row.snapshot).length;
      if (!r.same) { failed++; console.log(`  MISMATCH ${table} ${row._id}`); }
      // Pieces are per project, so the true v2 size is the union per project.
      const scratch = new MemoryStorage();
      await scratch.transaction(d => writeSnapshot(d, row.projectId, row.snapshot as never, 0));
      for (const o of scratch.rows("objects")) unique.set(o._id, (o.z as Uint8Array).length);
    }
  }
  const v2 = [...unique.values()].reduce((a, b) => a + b, 0);
  console.log(`verified ${checked} snapshots, ${failed} mismatches. v1 JSON ${mb(raw)} -> v2 pieces ${mb(v2)} (${raw ? (raw / Math.max(v2, 1)).toFixed(0) : 0}x smaller)`);
  if (failed) process.exitCode = 1;
}

async function migrate() {
  if (apply) {
    const r = await ensureSchema(db, true);
    console.log(`indexes: schema v${r.from} -> v${r.to}`);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = join(process.cwd(), ".backups", stamp);
  const storage = new MongoStorage();
  const projects = new Set<string>();
  let rewritten = 0, freed = 0, skipped = 0;
  for (const table of ["versions", "heads"] as const) {
    const ids = await db.collection<AnyRow>(table).find({ snapshot: { $exists: true } }, { projection: { _id: 1, projectId: 1 } }).toArray();
    for (const { _id, projectId } of ids) {
      projects.add(projectId);
      const row = await db.collection<AnyRow>(table).findOne({ _id });
      if (!row?.snapshot) continue;
      const check = await roundTrip(projectId, row.snapshot);
      if (!check.same) { skipped++; console.log(`  skip ${table} ${_id}: would not read back identical`); continue; }
      const size = JSON.stringify(row.snapshot).length;
      if (!apply) { rewritten++; freed += size; continue; }
      await mkdir(backup, { recursive: true });
      await writeFile(join(backup, `${table}-${_id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`), JSON.stringify(row));
      await storage.transaction(async d => {
        const current = await d.get<AnyRow & Record<string, unknown>>(table, _id);
        if (!current?.snapshot) return;
        const manifest = await writeSnapshot(d, projectId, current.snapshot as never, Date.now());
        const back = await readSnapshot(d, projectId, manifest);
        if (JSON.stringify(back) !== JSON.stringify(current.snapshot)) throw new Error(`${_id} did not read back identical`);
        const { snapshot, ...rest } = current;
        void snapshot;
        await d.put(table, { ...rest, manifest });
      });
      rewritten++; freed += size;
      console.log(`  ${table} ${_id}  ${mb(size)} -> manifest`);
    }
  }
  if (apply) await gc([...projects]);
  console.log(`${apply ? "migrated" : "would migrate"} ${rewritten} rows (${mb(freed)} of v1 JSON), skipped ${skipped}.${apply ? ` Backup: ${backup}` : " Run with --apply to do it."}`);
}

async function gc(only?: string[]) {
  const storage = new MongoStorage();
  const ids = only ?? (await db.collection("projects").find({}, { projection: { _id: 1 } }).toArray()).map(p => String(p._id));
  let removed = 0;
  for (const projectId of ids) {
    removed += await storage.transaction(async d => {
      const p = await d.get("projects", projectId);
      if (!p) return 0;
      // The project row is written in the same transaction; see lib/server/snapshots.ts.
      await d.put("projects", { ...p, sweptAt: Date.now() });
      return sweepObjects(d, projectId);
    });
  }
  console.log(`swept ${ids.length} projects, removed ${removed} unreferenced pieces`);
}

try {
  if (command === "stats") await stats();
  else if (command === "verify") await verify();
  else if (command === "migrate") await migrate();
  else if (command === "gc") await gc();
  else { console.error(`Unknown command ${command}. Use stats, verify, migrate [--apply] or gc.`); process.exitCode = 1; }
} finally {
  await (await mongoClient()).close();
}
