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

/**
 * Written out as an escape rather than inline, because "Contents\Hierarchy.dat"
 * in a TS string is \H - not an escape, so the backslash is simply dropped and
 * the entry silently becomes "ContentsHierarchy.dat". Every nested entry name in
 * this file goes through a named constant or a template with \\ for that reason.
 */
const CONTENTS_HIERARCHY = "Contents\\Hierarchy.dat";
const SCREENS_HIERARCHY = "Screens\\Hierarchy.dat";

/** `Screens\<guid>\<file>` - the only place a screen entry name is built. */
const screenEntry = (id: string, file: string) => `Screens\\${id}\\${file}`;

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

/**
 * Catches a separator that was eaten rather than mistyped.
 *
 * "Contents\Hierarchy.dat" in a TS string literal is \H, which is not an escape,
 * so the backslash is dropped and the entry becomes "ContentsHierarchy.dat" - a
 * name the product does not know, written without any error. A forward slash
 * would at least be visible; this one is silent.
 *
 * Checked by exact name rather than by pattern: the skeleton legitimately
 * contains flat entries like "ScreensFolder.dat" that a prefix rule would
 * accuse.
 */
function assertEntriesPresent(
  entries: Map<string, Uint8Array>,
  expected: string[],
): void {
  for (const name of expected) {
    if (!entries.has(name)) {
      throw new Error(
        `expected entry "${name}" is missing from the package. ` +
          "A dropped backslash is the usual cause - check the string literal.",
      );
    }
  }
  for (const name of entries.keys()) {
    if (name.includes("/")) {
      throw new Error(`entry "${name}" uses a forward slash separator`);
    }
  }
}

export interface Panel {
  model: string;
  width: number;
  height: number;
}

/** The panel a skeleton is actually for, read out of its Target.dat. */
export function readPanel(target: unknown): Panel | null {
  const info = (target as { TargetInfo?: Record<string, unknown> })?.TargetInfo;
  const raw = String(info?.Resolution ?? "");
  const match = raw.match(/(\d+)\s*x\s*(\d+)/i);
  if (!match) return null;
  return {
    model: String(info?.RuntimeModel ?? "unknown"),
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

/** Reads the panel from a skeleton without packaging anything. */
export async function panelOf(skeleton?: Skeleton): Promise<Panel | null> {
  const base = skeleton ?? (await loadSkeleton());
  const entry = base.entries.get("Target.dat");
  if (!entry) return null;
  return readPanel(JSON.parse(Buffer.from(entry).toString("utf8")));
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
    entries.set(screenEntry(id, "Screen.dat"), jsonEntry(screen));
    entries.set(
      screenEntry(id, "Metadata.dat"),
      jsonEntry({
        LayoutType: 8,
        Id: index + 1,
        ObjectType: 9,
        Name: screen.Name,
        Order: index,
      }),
    );
    entries.set(screenEntry(id, "LocalVariables.db"), base.localVariables);
  });

  entries.set(SCREENS_HIERARCHY, jsonEntry(hierarchy));

  // --- bindings -----------------------------------------------------------
  const firstScreen = input.screens[0];
  if (!firstScreen) throw new Error("a project needs at least one screen");
  entries.set(
    "Bindings.dat",
    jsonEntry(buildGraph(firstScreen.UniqueId, input.wires, variableIds, alarmTargets)),
  );

  // Blank.eote carries neither of these, but every shipped sample project does,
  // and OTE creates Contents\Hierarchy.dat itself on first save when it is
  // absent - so write what a real project looks like rather than making the
  // product repair ours.
  const empty = new TextEncoder().encode("[]");
  if (!entries.has("GlobalScripts.dat")) entries.set("GlobalScripts.dat", empty);
  if (!entries.has(CONTENTS_HIERARCHY)) entries.set(CONTENTS_HIERARCHY, empty);

  // --- target panel -------------------------------------------------------
  // Target.dat is the authority, not input.target: RuntimeModel and Resolution
  // have to agree with each other, and inventing a model string would produce a
  // project the product cannot map to real hardware.
  //
  // A disagreement is reported by validateProject and surfaced on the export
  // response, not thrown here. Layout comes from the ViewBox, so a wrong label
  // does not corrupt the file - and failing an export over metadata would take
  // the demo down for a caption.
  if (!entries.has("Target.dat")) throw new Error("skeleton has no Target.dat");

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
  assertEntriesPresent(entries, [
    SCREENS_HIERARCHY,
    CONTENTS_HIERARCHY,
    ...input.screens.flatMap((screen) => [
      screenEntry(screen.UniqueId, "Screen.dat"),
      screenEntry(screen.UniqueId, "Metadata.dat"),
      screenEntry(screen.UniqueId, "LocalVariables.db"),
    ]),
  ]);

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
