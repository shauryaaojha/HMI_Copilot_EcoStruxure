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
 */

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
  "EcoStruxure Operator Terminal Expert 4.4 installed.";

let cached: Promise<Skeleton> | null = null;

export function loadSkeleton(dir?: string): Promise<Skeleton> {
  if (!dir && cached) return cached;
  const promise = read(dir);
  if (!dir) cached = promise;
  return promise;
}

async function read(dir?: string): Promise<Skeleton> {
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
