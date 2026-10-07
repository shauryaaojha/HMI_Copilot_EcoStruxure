/**
 * Where an opened .eote lives between being opened and being exported.
 *
 * Exporting a project that was opened from a file writes back into *that
 * file's* own entries, so everything the reader did not model comes back
 * byte-identical (docs/PLAN_PHASE1.md). That means the original bytes have to
 * survive the round trip from the import request to the export request.
 *
 * On a laptop that was a file under `.imports/`. On Vercel it cannot be:
 * functions are stateless and ephemeral, so the directory the import wrote to
 * is simply not there when the export runs, and the download fails with "the
 * file this project was opened from is no longer on this machine" on every
 * deployed instance.
 *
 * So: MongoDB when `MONGODB_URI` is set, the filesystem when it is not. The
 * app keeps working on a machine with no database, and the deployed instance
 * works at all. Which one is in use is reported, because an engineer deserves
 * to know where their project file went.
 *
 * Two things the serverless shape forces:
 *
 * - **One client, cached on `globalThis`.** A new MongoClient per invocation
 *   opens a new pool, and a free-tier cluster runs out of connections long
 *   before it runs out of storage.
 * - **A TTL index.** These are other people's project files. They are kept
 *   long enough to finish an edit and no longer.
 */

import type { Collection } from "mongodb";
import { hasMongo, mongoDb } from "@/lib/db/mongo";

/** Filesystem fallback, relative to the app root. Gitignored; never uploaded. */
export const IMPORT_DIR = ".imports";

/**
 * The directory the fallback writes to. The app root on a laptop; the only
 * writable place on a serverless instance, where the app root is read-only and
 * mkdir fails with ENOENT. That copy lives as long as the instance does, so a
 * deployment should set MONGODB_URI - but opening a project no longer crashes.
 */
async function importDir(): Promise<string> {
  const path = await import("node:path");
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const os = await import("node:os");
    return path.join(os.tmpdir(), IMPORT_DIR);
  }
  return path.join(process.cwd(), IMPORT_DIR);
}

/** How long an opened file is kept before it is deleted for us. */
export const IMPORT_TTL_SECONDS = 24 * 60 * 60;

const COLLECTION = "imports";

interface ImportDoc {
  _id: string;
  bytes: import("mongodb").Binary;
  fileName: string;
  createdAt: Date;
}

export type StoreKind = "mongo" | "filesystem";

/** Which store is in use, for the import response and the status bar. */
export const importStore = (): StoreKind => (hasMongo() ? "mongo" : "filesystem");

/** The collection, with its TTL index ensured once per process. */
let indexed: Promise<void> | undefined;
async function imports(): Promise<Collection<ImportDoc>> {
  const collection = (await mongoDb()).collection<ImportDoc>(COLLECTION);
  // createIndex is idempotent, and one call per process is cheap. If it
  // fails - a read-only user, say - storing still works and the documents
  // simply are not swept, which is better than refusing the import.
  indexed ??= collection
    .createIndex({ createdAt: 1 }, { expireAfterSeconds: IMPORT_TTL_SECONDS })
    .then(() => undefined)
    .catch(() => undefined);
  await indexed;
  return collection;
}

/**
 * Keep an opened file and return the handle the export will ask for.
 *
 * A document is capped at 16MB by BSON. An .eote is JSON and SQLite inside a
 * ZIP - ours run to tens of kilobytes and a large plant should be a few
 * megabytes - so the cap is checked rather than worked around: a file that
 * does not fit is refused with a reason, not stored truncated.
 */
export async function putImport(bytes: Uint8Array, fileName: string): Promise<string> {
  const id = crypto.randomUUID();

  if (!hasMongo()) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = await importDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${id}.eote`), bytes);
    return id;
  }

  if (bytes.length > 15_000_000) {
    throw new Error(
      `This project is ${(bytes.length / 1048576).toFixed(1)}MB; a single stored document holds 16MB. ` +
        "Open it on a machine running the tool locally, where the file stays on disk.",
    );
  }
  const { Binary } = await import("mongodb");
  const collection = await imports();
  await collection.insertOne({ _id: id, bytes: new Binary(bytes), fileName, createdAt: new Date() });
  return id;
}

/** The bytes of an opened file, or null when the handle is unknown or expired. */
export async function getImport(id: string): Promise<Uint8Array | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

  if (!hasMongo()) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const file = await fs.readFile(path.join(await importDir(), `${id}.eote`)).catch(() => null);
    return file ? new Uint8Array(file) : null;
  }

  const collection = await imports();
  const found = await collection.findOne({ _id: id });
  return found ? new Uint8Array(found.bytes.buffer) : null;
}

/** What to tell an engineer whose opened file is gone. */
export const importGoneMessage = (store: StoreKind = importStore()) =>
  store === "mongo"
    ? "The file this project was opened from is no longer stored - an opened project is kept for 24 hours. Open it again to export into it."
    : "The file this project was opened from is no longer on this machine. Open it again to export into it.";
