# Database v2

Branch `feat/database-engineering`, 2026-11-04. Free tiers only: MongoDB Atlas M0 (512 MB) for data, Supabase Free for Realtime only, Vercel Hobby for functions. The decision to keep data in Mongo stands; v2 changes how the data is stored, not where.

## 1. What the audit found

Measured on the production cluster `hmi_copilot` on 2026-11-04:

| | |
|---|---|
| Data size | 78.6 MB (15% of the free 512 MB) for **22 projects and 1 user** |
| `versions` | 179 rows, **76.7 MB = 97.6% of the database**, avg 428 KB per row |
| Largest project | 19 versions = 34.6 MB; one version = 3.0 MB |
| Inside that 2.9 MB snapshot | `versions` (the client's own history list) 2.3 MB, `screens` 330 KB, `objectMeta` 92 KB |

At that rate the free cluster holds about 15 heavy projects, and a large plant hits the 16 MB BSON document cap and can no longer be saved.

Root causes and other defects:

1. **Every version and the live head was a full copy of the project.** 50 versions meant 50 copies of screens that had not changed. The live head was rewritten whole on every change batch, so a 3 MB project wrote 3 MB per edit.
2. **Polls read the whole project.** `live.since` loaded the head snapshot just to learn the revision, on every poll.
3. **N+1 queries.** `projects.list` did one read per membership; `sourceInfo` walked every project the user is in.
4. **Full-collection scans on every upload.** `uploads.sweep` listed every upload and every source ever stored.
5. **No index for the live log's retry check** (`changes` by `projectId + changeId`).
6. **20 `createIndex` calls on every cold start.**
7. **Laptop-store data loss.** `FileStorage` kept an allow-list of table names and silently dropped writes to tables missing from it. `generationJobs` was missing.
8. **Test store was lenient where Mongo is strict.** `{ _id: 1 }` projections returned whole rows in `MemoryStorage`, so tests never saw what Mongo returns.
9. **Upload parts stored as base64**, so a 4 MB part took 5.3 MB of BSON.
10. **Expired rows only went away when someone happened to write.** Presence, OAuth codes, sign-in counters, locks and tokens had no TTL.

## 2. The design

### 2.1 Snapshots as content-addressed pieces (`src/lib/server/snapshots.ts`)

A version or head now stores a small **manifest** instead of the snapshot:

```
manifest = { f: 1, n: <raw bytes>, k: { name: {j:"\"Station\""}, screens: {a:[h1,h2,…]}, variables: {h:h3}, … } }
objects  = { _id: "<projectId>:<sha256>", projectId, z: <brotli bytes>, n, at }
```

- Each top-level field is one piece. `screens` and the client's `versions` list are one piece per element, because they hold most of the bytes and change one element at a time. Fields of 512 bytes or less stay inline.
- A piece's key is the SHA-256 of its JSON. It is stored once per project, brotli-compressed at quality 5.
- A save hashes every piece, asks in one `$in` query which pieces already exist, and writes only the new ones. An unchanged screen costs nothing.
- A read fetches every piece of a manifest in one `$in` query.
- Pieces are scoped to their project, so deleting a project is a range delete and a sweep never has to check another project.

**Garbage collection** is mark and sweep (`sweepObjects`). It marks every piece referenced by the project's versions and head, then deletes the rest. It runs inside a transaction that also writes the project row: on a save that trimmed history or superseded a head, and at every live checkpoint (at most every 10 minutes). Writing the project row is what makes the sweep safe. A concurrent save that reused a piece also writes that row, so Mongo sees a write conflict and retries one of them.

**Compatibility:** v1 rows (`snapshot` field) are still read everywhere (`loadStored`). v2 only writes manifests. Migration is optional for correctness and is what gives the space back.

### 2.2 Storage primitives (`src/lib/server/storage.ts`)

- `putMany` / `removeMany` (Mongo `bulkWrite` / `deleteMany`) and `$in` queries replace N round trips with one.
- The memory and file stores match Mongo semantics: `$in`, array-contains matching (`{ sources: id }`), and inclusive `{ _id: 1 }` projections.
- **TTL that the database enforces.** Rows in `presence`, `signInAttempts`, `oauthCodes`, `uploads`, `uploadParts`, `agentLocks` and `connectorTokens` get a shadow `_expireAt` date (the numeric expiry plus a grace period) and a TTL index. Code never sees the field. Shares are left out on purpose, because an expired link must keep saying "expired".
- **Schema version.** All indexes are declared in `INDEXES`. A cold start reads one `_meta` document and creates indexes only when `SCHEMA_VERSION` has moved.
- **Laptop store.** Tables load lazily on first use, any valid table name persists, and binary fields go through JSON as `{ $b64 }`.

### 2.3 Queries

- `projects.list`: one membership query plus one `$in` query.
- `projects.referencing(sourceId)` (multikey index on `projects.sources`) replaces the walk over all of a user's projects in `sourceInfo`.
- `latest()` is lazy: `since` answers an up-to-date poll from the revision alone and loads the snapshot only to send a reset.
- `uploads.sweep` is index-backed and pages 50 rows at a time.
- Upload parts are stored as bytes; base64 parts written before v2 still complete.

### 2.4 API request paths

In v1 every repository call was its own Mongo transaction, reads included. A read-only transaction still costs a commit round trip, and its queries run one at a time on the session. On top of that, every access check read the project twice in three separate transactions.

- **`Storage.read`.** Pure reads run outside a transaction, so their queries can run in parallel. Writes inside `read` throw, in every store. This covers users, projects, versions, members, shares, comments, proposals, locks, jobs, the connector's token lookup, `live.since` and `live.at`. A snapshot read that loses a race with a sweep (`corrupt`) is retried once in a transaction.
- **`projects.access(projectId, userId)`** reads the project and the membership in parallel. `requireAccess`, `requireReader` and `accessOf` each make one call. `requireReader` also returns the project, so `GET /api/projects/[id]` doesn't read it again.
- **Heartbeat** (`POST /presence`, every 5 s per open project, the busiest write in the app): `live.presence.beat` does the put and the list in one transaction.
- **`GET /api/projects`** no longer runs an access check per project. The list comes from memberships, and every role can read.
- **Live edit:** a batch's retry check is one `$in` query, not one per change. Log rows go in with one `putMany`, and trimming is one `removeMany`. `latest()` skips the version read when the head is newer. The checkpoint clock lives on the project row (`checkpointAt`).

Measured against Atlas from a laptop (Mumbai), on a scratch database with the same code paths. These are DB commands per request, median of 5:

| Request | v1 (main) | v2 | v1 ms | v2 ms |
|---|---|---|---|---|
| Presence heartbeat | 10 | 5 | 336 | 127 |
| Open project | 12 | 6 | 639 | 157 |
| Changes poll | 10 | 5 | 330 | 128 |
| Live edit (incl. access and current) | 20 | 16 | 935 | 560 |
| List 10 projects | 52 | 2 | 2386 | 63 |
| MCP token lookup | 2 | 1 | 65 | 32 |

A Vercel function sits closer to the cluster than this laptop, so absolute times there are lower. The command counts are the same.

### 2.5 Connection (`src/lib/db/mongo.ts`)

There is one pool per process (`maxPoolSize: 5`, `maxIdleTimeMS: 60s`, `appName`). On Vercel it uses `attachDatabasePool` from `@vercel/functions`, so idle connections close before Fluid compute suspends an instance. A failed connect is no longer cached forever.

## 3. Numbers

`npm run db -- verify` re-encodes every stored production snapshot with the v2 codec in memory and checks the result reads back byte for byte. It writes nothing.

```
verified 180 snapshots, 0 mismatches. v1 JSON 68.30 MB -> v2 pieces 1.88 MB (36x smaller)
```

| | v1 | v2 |
|---|---|---|
| Today's 22 projects | 76.7 MB | ~1.9 MB |
| Heaviest project, 19 versions | 34.6 MB | ~0.6 MB |
| Free-tier capacity, heavy projects | ~15 | ~500+ |
| Bytes written per save that changes one screen | whole project (≤3 MB) | one compressed screen (~5-20 KB) + manifest |
| Bytes read by an up-to-date poll | whole head | head row (<4 KB) |
| Largest project that can be saved | 16 MB of JSON | no practical cap (16 MB per *compressed* piece) |

CPU cost on the heaviest real snapshot (2.88 MB, 31 pieces, laptop): 125 ms for the first write (hash and compress everything), 29 ms to re-save it unchanged (hash only), 68 ms to read. In v1 each of these moved 2.9 MB of BSON over the network to Atlas.

## 4. Rollout

v1 code cannot read manifest rows. Order matters:

1. **Merge and deploy v2 first.** Until then, don't open a Preview deployment of this branch against the production `MONGODB_URI`: v2 would write manifests that the deployed v1 cannot read.
2. After deploy, the first request creates the v2 indexes (`_meta.schema = 2`).
3. `npm run db -- migrate` (dry run), then `npm run db -- migrate --apply`. It backs up every v1 row to `web/.backups/<stamp>/` (gitignored), rewrites the row one transaction at a time, verifies each read-back before replacing, and sweeps.
4. `npm run db -- stats` to confirm.

Rollback: before step 3, redeploy v1. Any manifest rows written in between need v2 to read, so keep the v2 codec deployed or restore from the backups.

## 5. Not done, and why

- **Source bytes dedup (GridFS by SHA-256).** Sources are 1 MB today. Reference-counted deletion of shared blobs has a sweep/upload race that needs a grace period to get right. Revisit when sources pass ~50 MB.
- **Moving opened-file imports into `sources`.** `lib/ote/imports.ts` is a second store with a 15 MB cap. Merging it touches six routes. Low value at today's file sizes.
- **Moving data to Supabase Postgres.** Free projects pause after a week of inactivity, the free database is 500 MB (no more than Atlas), and the move would mean rewriting every repository for no capacity gain.
- **`$jsonSchema` validators.** Without monitoring, a validator that rejects a legitimate write is an outage nobody sees on the free tier. Domain invariants stay in the repository, which the test suite covers.

## 6. Files

| File | Role |
|---|---|
| `src/lib/server/snapshots.ts` | codec, manifest, sweep (new) |
| `src/lib/server/storage.ts` | batch ops, TTL shadow field, schema version, laptop-store fix |
| `src/lib/server/repo.ts`, `repo-live.ts` | versions and heads on manifests; queries |
| `src/lib/server/access.ts` | `sourceInfo` through `projects.referencing` |
| `src/lib/db/mongo.ts` | pool tuning, `attachDatabasePool` |
| `scripts/db.mts` | `npm run db -- stats \| verify \| migrate [--apply] \| gc` |
| `tests/database-v2.test.ts` | codec, dedup, sweep, v1 compatibility, live head, queries, laptop store |
