/**
 * Loads the project skeleton extracted from a local EcoStruxure installation.
 *
 * Every entry the generated project does not write is copied through verbatim -
 * Recipe.db, Security.db, Language.db, DriverConfig.db and the rest. We are not
 * recreating them; we are starting from the ones the product itself ships.
 *
 * Node only - the export route declares runtime = "nodejs". Run
 * `npm run setup:skeleton` first; the directory is gitignored because those
 * files are Schneider's.
 *
 * On a deployed instance there is no directory: the build comes from a
 * repository that deliberately does not carry Schneider's files, so a generated
 * project would fail to export with "skeleton not found". The skeleton is
 * therefore read from MongoDB when one is configured, having been put there
 * once by `npm run skeleton:upload` from a machine with the product installed -
 * which keeps those files out of the repository and off any public URL while
 * still letting the hosted tool write a project.
 */

import { hasMongo, mongoDb } from "@/lib/db/mongo";

export interface Skeleton {
  /** Entry name (backslash separators, as the product writes them) -> bytes. */
  entries: Map<string, Uint8Array>;
  /** Blank.eote has no screen, so this comes from a shipped sample. */
  localVariables: Uint8Array;
}

interface Manifest {
  source: string;
  localVariablesFrom: string;
  entries: { entry: string; file: string }[];
}

const MISSING =
  "Project skeleton not found. Run `npm run setup:skeleton` on a machine with " +
  "EcoStruxure Operator Terminal Expert 4.4 installed, and " +
  "`npm run skeleton:upload` to make it available to a deployed instance.";

/** The one document the skeleton is kept in; 544KB, well inside the 16MB cap. */
export const SKELETON_DOC = "skeleton";
export const SKELETON_COLLECTION = "skeleton";

interface SkeletonDoc {
  _id: string;
  source: string;
  localVariablesFrom: string;
  entries: { entry: string; bytes: import("mongodb").Binary }[];
  localVariables: import("mongodb").Binary;
  uploadedAt: Date;
}

let cached: Promise<Skeleton> | null = null;

export function loadSkeleton(dir?: string): Promise<Skeleton> {
  if (!dir && cached) return cached;
  const promise = read(dir);
  if (!dir) cached = promise;
  return promise;
}

async function read(dir?: string): Promise<Skeleton> {
  // An explicit directory is always the filesystem - the extract script and
  // the tests pass one. Otherwise the database wins when there is one.
  if (!dir && hasMongo()) {
    const stored = await fromMongo();
    if (stored) return stored;
  }
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const root = dir ?? path.join(process.cwd(), "skeleton");

  let manifest: Manifest;
  try {
    manifest = JSON.parse(
      await fs.readFile(path.join(root, "manifest.json"), "utf8"),
    );
  } catch {
    throw new Error(MISSING);
  }

  const entries = new Map<string, Uint8Array>();
  for (const { entry, file } of manifest.entries) {
    entries.set(entry, await fs.readFile(path.join(root, "entries", file)));
  }

  return {
    entries,
    localVariables: await fs.readFile(path.join(root, "LocalVariables.db")),
  };
}

/** The skeleton as stored by `npm run skeleton:upload`, or null when none is. */
async function fromMongo(): Promise<Skeleton | null> {
  const collection = (await mongoDb()).collection<SkeletonDoc>(SKELETON_COLLECTION);
  const doc = await collection.findOne({ _id: SKELETON_DOC });
  if (!doc) return null;
  return {
    entries: new Map(doc.entries.map((e) => [e.entry, new Uint8Array(e.bytes.buffer)])),
    localVariables: new Uint8Array(doc.localVariables.buffer),
  };
}

/** Where the skeleton came from, for the status bar and the setup page. */
export async function skeletonSource(): Promise<"mongo" | "filesystem" | "missing"> {
  if (hasMongo()) {
    const found = await fromMongo().catch(() => null);
    if (found) return "mongo";
  }
  try {
    await read();
    return "filesystem";
  } catch {
    return "missing";
  }
}
