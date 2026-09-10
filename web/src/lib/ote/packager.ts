/**
 * Project tree -> .eote.
 *
 * Two traps, both already paid for once in the Python reference implementation:
 *
 *  1. ZIP entry names use BACKSLASH separators, the way the product writes them.
 *     Python's zipfile silently rewrites them; jszip does not, but the assertion
 *     in assertBackslashEntries() checks the produced bytes rather than trusting
 *     either library, because a name list can normalise on read.
 *
 *  2. Quote every SQL column - see databases.ts.
 *
 * Most databases (Recipe, Security, Language...) are copied verbatim from the
 * Blank.eote skeleton; only Variables.db, Alarm.db and the screens are written.
 * The skeleton is Schneider's, extracted locally by scripts/extract-skeleton.mjs
 * and never committed.
 *
 * Phase 1 of docs/BUILD_PLAN.md - the gate for everything downstream.
 */

import JSZip from "jszip";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import {
  writeAlarms,
  writeVariables,
  type AlarmTarget,
  type VariableIds,
} from "./databases";
import { buildGraph, type Wire } from "./bindings";
import { gid } from "./parts";
import type { Alarm, Screen, Variable } from "./schema";
import { loadSkeleton, type Skeleton } from "./skeleton";

export interface PackageInput {
  name: string;
  target: { model: string; width: number; height: number };
  screens: Screen[];
  variables: Variable[];
  alarms: Alarm[];
  /** Which tag drives which part property. */
  wires: Wire[];
}

/** The product writes its .dat files as UTF-8 JSON indented by two spaces. */
function jsonEntry(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2));
}

let sqlPromise: Promise<SqlJsStatic> | null = null;

/**
 * Finds sql-wasm.wasm on disk.
 *
 * Not via `locateFile` + `require.resolve`: inside a webpack bundle `require` is
 * webpack's own and `import.meta.url` is not a real path, so that resolves to
 * nothing and sql.js fails at runtime with a minified error - which passes every
 * test, because vitest runs the source unbundled. Reading the bytes ourselves
 * and handing them over as `wasmBinary` sidesteps the whole question.
 */
async function loadWasm(): Promise<Buffer> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { createRequire } = await import("node:module");

  const candidates: string[] = [];
  try {
    // Resolve from the app root rather than from this module's bundled location.
    const resolve = createRequire(path.join(process.cwd(), "package.json"));
    candidates.push(path.join(path.dirname(resolve.resolve("sql.js")), "sql-wasm.wasm"));
  } catch {
    // fall through to the literal path
  }
  candidates.push(path.join(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm"));

  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate);
    } catch {
      continue;
    }
  }
  throw new Error(
    `sql-wasm.wasm not found. Looked in:\n  ${candidates.join("\n  ")}`,
  );
}

/**
 * sql.js is WebAssembly, so this needs the Node runtime - Edge cannot serve the
 * .wasm. There is still no native module, so it deploys anywhere Node runs.
 */
async function sql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      const wasmBinary = await loadWasm();
      // `wasmBinary` is an Emscripten module option that sql.js's own types
      // do not surface, so the cast is the honest way to say it.
      return initSqlJs({ wasmBinary } as unknown as Parameters<typeof initSqlJs>[0]);
    })();
  }
  return sqlPromise;
}

/** Runs `mutate` against a template database and returns the modified bytes. */
async function editDatabase<T>(
  template: Uint8Array,
  mutate: (db: import("sql.js").Database) => T,
): Promise<{ bytes: Uint8Array; result: T }> {
  const SQL = await sql();
  const db = new SQL.Database(template);
  try {
    const result = mutate(db);
    return { bytes: db.export(), result };
  } finally {
    db.close();
  }
}

/**
 * The product refuses an archive whose nested entries use forward slashes.
 * Asserted against the raw bytes, not against jszip's own name list.
 */
export function assertBackslashEntries(bytes: Uint8Array): void {
  const text = Buffer.from(bytes).toString("latin1");
  if (!text.includes("Screens\\")) {
    throw new Error("packaged archive has no backslash-separated Screens entry");
  }
  if (text.includes("Screens/")) {
    throw new Error(
      "packaged archive contains forward-slash entry names; OTE will reject it",
    );
  }
}

export async function packageProject(
  input: PackageInput,
  skeleton?: Skeleton,
): Promise<Uint8Array> {
  const base = skeleton ?? (await loadSkeleton());
  const entries = new Map<string, Uint8Array>(base.entries);

  // --- tags ---------------------------------------------------------------
  const variablesTemplate = entries.get("Variables.db");
  if (!variablesTemplate) throw new Error("skeleton has no Variables.db");
  const written = await editDatabase(variablesTemplate, (db) =>
    writeVariables(db, input.variables),
  );
  entries.set("Variables.db", written.bytes);
  const variableIds: VariableIds = written.result;

  // --- alarms -------------------------------------------------------------
  let alarmTargets: AlarmTarget[] = [];
  if (input.alarms.length > 0) {
    const alarmTemplate = entries.get("Alarm.db");
    if (!alarmTemplate) throw new Error("skeleton has no Alarm.db");
    const result = await editDatabase(alarmTemplate, (db) =>
      writeAlarms(db, input.alarms),
    );
    entries.set("Alarm.db", result.bytes);
    alarmTargets = result.result;
  }

  // --- screens ------------------------------------------------------------
  const hierarchy: { ObjectId: string; Children: [] }[] = [];

  input.screens.forEach((screen, index) => {
    const id = screen.UniqueId;
    hierarchy.push({ ObjectId: id, Children: [] });
    entries.set(`Screens\\${id}\\Screen.dat`, jsonEntry(screen));
    entries.set(
      `Screens\\${id}\\Metadata.dat`,
      jsonEntry({
        LayoutType: 8,
        Id: index + 1,
        ObjectType: 9,
        Name: screen.Name,
        Order: index,
      }),
    );
    entries.set(`Screens\\${id}\\LocalVariables.db`, base.localVariables);
  });

  entries.set("Screens\\Hierarchy.dat", jsonEntry(hierarchy));

  // --- bindings -----------------------------------------------------------
  const firstScreen = input.screens[0];
  if (!firstScreen) throw new Error("a project needs at least one screen");
  entries.set(
    "Bindings.dat",
    jsonEntry(buildGraph(firstScreen.UniqueId, input.wires, variableIds, alarmTargets)),
  );

  if (!entries.has("GlobalScripts.dat")) {
    entries.set("GlobalScripts.dat", new TextEncoder().encode("[]"));
  }

  // --- project identity ---------------------------------------------------
  const projectEntry = entries.get("Project.dat");
  if (!projectEntry) throw new Error("skeleton has no Project.dat");
  const project = JSON.parse(Buffer.from(projectEntry).toString("utf8"));
  project.UniqueId = gid();
  project.RuntimeProjectId = gid();
  project.ModifiedDateTime = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  project.VersionModified = "4.4.0.0";
  entries.set("Project.dat", jsonEntry(project));

  // --- pack ---------------------------------------------------------------
  const zip = new JSZip();
  for (const [name, data] of entries) {
    // createFolders would insert forward-slash directory entries of its own.
    zip.file(name, data, { createFolders: false, binary: true });
  }

  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  assertBackslashEntries(bytes);
  return bytes;
}
