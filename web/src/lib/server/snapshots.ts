/**
 * Snapshots as content-addressed, compressed pieces (Database v2).
 *
 * Before v2 every version and the live head held the whole project as one
 * BSON document. Measured on the production cluster (2026-11-04): 179 versions
 * were 76.7 MB of a 78.6 MB database, the largest project's 19 versions were
 * 34.6 MB, one version was 3 MB, and the same screens were stored again in
 * every one of them. On a 512 MB free cluster that is a ceiling of a few dozen
 * real projects, and a 16 MB BSON cap one large plant away.
 *
 * Now a snapshot is a small manifest. Each top-level field is a piece; the two
 * that hold most of the bytes and change one element at a time (`screens` and
 * the client's own `versions` list) are a piece per element. A piece is keyed
 * by the SHA-256 of its JSON and stored once per project, brotli-compressed, in
 * `objects`. A save that changed one screen writes one piece and a manifest;
 * a read fetches every piece of a manifest in one `$in` query. The same data
 * measured 0.56 MB this way, about 60x smaller.
 *
 * Pieces are scoped to their project (`<projectId>:<hash>`) so deleting a
 * project is one range delete and a sweep never has to ask another project
 * what it still needs. Cross-project sharing would save little: two projects
 * rarely share a screen byte for byte.
 *
 * Garbage is collected by mark and sweep inside a transaction that also writes
 * the project row. That write is what makes the sweep safe: a concurrent save
 * that reused a piece the sweep thought orphaned also writes the project row,
 * so the two transactions conflict and one of them retries.
 */
import { createHash } from "node:crypto";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import { ServerError } from "./errors";
import { asBytes, type Data, type Row } from "./storage";
import type { Snapshot } from "./repo";

export const OBJECTS = "objects";
/** Fields stored a piece per element; everything else is one piece per field. */
const SPLIT = new Set(["screens", "versions"]);
/** A field this small is kept in the manifest rather than as a piece. */
const INLINE_BYTES = 512;

/** One field of a snapshot: inline JSON, a piece, or a list of pieces. */
export type Ref = { j: string } | { h: string } | { a: string[] };
/** What a version or head stores in place of its snapshot. `n` is the raw JSON size, for statistics. */
export interface Manifest { f: 1; k: Record<string, Ref>; n: number }
export type ObjectRow = Row & { projectId: string; z: Uint8Array; n: number; at: number };
/** Either shape a stored version or head may have; pre-v2 rows hold `snapshot`. */
export interface Stored { snapshot?: Snapshot; manifest?: Manifest }

const hashOf = (json: string) => createHash("sha256").update(json).digest("base64url");
export const objectId = (projectId: string, hash: string) => `${projectId}:${hash}`;

/** Quality 5: within a few percent of brotli's best on project JSON, and about 20x faster. */
const compress = (json: string) => new Uint8Array(brotliCompressSync(Buffer.from(json), { params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_SIZE_HINT]: json.length } }));
const decompress = (z: unknown) => brotliDecompressSync(asBytes(z)).toString("utf8");

/** Every piece a manifest refers to. */
export function hashesOf(manifest: Manifest): string[] {
  const out: string[] = [];
  for (const ref of Object.values(manifest.k)) {
    if ("h" in ref) out.push(ref.h);
    else if ("a" in ref) out.push(...ref.a);
  }
  return out;
}

/**
 * Store a snapshot's pieces and answer its manifest. Only pieces the project
 * does not already hold are compressed and written, so an unchanged save costs
 * hashing and one existence query.
 */
export async function writeSnapshot(d: Data, projectId: string, snapshot: Snapshot, now: number): Promise<Manifest> {
  const pieces = new Map<string, string>();
  const k: Record<string, Ref> = {};
  let n = 0;
  const piece = (json: string) => { const h = hashOf(json); pieces.set(h, json); return h; };
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) continue;
    if (SPLIT.has(key) && Array.isArray(value)) {
      k[key] = { a: value.map(item => { const json = JSON.stringify(item) ?? "null"; n += json.length; return piece(json); }) };
      continue;
    }
    const json = JSON.stringify(value);
    n += json.length;
    k[key] = json.length <= INLINE_BYTES ? { j: json } : { h: piece(json) };
  }
  if (pieces.size) {
    const ids = [...pieces.keys()].map(h => objectId(projectId, h));
    const held = new Set((await d.list(OBJECTS, { _id: { $in: ids } }, { projection: { _id: 1 } })).map(row => row._id));
    const rows: ObjectRow[] = [];
    for (const [h, json] of pieces) {
      const id = objectId(projectId, h);
      if (!held.has(id)) rows.push({ _id: id, projectId, z: compress(json), n: json.length, at: now });
    }
    await d.putMany(OBJECTS, rows);
  }
  return { f: 1, k, n };
}

/** Rebuild a snapshot from its manifest, fetching every piece in one query. */
export async function readSnapshot(d: Data, projectId: string, manifest: Manifest): Promise<Snapshot> {
  const wanted = [...new Set(hashesOf(manifest))];
  const json = new Map<string, string>();
  if (wanted.length) {
    const rows = await d.list<ObjectRow>(OBJECTS, { _id: { $in: wanted.map(h => objectId(projectId, h)) } });
    for (const row of rows) json.set(row._id.slice(projectId.length + 1), decompress(row.z));
  }
  const take = (h: string) => {
    const text = json.get(h);
    if (text === undefined) throw new ServerError(500, "corrupt", `Project ${projectId} is missing a stored piece (${h.slice(0, 12)})`);
    return JSON.parse(text);
  };
  const out: Record<string, unknown> = {};
  for (const [key, ref] of Object.entries(manifest.k)) {
    out[key] = "j" in ref ? JSON.parse(ref.j) : "h" in ref ? take(ref.h) : ref.a.map(take);
  }
  return out as Snapshot;
}

/** A stored version's or head's snapshot, whichever format it was written in. */
export async function loadStored(d: Data, projectId: string, row: Stored): Promise<Snapshot> {
  if (row.manifest) return readSnapshot(d, projectId, row.manifest);
  if (row.snapshot) return row.snapshot;
  throw new ServerError(500, "corrupt", `Project ${projectId} has a version with no snapshot`);
}

/**
 * Remove the pieces no version and no head of the project refers to. Call it
 * only inside a transaction that writes the project row (see the header).
 * Answers how many pieces went.
 */
export async function sweepObjects(d: Data, projectId: string): Promise<number> {
  const keep = new Set<string>();
  const mark = (row: Stored | null) => { if (row?.manifest) for (const h of hashesOf(row.manifest)) keep.add(objectId(projectId, h)); };
  for (const v of await d.list<Row & Stored>("versions", { projectId }, { projection: { manifest: 1 } })) mark(v);
  mark(await d.get<Row & Stored>("heads", projectId));
  const orphans = (await d.list(OBJECTS, { projectId }, { projection: { _id: 1 } })).map(row => row._id).filter(id => !keep.has(id));
  await d.removeMany(OBJECTS, orphans);
  return orphans.length;
}
