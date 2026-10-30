/**
 * Everything the agent can do in a project's working directory.
 *
 * Three kinds of tool, as at a terminal:
 *
 *   files     list, read, search, write, edit, JSON get/set, copy, delete,
 *             SQL on the databases, diff, checkpoint and undo
 *   project   screens, objects at every depth, bindings, tags, the project's
 *             own objects, copy an object, bind and unbind, duplicate a screen
 *   proof     check (does it read, are ids and bindings whole, does the export
 *             path write it), look at a screen as pixels, and run a script in
 *             a sandbox for work that is a loop rather than a call, and a
 *             real shell in a Linux sandbox where one can be had (sandbox.ts)
 *
 * A tool is plain data plus a function, provider-neutral: the loop
 * (lib/agent/run.ts) turns the list into Claude or Gemini declarations, and an
 * MCP server can serve the same list. Inputs are checked here before a tool
 * runs, because a model's arguments are untrusted.
 */

import { readProject, type ReadProject } from "@/lib/ote/reader";
import { packageProject } from "@/lib/ote/packager";
import { preflight } from "@/lib/ote/preflight";
import { describeOwn, harvest } from "@/lib/ote/exemplars";
import { JSON_FILE, Workspace, WorkspaceError } from "./workspace";
import {
  bind, bindings, cloneObject, duplicateScreen, findObject, get, objects, screenByName, screens, set, unbind, walk,
} from "./project";
import { runScript } from "./script";
import { Shell, shellAvailable, type Box } from "./sandbox";

export interface ToolResult {
  text: string;
  /** A PNG the model should see. */
  image?: Uint8Array;
  isError?: boolean;
}

type ParamType = "string" | "integer" | "number" | "boolean" | "any";

interface Param {
  type: ParamType;
  description: string;
  optional?: boolean;
  enum?: string[];
}

export interface AgentTool {
  name: string;
  description: string;
  params: Record<string, Param>;
  /** Changes the project. The loop reports these and the UI marks them. */
  writes?: boolean;
  run(ctx: AgentContext, input: Record<string, unknown>): Promise<ToolResult> | ToolResult;
}

export interface AgentContext {
  ws: Workspace;
  /** The project as read from the workspace, cached per workspace version. */
  read(): Promise<ReadProject>;
}

export function contextFor(ws: Workspace): AgentContext {
  let cached: { version: number; read: Promise<ReadProject> } | undefined;
  return {
    ws,
    read() {
      if (!cached || cached.version !== ws.version) {
        const version = ws.version;
        cached = { version, read: ws.toBytes().then((b) => readProject(b, ws.fileName)) };
      }
      return cached.read;
    },
  };
}

/**
 * Files a project does not open without. A model that deletes a screen's
 * Screen.dat "to start again" leaves a folder the editor cannot read; it is
 * pointed at undo instead.
 */
const CORE = /^(Project\.dat|Target\.dat|Bindings\.dat|Variables\.db|Alarm\.db|Resources\.dat|_metadata.*|(Screens|Contents|CompoundObjects)\/Hierarchy\.dat|(Screens|Contents|CompoundObjects)\/[^/]+\/(Screen\.dat|Metadata\.dat|Folder\.dat|CompoundObject\.objdef))$/i;

/** Results are cut here; the agent can read further with offset. */
const MAX_CHARS = 14_000;

const ok = (text: string): ToolResult => ({ text: text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n... cut at ${MAX_CHARS} characters; narrow the request` : text });
const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
const json = (v: unknown) => JSON.stringify(v, null, 1);

function lines(text: string, offset = 1, limit = 400): string {
  const all = text.split(/\r?\n/);
  const start = Math.max(1, offset);
  const shown = all.slice(start - 1, start - 1 + limit).map((l, i) => `${String(start + i).padStart(5)}  ${l.length > 600 ? `${l.slice(0, 600)}...` : l}`);
  const more = all.length > start - 1 + limit ? `\n... ${all.length - (start - 1 + limit)} more lines (offset ${start + limit})` : "";
  return shown.join("\n") + more;
}

/**
 * A model's regular expression, made to work: inline flags such as (?i) are
 * dropped (matching is case-insensitive anyway), and an expression that still
 * does not compile is matched as plain text.
 */
function pattern(source: unknown): RegExp {
  const s = String(source).replace(/^\(\?[a-z]+\)/i, "");
  try {
    return new RegExp(s, "i");
  } catch {
    return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
}

/** A glob over workspace paths: * within a folder, ** across folders. */
function globRe(glob: string): RegExp {
  const re = glob.replace(/\\/g, "/").replace(/[.+^${}()|[\]]/g, "\\$&").replace(/\*\*\/?/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*");
  return new RegExp(`^${re}$`, "i");
}

/** A .dat whose JSON is one long line is shown and searched pretty-printed. */
function readable(ws: Workspace, path: string): string {
  const text = ws.text(path);
  if (!JSON_FILE.test(path) || text.includes("\n")) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export const TOOLS: AgentTool[] = [
  /* ---------------------------------------------------------------- files */
  {
    name: "list_files",
    description: "List the project's files (an .eote is a ZIP of JSON .dat files and SQLite .db files), optionally under a folder or matching a glob such as Screens/*/Screen.dat. Sizes in bytes.",
    params: {
      folder: { type: "string", description: "Folder to list, e.g. Screens", optional: true },
      glob: { type: "string", description: "Glob over paths, e.g. **/Metadata.dat", optional: true },
    },
    run({ ws }, i) {
      let paths = ws.list(str(i.folder));
      if (i.glob) paths = paths.filter((p) => globRe(String(i.glob)).test(p));
      return ok(paths.length ? paths.map((p) => `${p}  ${ws.size(p)}`).join("\n") : "no files match");
    },
  },
  {
    name: "read_file",
    description: "Read a text file with line numbers. One-line JSON is shown pretty-printed. Use offset/limit for long files; for a .db file use sql_query.",
    params: {
      path: { type: "string", description: "Path inside the project" },
      offset: { type: "integer", description: "First line, from 1", optional: true },
      limit: { type: "integer", description: "Lines to show (default 400)", optional: true },
    },
    run({ ws }, i) {
      return ok(lines(readable(ws, String(i.path)), Number(i.offset ?? 1), Number(i.limit ?? 400)));
    },
  },
  {
    name: "search",
    description: "Search text files for a regular expression (case-insensitive), like grep. Returns path:line: text. JSON is searched pretty-printed, one key per line.",
    params: {
      pattern: { type: "string", description: "Regular expression" },
      glob: { type: "string", description: "Only files matching this glob, e.g. Screens/**", optional: true },
      max: { type: "integer", description: "Most matches to return (default 100)", optional: true },
    },
    run({ ws }, i) {
      const re = pattern(i.pattern);
      const max = Number(i.max ?? 100);
      const filter = i.glob ? globRe(String(i.glob)) : undefined;
      const out: string[] = [];
      for (const p of ws.list()) {
        if (!ws.isText(p) || (filter && !filter.test(p))) continue;
        readable(ws, p).split(/\r?\n/).forEach((l, n) => {
          if (out.length < max && re.test(l)) out.push(`${p}:${n + 1}: ${l.trim().slice(0, 300)}`);
        });
        if (out.length >= max) break;
      }
      return ok(out.length ? out.join("\n") + (out.length >= max ? `\n... stopped at ${max}` : "") : "no matches");
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a text file. A .dat or .json file must be valid JSON or it is refused. Prefer edit_file or json_set for a change to an existing file.",
    writes: true,
    params: {
      path: { type: "string", description: "Path inside the project" },
      content: { type: "string", description: "The whole file" },
    },
    run({ ws }, i) {
      ws.writeText(String(i.path), String(i.content));
      return ok(`wrote ${i.path} (${ws.size(String(i.path))} bytes)`);
    },
  },
  {
    name: "edit_file",
    description: "Replace one exact, unique piece of text in a file (as read_file shows it, without the line numbers). The result must still be valid JSON for .dat files.",
    writes: true,
    params: {
      path: { type: "string", description: "Path inside the project" },
      old_text: { type: "string", description: "Text to replace; must occur exactly once" },
      new_text: { type: "string", description: "Replacement" },
    },
    run({ ws }, i) {
      const path = String(i.path);
      const text = readable(ws, path);
      const old = String(i.old_text);
      const count = text.split(old).length - 1;
      if (count === 1) {
        ws.writeText(path, text.replace(old, () => String(i.new_text)));
        return ok(`edited ${path}`);
      }
      // A model copies indentation loosely: match again with any run of
      // whitespace standing for any other (or none, beside JSON punctuation),
      // and take it only when it is unique.
      if (count === 0 && old.trim()) {
        const loose = new RegExp(old.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\?[:,{}[\]]/g, "\\s*$&\\s*")).join("\\s+"), "g");
        const hits = text.match(loose) ?? [];
        if (hits.length === 1) {
          ws.writeText(path, text.replace(loose, () => String(i.new_text)));
          return ok(`edited ${path} (matched ignoring whitespace)`);
        }
        return { text: `old_text occurs ${hits.length} times in ${path}, even ignoring whitespace; it must occur once. For a JSON value, json_set with the pointer screen_objects gives is safer.`, isError: true };
      }
      return { text: `old_text occurs ${count} times in ${path}; it must occur once`, isError: true };
    },
  },
  {
    name: "json_get",
    description: "Read a value inside a JSON file by JSON pointer, e.g. /Children/0/Children/3/Width. Pointer '' is the whole document.",
    params: {
      path: { type: "string", description: "JSON file" },
      pointer: { type: "string", description: "JSON pointer" },
    },
    run({ ws }, i) {
      return ok(json(get(ws.json(String(i.path)), String(i.pointer ?? ""))));
    },
  },
  {
    name: "json_set",
    description: "Set, insert or remove a value inside a JSON file by JSON pointer. A last segment of '-' appends to an array. The value is JSON (a number, a string in quotes, an object...).",
    writes: true,
    params: {
      path: { type: "string", description: "JSON file" },
      pointer: { type: "string", description: "JSON pointer below the root" },
      value: { type: "any", description: "New value (any JSON); omit with remove", optional: true },
      remove: { type: "boolean", description: "Delete the key or array element instead", optional: true },
    },
    run({ ws }, i) {
      const path = String(i.path);
      const doc = ws.json(path);
      set(doc, String(i.pointer), i.value, Boolean(i.remove));
      ws.writeJson(path, doc);
      return ok(`${i.remove ? "removed" : "set"} ${i.pointer} in ${path}`);
    },
  },
  {
    name: "copy_path",
    description: "Copy a file, or a folder with everything under it, to a new path.",
    writes: true,
    params: {
      from: { type: "string", description: "Source path" },
      to: { type: "string", description: "Destination path" },
    },
    run({ ws }, i) {
      const written = ws.copy(String(i.from), String(i.to));
      return ok(`copied ${written.length} file${written.length === 1 ? "" : "s"}: ${written.slice(0, 20).join(", ")}`);
    },
  },
  {
    name: "delete_path",
    description: "Delete a file, or a folder with everything under it. Deleting a whole screen folder (Screens/<id> or Contents/<id>) also takes it out of the screen tree. The project's core files cannot be deleted; to start over, use undo.",
    writes: true,
    params: { path: { type: "string", description: "Path inside the project" } },
    run({ ws }, i) {
      const p = String(i.path).replace(/\\/g, "/").replace(/\/+$/, "");
      if (CORE.test(p)) {
        return { text: `${p} is part of the project's structure and cannot be deleted on its own${/Screen\.dat$/i.test(p) ? "; delete the whole screen folder, or use undo to start over" : ""}`, isError: true };
      }
      const under = ws.has(p) ? [p] : ws.list(p);
      if (under.length === 0) return { text: `${p} does not exist`, isError: true };
      for (const f of under) ws.delete(f);
      const folder = /^(Screens|Contents)\/([^/]+)$/i.exec(p)?.[2]?.toLowerCase();
      const tree = folder && /^Screens/i.test(p) ? "Screens/Hierarchy.dat" : folder ? "Contents/Hierarchy.dat" : undefined;
      if (folder && tree && ws.has(tree)) {
        const prune = (nodes: { ObjectId?: string; Children?: unknown[] }[]): unknown[] =>
          nodes.filter((n) => String(n.ObjectId).toLowerCase() !== folder).map((n) => (Array.isArray(n.Children) ? { ...n, Children: prune(n.Children as never) } : n));
        ws.writeJson(tree, prune(ws.json(tree)));
      }
      return ok(`deleted ${under.length} file${under.length === 1 ? "" : "s"}${folder ? " and took the screen out of the tree" : ""}`);
    },
  },
  {
    name: "sql_query",
    description: "Run a read-only SQL query (SELECT/PRAGMA/WITH) on a database file, e.g. Variables.db, Alarm.db. Start with: SELECT name, sql FROM sqlite_master.",
    params: {
      path: { type: "string", description: "Database file" },
      sql: { type: "string", description: "The query" },
    },
    async run({ ws }, i) {
      const result = await ws.sql(String(i.path), String(i.sql));
      if (result.length === 0) return ok("no rows");
      return ok(result.map((r) => [r.columns.join(" | "), ...r.rows.slice(0, 200).map((row) => row.map((v) => (v instanceof Uint8Array ? `<${v.length} bytes>` : String(v))).join(" | ")), r.rows.length > 200 ? `... ${r.rows.length - 200} more rows` : ""].filter(Boolean).join("\n")).join("\n\n"));
    },
  },
  {
    name: "sql_exec",
    description: "Run SQL that changes a database file (INSERT/UPDATE/DELETE). Read the schema first; the product reads these tables directly.",
    writes: true,
    params: {
      path: { type: "string", description: "Database file" },
      sql: { type: "string", description: "Statements" },
    },
    async run({ ws }, i) {
      await ws.sql(String(i.path), String(i.sql), true);
      return ok(`ran on ${i.path}`);
    },
  },
  {
    name: "diff",
    description: "What changed since the project was opened: every added, modified or deleted file, or for one file the changed lines.",
    params: { path: { type: "string", description: "One file to show line changes for", optional: true } },
    run({ ws }, i) {
      if (!i.path) {
        const c = ws.changes();
        return ok(c.length ? c.map((x) => `${x.kind.padEnd(8)} ${x.path}`).join("\n") : "nothing changed");
      }
      const path = String(i.path);
      const pretty = (t: string | undefined) => {
        if (t === undefined) return [];
        try {
          return JSON.stringify(JSON.parse(t), null, 2).split("\n");
        } catch {
          return t.split(/\r?\n/);
        }
      };
      const before = pretty(ws.originalText(path));
      const after = ws.has(path) ? pretty(ws.text(path)) : [];
      const was = new Set(before);
      const now = new Set(after);
      const out = [...before.filter((l) => !now.has(l)).map((l) => `- ${l}`), ...after.filter((l) => !was.has(l)).map((l) => `+ ${l}`)];
      return ok(out.length ? out.slice(0, 300).join("\n") : "no changes");
    },
  },
  {
    name: "checkpoint",
    description: "Remember the project as it is now, so undo can come back to it. Take one before a risky change.",
    params: { label: { type: "string", description: "What the checkpoint is before", optional: true } },
    run({ ws }, i) {
      return ok(`checkpoint ${ws.checkpoint(str(i.label) ?? "checkpoint")}`);
    },
  },
  {
    name: "undo",
    description: "Throw away every change since the last checkpoint (or since the project was opened).",
    writes: true,
    params: {},
    run({ ws }) {
      return ok(ws.undo());
    },
  },

  /* -------------------------------------------------------------- project */
  {
    name: "project_summary",
    description: "The project at a glance: panel, screens, tag count, bindings, alarms, carried (not modelled) objects, and what the reader warns about. Start here.",
    params: {},
    async run(ctx) {
      const read = await ctx.read();
      const list = screens(ctx.ws);
      return ok([
        `name: ${read.name}`,
        `panel: ${read.target.model} ${read.target.width}x${read.target.height}`,
        `screens: ${list.filter((s) => s.kind === "screen").map((s) => `${s.name} (#${s.number}, ${s.objects} objects)`).join(", ")}`,
        `content screens: ${list.filter((s) => s.kind === "content").map((s) => s.name).join(", ") || "none"}`,
        `tags: ${read.variables.length}; bindings: ${bindings(ctx.ws).length}; alarms: ${read.alarms.length}`,
        `compound objects defined: ${new Set(ctx.ws.list("CompoundObjects").map((p) => p.split("/")[1])).size}`,
        `carried as they are: ${read.carried.opaqueParts} objects, ${read.carried.screens} whole screens`,
        read.warnings.length ? `warnings: ${read.warnings.join(" | ")}` : "warnings: none",
      ].join("\n"));
    },
  },
  {
    name: "list_screens",
    description: "Every screen and content screen: name, id, number (what a screen switch uses), file, object count.",
    params: {},
    run({ ws }) {
      return ok(screens(ws).map((s) => `${s.kind.padEnd(7)} ${s.name}  #${s.number ?? "-"}  ${s.id}  ${s.path}  ${s.objects} objects`).join("\n"));
    },
  },
  {
    name: "screen_objects",
    description: "Every object on a screen at every depth (inside grids, groups and canvases): type, name, id, box, text, containers, what it is bound to, and its JSON pointer in the file.",
    params: { screen: { type: "string", description: "Screen name or id" } },
    run({ ws }, i) {
      return ok(objects(ws, String(i.screen)).map((o) => {
        const box = o.box ? ` @${o.box.left},${o.box.top} ${o.box.width}x${o.box.height}` : o.cell ? ` cell r${o.cell.row} c${o.cell.column} span ${o.cell.rowSpan}x${o.cell.columnSpan}` : "";
        const bound = o.bound.length ? ` bound: ${o.bound.map((b) => `${b.property}<-${b.text} (mode ${b.mode})`).join("; ")}` : "";
        return `${"  ".repeat(o.parents.length)}${o.type} "${o.name}" ${o.id}${box}${o.text ? ` text "${o.text}"` : ""}${bound}  ${o.pointer}`;
      }).join("\n") || "no objects");
    },
  },
  {
    name: "find_objects",
    description: "Find objects anywhere in the project, or on one screen, by type, name, text or bound tag (each a case-insensitive regular expression).",
    params: {
      screen: { type: "string", description: "Only this screen (name or id)", optional: true },
      type: { type: "string", description: "e.g. Switch|CompoundObject", optional: true },
      name: { type: "string", description: "Object name", optional: true },
      text: { type: "string", description: "Text it shows", optional: true },
      tag: { type: "string", description: "Tag it is bound to", optional: true },
    },
    run({ ws }, i) {
      const re = (v: unknown) => (v ? pattern(v) : undefined);
      const [t, n, x, g] = [re(i.type), re(i.name), re(i.text), re(i.tag)];
      const hits = objects(ws, i.screen ? String(i.screen) : undefined).filter((o) => (!t || t.test(o.type)) && (!n || n.test(o.name)) && (!x || x.test(o.text ?? "")) && (!g || o.bound.some((b) => g.test(b.text))));
      return ok(hits.slice(0, 150).map((o) => `${o.screen}: ${o.type} "${o.name}" ${o.id}${o.text ? ` "${o.text}"` : ""}${o.bound.length ? ` <- ${o.bound.map((b) => `${b.property}:${b.text}`).join(", ")}` : ""}`).join("\n") || "none");
    },
  },
  {
    name: "bindings",
    description: "Bindings (tag to object property), filtered by tag, object or screen. Shows the binding text, the property and the Mode (1 tag to object, 2 both ways).",
    params: {
      tag: { type: "string", description: "Regular expression over the binding text", optional: true },
      object: { type: "string", description: "Object name or id", optional: true },
      screen: { type: "string", description: "Screen name or id", optional: true },
    },
    run({ ws }, i) {
      const screenId = i.screen ? screenByName(ws, String(i.screen)).id.toLowerCase() : undefined;
      const tag = i.tag ? pattern(i.tag) : undefined;
      const obj = str(i.object)?.toLowerCase();
      const rows = bindings(ws).filter((b) => (!tag || tag.test(b.text)) && (!obj || b.object.toLowerCase() === obj || b.objectId.toLowerCase() === obj) && (!screenId || b.screenId?.toLowerCase() === screenId));
      return ok(rows.slice(0, 300).map((b) => `${b.object} (${b.type}) .${b.property} <- ${b.text}  mode ${b.mode}  ${b.objectId}`).join("\n") || "none");
    },
  },
  {
    name: "tags",
    description: "The project's tags (variables): name, data type, address, comment. Filter by a regular expression.",
    params: { filter: { type: "string", description: "Regular expression over names", optional: true } },
    async run(ctx, i) {
      const re = i.filter ? pattern(i.filter) : undefined;
      const vars = (await ctx.read()).variables.filter((v) => !re || re.test(v.Name));
      return ok(vars.slice(0, 400).map((v) => `${v.Name}  ${v.DataType}${v.DeviceAddress ? `  ${v.DeviceAddress}` : ""}${v.Comments ? `  // ${v.Comments}` : ""}`).join("\n") || "none");
    },
  },
  {
    name: "own_objects",
    description: "How this project draws each kind of object (push button, toggle, entry, reading, status): the engineer's own object, how they bind it, its size and font. Copy these instead of inventing a look.",
    params: {},
    async run(ctx) {
      const read = await ctx.read();
      const own = describeOwn(harvest(read.preserved, read.variables));
      return ok(own.length ? json(own) : "the project has no examples bound to a recognised tag; use the standard objects");
    },
  },
  {
    name: "compound_objects",
    description: "The Compound Object definitions in the project (CompoundObjects/<id>/): name, id, the properties each exposes for binding, and how many instances the screens hold. An instance's Type is CompoundObject.<name>.",
    params: { name: { type: "string", description: "Only definitions whose name matches", optional: true } },
    run({ ws }, i) {
      const re = i.name ? pattern(i.name) : undefined;
      const instances = new Map<string, number>();
      for (const s of screens(ws)) for (const { node } of walk(ws.json(s.path))) {
        const t = String(node.Type);
        if (t.startsWith("CompoundObject.")) instances.set(t.slice(15), (instances.get(t.slice(15)) ?? 0) + 1);
      }
      const out: string[] = [];
      for (const p of ws.list("CompoundObjects").filter((x) => /\/CompoundObject\.objdef$/i.test(x))) {
        const def = ws.json<{ Name?: string; Id?: string }>(p);
        const name = String(def.Name ?? "");
        if (re && !re.test(name)) continue;
        const folder = p.replace(/\/CompoundObject\.objdef$/i, "");
        const props = ws.has(`${folder}/Properties.propDef`) ? ws.json<{ PropertyName: string; PropertyType: string }[]>(`${folder}/Properties.propDef`) : [];
        out.push(`${name}  ${def.Id}  ${instances.get(name) ?? 0} instances  properties: ${props.map((x) => `${x.PropertyName}:${x.PropertyType}`).join(", ") || "none"}  ${folder}/`);
      }
      return ok(out.join("\n") || "no Compound Object definitions");
    },
  },
  {
    name: "clone_object",
    description: "Copy an object (with everything inside it, new ids throughout) onto a screen: into its root container, or a named container. Optionally rename and position it: left/top on a canvas, row/column (from 0) in a grid; in a grid with no cell given it goes in the first free cell it fits, and a copy that covers other objects says so. Bindings are not copied; use bind.",
    writes: true,
    params: {
      object: { type: "string", description: "Object name or id to copy" },
      to_screen: { type: "string", description: "Screen name or id" },
      name: { type: "string", description: "Name of the copy", optional: true },
      container: { type: "string", description: "Container object name on that screen", optional: true },
      left: { type: "integer", description: "Location.Left, on a canvas", optional: true },
      top: { type: "integer", description: "Location.Top, on a canvas", optional: true },
      row: { type: "integer", description: "Grid row, from 0", optional: true },
      column: { type: "integer", description: "Grid column, from 0", optional: true },
    },
    run({ ws }, i) {
      const o = cloneObject(ws, String(i.object), String(i.to_screen), {
        name: str(i.name), container: str(i.container),
        left: i.left === undefined ? undefined : Number(i.left), top: i.top === undefined ? undefined : Number(i.top),
        row: i.row === undefined ? undefined : Number(i.row), column: i.column === undefined ? undefined : Number(i.column),
      });
      const at = o.cell ? `grid cell row ${o.cell.row}, column ${o.cell.column}` : o.box ? `${o.box.left},${o.box.top}` : "its container";
      const over = o.overlaps.length ? `\nIt covers ${o.overlaps.join(", ")}; move it with json_set on Location if that is not meant.` : "";
      return ok(`copied as ${o.type} "${o.name}" ${o.id} on ${o.screen}, ${at}; JSON pointer ${o.pointer} in ${o.file}${over}`);
    },
  },
  {
    name: "bind",
    description: "Bind an object's property to a tag, written exactly as the product writes it (PLC symbol paths, parent ids, Mode). Replaces an existing binding of that property. Use the property the project's own objects use (own_objects / bindings), e.g. CV on a Compound Object, ClickTrigger.Destination on a push button, CurrentValue on a display.",
    writes: true,
    params: {
      object: { type: "string", description: "Object name or id" },
      property: { type: "string", description: "Target property" },
      tag: { type: "string", description: "Tag name" },
      mode: { type: "integer", description: "1 tag to object, 2 both ways", optional: true, enum: ["1", "2"] },
    },
    async run({ ws }, i) {
      return ok(await bind(ws, String(i.object), String(i.property), String(i.tag), i.mode === undefined ? undefined : (Number(i.mode) as 1 | 2)));
    },
  },
  {
    name: "unbind",
    description: "Remove an object's bindings: one property, or all of them.",
    writes: true,
    params: {
      object: { type: "string", description: "Object name or id" },
      property: { type: "string", description: "Only this property", optional: true },
    },
    run({ ws }, i) {
      const n = unbind(ws, String(i.object), str(i.property));
      return ok(n ? `removed ${n} binding${n === 1 ? "" : "s"}` : "it had no such binding");
    },
  },
  {
    name: "duplicate_screen",
    description: "Copy a whole screen under a new name: new ids, the next free screen number, listed beside the original in the screen tree. Its bindings are not copied.",
    writes: true,
    params: {
      screen: { type: "string", description: "Screen to copy" },
      name: { type: "string", description: "New screen name" },
    },
    run({ ws }, i) {
      const s = duplicateScreen(ws, String(i.screen), String(i.name));
      return ok(`created ${s.name} #${s.number} ${s.id} (${s.objects} objects)`);
    },
  },

  /* ---------------------------------------------------------------- proof */
  {
    name: "check",
    description: "Check the project as it stands: every JSON file parses, the project reads, ids are unique, every binding points at an object that exists, screen numbers are unique, the screen tree lists real screens, the export path can write it, and what the product would refuse. Run it after changes and before finishing.",
    params: {},
    async run(ctx) {
      const { ws } = ctx;
      const problems: string[] = [];
      for (const p of ws.list()) {
        if (!JSON_FILE.test(p)) continue;
        try {
          ws.json(p);
        } catch (e) {
          problems.push((e as Error).message);
        }
      }
      let read: ReadProject | undefined;
      try {
        read = await ctx.read();
      } catch (e) {
        problems.push(`the project does not read: ${(e as Error).message}`);
      }

      const ids = new Map<string, string>();
      const all = screens(ws);
      for (const s of all) {
        for (const { node } of walk(ws.json(s.path))) {
          const id = String(node.UniqueId).toLowerCase();
          if (ids.has(id)) problems.push(`id ${id} is used twice (${ids.get(id)} and ${s.name})`);
          ids.set(id, s.name);
        }
      }
      for (const s of all) ids.set(s.id.toLowerCase(), s.name);
      for (const b of bindings(ws)) {
        if (b.objectType === 8 && !ids.has(b.objectId.toLowerCase())) {
          problems.push(`binding ${b.object}.${b.property} <- ${b.text} points at ${b.objectId}, which no screen holds`);
        }
      }
      const numbers = new Map<number, string>();
      for (const s of all.filter((x) => x.kind === "screen" && x.number !== undefined)) {
        if (numbers.has(s.number!)) problems.push(`screens ${numbers.get(s.number!)} and ${s.name} both have number ${s.number}`);
        numbers.set(s.number!, s.name);
      }
      if (ws.has("Screens/Hierarchy.dat")) {
        const listed = new Set<string>();
        const visit = (nodes: { ObjectId?: string; Children?: unknown[] }[]) => nodes.forEach((n) => { if (n.ObjectId) listed.add(n.ObjectId.toLowerCase()); if (Array.isArray(n.Children)) visit(n.Children as never); });
        visit(ws.json("Screens/Hierarchy.dat"));
        for (const id of listed) if (!ws.list(`Screens/${id}`).length) problems.push(`the screen tree lists ${id}, which does not exist`);
        for (const s of all.filter((x) => x.kind === "screen")) if (!listed.has(s.folder.toLowerCase())) problems.push(`screen ${s.name} is not in the screen tree (Screens/Hierarchy.dat), so the editor will not show it`);
      }
      if (read) {
        for (const p of preflight(read)) problems.push(`${p.where}: ${p.problem}`);
        try {
          await packageProject(read, undefined, read.preserved);
        } catch (e) {
          problems.push(`the export path cannot write it: ${(e as Error).message.split("\n")[0]}`);
        }
      }
      const changed = ws.changes().length;
      const warnings = read?.warnings.length ? `\nreader warnings: ${read.warnings.join(" | ")}` : "";
      return ok((problems.length ? `${problems.length} problem${problems.length === 1 ? "" : "s"}:\n${problems.slice(0, 60).join("\n")}` : "no problems found") + `\n${changed} file${changed === 1 ? "" : "s"} changed${warnings}`);
    },
  },
  {
    name: "view_screen",
    description: "Look at a screen as an operator would see it: a PNG rendered from the screen's objects. Use it to judge layout, overlap and legibility after a change.",
    params: { screen: { type: "string", description: "Screen name or id" } },
    async run(ctx, i) {
      const s = screenByName(ctx.ws, String(i.screen));
      const read = await ctx.read();
      const screen = read.screens.find((x) => x.UniqueId.toLowerCase() === s.id.toLowerCase());
      if (!screen) return { text: `${s.name} is carried whole (its layout is not modelled), so it cannot be drawn; use screen_objects`, isError: true };
      const { screenToPng } = await import("@/lib/critic/render");
      const foreign = (read.foreign[screen.UniqueId] ?? []).map((f) => ({ type: f.type, name: f.name, box: f.box }));
      const png = await screenToPng(screen, foreign, 1);
      return { text: `${s.name}, ${read.target.width}x${read.target.height}`, image: png };
    },
  },
  {
    name: "run_script",
    description:
      "Run JavaScript in an isolated sandbox for work that is a loop rather than one call (rename 40 objects, restyle every display). Globals: ws.list(folder?) -> paths; ws.read(path) -> text; ws.json(path) -> value; ws.write(path, text); ws.writeJson(path, value); ws.copy(from, to); ws.delete(path); ws.exists(path); ws.guid() -> new id; print(...values). No network, no timers, 10 s and 64 MB. Return a value with a last expression or print it.",
    writes: true,
    params: { code: { type: "string", description: "JavaScript (ES2020), synchronous" } },
    async run({ ws }, i) {
      const r = await runScript(ws, String(i.code));
      return { text: ok(r.output + (r.error ? `\nerror: ${r.error}` : "")).text, isError: Boolean(r.error) };
    },
  },
  {
    name: "shell",
    description:
      "Run a bash command in a Linux sandbox (Ubuntu; Python 3, Node, sqlite3, unzip, zip, jq, grep, find; pip and npm installs work, no other network). The current directory holds the project's files as this workspace has them (without the PLC connection); ../work is scratch space for your own scripts and output. When the command ends, files it changed, added or deleted in the project come back into the workspace, with the same checks as write_file (.dat stays JSON, core files cannot be deleted). Use it for bulk work, Python, SQL over the databases, or analysis; for one edit the other tools are quicker. The first call starts the sandbox (a few seconds).",
    writes: true,
    params: {
      command: { type: "string", description: "bash, run in the project directory" },
      timeout_s: { type: "integer", description: "Seconds before it is stopped (default 120, at most 280)", optional: true },
    },
    async run({ ws }, i) {
      if (!shellAvailable()) return { text: "No sandbox here (it needs Vercel, or VERCEL_OIDC_TOKEN locally). Use run_script or the file tools.", isError: true };
      const r = await shellFor(ws).run(String(i.command), i.timeout_s === undefined ? undefined : Number(i.timeout_s));
      return { text: ok(r.text).text, isError: r.isError };
    },
  },
];

const shells = new WeakMap<Workspace, Shell>();

/** The run's sandbox, started on first use. */
export function shellFor(ws: Workspace, open?: () => Promise<Box>): Shell {
  let s = shells.get(ws);
  if (!s) shells.set(ws, (s = new Shell(ws, (p) => CORE.test(p), open)));
  return s;
}

/** Stop the run's sandbox, if one was started. */
export async function closeShell(ws: Workspace) {
  const s = shells.get(ws);
  shells.delete(ws);
  await s?.stop();
}

/** The tools this deployment can offer: the shell only where a sandbox can be had. */
export const availableTools = () => TOOLS.filter((t) => t.name !== "shell" || shellAvailable());

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Check a model's arguments against the tool's parameters. Returns a reason, or undefined when they are fine. */
export function invalidInput(tool: AgentTool, input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "arguments must be an object";
  const args = input as Record<string, unknown>;
  for (const [name, p] of Object.entries(tool.params)) {
    const v = args[name];
    if (v === undefined || v === null) {
      if (!p.optional) return `missing ${name}`;
      continue;
    }
    if (p.type === "string" && typeof v !== "string") return `${name} must be a string`;
    if ((p.type === "integer" || p.type === "number") && (typeof v !== "number" || (p.type === "integer" && !Number.isInteger(v)))) return `${name} must be ${p.type === "integer" ? "an integer" : "a number"}`;
    if (p.type === "boolean" && typeof v !== "boolean") return `${name} must be true or false`;
    if (p.enum && !p.enum.includes(String(v))) return `${name} must be one of ${p.enum.join(", ")}`;
  }
  return undefined;
}

/** Run a tool by name with checked input. Errors become results the model can read and act on. */
export async function runAgentTool(ctx: AgentContext, name: string, input: unknown): Promise<ToolResult> {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return { text: `no tool called ${name}`, isError: true };
  const bad = invalidInput(tool, input);
  if (bad) return { text: `invalid arguments for ${name}: ${bad}`, isError: true };
  try {
    return await tool.run(ctx, input as Record<string, unknown>);
  } catch (e) {
    if (e instanceof WorkspaceError || (e as Error).name === "WorkspaceError") return { text: (e as Error).message, isError: true };
    return { text: `${name} failed: ${(e as Error).message}`, isError: true };
  }
}

/** JSON Schema for a tool's input, for the providers' declarations. */
export function inputSchema(tool: AgentTool) {
  const properties: Record<string, Record<string, unknown>> = {};
  for (const [name, p] of Object.entries(tool.params)) {
    properties[name] = {
      ...(p.type === "any" ? {} : { type: p.type }),
      description: p.description,
      ...(p.enum ? { enum: p.type === "integer" ? p.enum.map(Number) : p.enum } : {}),
    };
  }
  return {
    type: "object" as const,
    properties,
    required: Object.entries(tool.params).filter(([, p]) => !p.optional).map(([n]) => n),
  };
}

export { findObject };
