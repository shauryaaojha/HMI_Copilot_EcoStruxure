/**
 * An opened project as a working directory the agent can read, search, edit
 * and check, the way an engineer at a terminal works on the unzipped file.
 *
 * An .eote is a ZIP of JSON (.dat) and SQLite (.db) files. The workspace holds
 * every entry in memory under a forward-slash path, remembers what each held
 * when it was opened, and writes the project back as a ZIP with the entry
 * names, order and byte-order marks it came with. Nothing touches a disk, so
 * it runs in a Vercel Function as it does on a laptop.
 *
 * The PLC connection is not part of the workspace: `DriverConfig.db` holds the
 * controller's address and credentials. It is carried through to the output
 * untouched and is invisible to every tool, so no model ever reads it.
 */

import JSZip from "jszip";
import { sqlEngine } from "@/lib/ote/packager";

const BOM = "﻿";
const TEXT = /\.(dat|json|objdef|propdef|xml|txt|csv|js|cs|xaml|config|ini|md)$/i;
/** Files the product parses as JSON: one that does not parse is a project that does not open. */
export const JSON_FILE = /\.(dat|json|objdef|propdef)$/i;
const HIDDEN = /(^|\/)DriverConfig\.db$/i;

export interface Change {
  path: string;
  kind: "added" | "modified" | "deleted";
}

export class WorkspaceError extends Error {
  override name = "WorkspaceError";
}

export class Workspace {
  /** Current contents by normalised path. */
  private files = new Map<string, Uint8Array>();
  /** Contents when opened. */
  private original = new Map<string, Uint8Array>();
  /** The entry name each path had in the ZIP (separator and case). */
  private names = new Map<string, string>();
  private bom = new Set<string>();
  private order: string[] = [];
  private separator = "/";
  private checkpoints: { label: string; files: Map<string, Uint8Array> }[] = [];

  private constructor(readonly fileName: string) {}

  static async open(bytes: Uint8Array, fileName = "project.eote"): Promise<Workspace> {
    const ws = new Workspace(fileName);
    const zip = await JSZip.loadAsync(bytes);
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      const path = normalise(entry.name);
      const data = await entry.async("uint8array");
      if (entry.name.includes("\\")) ws.separator = "\\";
      ws.names.set(path, entry.name);
      ws.order.push(path);
      ws.files.set(path, data);
      ws.original.set(path, data);
      if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) ws.bom.add(path);
    }
    return ws;
  }

  /* ----------------------------------------------------------- reading */

  /** Every visible path, in ZIP order, optionally under a folder. */
  list(under = ""): string[] {
    const prefix = under ? normalise(under).replace(/\/?$/, "/") : "";
    return [...this.files.keys()].filter((p) => !HIDDEN.test(p) && p.startsWith(prefix));
  }

  has(path: string): boolean {
    if (HIDDEN.test(normalise(path))) return false;
    const p = this.resolve(path, false);
    return p !== undefined && this.files.has(p);
  }

  size(path: string): number {
    return this.bytes(path).length;
  }

  bytes(path: string): Uint8Array {
    const p = this.resolve(path);
    return this.files.get(p)!;
  }

  isText(path: string): boolean {
    return TEXT.test(path);
  }

  /** A text file's contents, byte-order mark removed. */
  text(path: string): string {
    const p = this.resolve(path);
    if (!this.isText(p)) throw new WorkspaceError(`${p} is not a text file${/\.db$/i.test(p) ? "; query it with sql" : ""}`);
    return new TextDecoder().decode(this.files.get(p)!).replace(/^﻿/, "");
  }

  json<T = unknown>(path: string): T {
    const p = this.resolve(path);
    try {
      return JSON.parse(this.text(p)) as T;
    } catch (e) {
      if (e instanceof WorkspaceError) throw e;
      throw new WorkspaceError(`${p} is not valid JSON: ${(e as Error).message}`);
    }
  }

  /* ----------------------------------------------------------- writing */

  /**
   * Write a text file. A .dat or .json file must parse: the product reads
   * every one of them as JSON, and a broken one is a project that does not open.
   */
  writeText(path: string, content: string): void {
    const p = normalise(path);
    this.guard(p);
    if (JSON_FILE.test(p)) {
      try {
        JSON.parse(content.replace(/^﻿/, ""));
      } catch (e) {
        throw new WorkspaceError(`not written: ${p} must be valid JSON (${(e as Error).message})`);
      }
    }
    const body = content.replace(/^﻿/, "");
    const keepBom = this.bom.has(p) || (!this.files.has(p) && this.bom.size > 0 && /\.dat$/i.test(p));
    if (keepBom) this.bom.add(p);
    this.put(p, new TextEncoder().encode((keepBom ? BOM : "") + body));
  }

  writeJson(path: string, value: unknown): void {
    this.writeText(path, JSON.stringify(value, null, 2));
  }

  writeBytes(path: string, data: Uint8Array): void {
    const p = normalise(path);
    this.guard(p);
    this.put(p, data);
  }

  delete(path: string): void {
    const p = this.resolve(path);
    this.guard(p);
    this.files.delete(p);
    this.version++;
  }

  /** Copy a file or, for a folder, everything under it. Returns the paths written. */
  copy(from: string, to: string): string[] {
    const src = normalise(from);
    const dst = normalise(to);
    if (this.files.has(src) || this.resolve(src, false)) {
      const p = this.resolve(src);
      this.guard(dst);
      this.put(dst, this.files.get(p)!);
      if (this.bom.has(p)) this.bom.add(dst);
      return [dst];
    }
    const prefix = src.replace(/\/?$/, "/");
    const out: string[] = [];
    for (const p of this.list(prefix)) {
      const target = dst.replace(/\/?$/, "/") + p.slice(prefix.length);
      this.guard(target);
      this.put(target, this.files.get(p)!);
      if (this.bom.has(p)) this.bom.add(target);
      out.push(target);
    }
    if (out.length === 0) throw new WorkspaceError(`${from} does not exist`);
    return out;
  }

  /* ----------------------------------------------------------- SQLite */

  /** Run SQL on a .db file. Statements that change it write the file back. */
  async sql(path: string, statement: string, write = false): Promise<{ columns: string[]; rows: unknown[][] }[]> {
    const p = this.resolve(path);
    if (!/\.db$/i.test(p)) throw new WorkspaceError(`${p} is not a database`);
    if (!write && !/^\s*(select|pragma|with|explain)\b/i.test(statement)) {
      throw new WorkspaceError("sql_query only reads; use sql_exec to change a database");
    }
    if (write) this.guard(p);
    const SQL = await sqlEngine();
    const db = new SQL.Database(new Uint8Array(this.files.get(p)!));
    try {
      const result = db.exec(statement).map((r) => ({ columns: r.columns, rows: r.values as unknown[][] }));
      if (write) this.put(p, db.export());
      return result;
    } catch (e) {
      throw new WorkspaceError(`SQL error: ${(e as Error).message}`);
    } finally {
      db.close();
    }
  }

  /* ----------------------------------------------------------- history */

  /** Files changed since the project was opened. */
  changes(): Change[] {
    const out: Change[] = [];
    for (const [p, data] of this.files) {
      if (HIDDEN.test(p)) continue;
      const was = this.original.get(p);
      if (!was) out.push({ path: p, kind: "added" });
      else if (!same(was, data)) out.push({ path: p, kind: "modified" });
    }
    for (const p of this.original.keys()) if (!this.files.has(p)) out.push({ path: p, kind: "deleted" });
    return out;
  }

  /** The file as it was when opened, or undefined when it is new. */
  originalText(path: string): string | undefined {
    const data = this.original.get(normalise(path));
    return data && new TextDecoder().decode(data).replace(/^﻿/, "");
  }

  checkpoint(label: string): number {
    this.checkpoints.push({ label, files: new Map(this.files) });
    return this.checkpoints.length;
  }

  /** Back to the last checkpoint, or to the file as opened when there is none. */
  undo(): string {
    const last = this.checkpoints.pop();
    this.files = new Map(last ? last.files : this.original);
    this.version++;
    return last ? `back to checkpoint "${last.label}"` : "back to the project as it was opened";
  }

  /**
   * Take the files of a project the packager wrote from this one (a binding,
   * say), keeping what the workspace was opened with for diff and undo.
   */
  async load(bytes: Uint8Array): Promise<void> {
    const zip = await JSZip.loadAsync(bytes);
    const next = new Map<string, Uint8Array>();
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      const p = normalise(entry.name);
      // The packager writes the PLC connection back as it found it; it is
      // matched here without the check that hides it from the tools.
      const key = this.files.has(p) ? p : [...this.files.keys()].find((k) => k.toLowerCase() === p.toLowerCase()) ?? p;
      if (!this.names.has(key)) this.names.set(key, entry.name);
      next.set(key, await entry.async("uint8array"));
    }
    this.files = next;
    this.version++;
  }

  /** Bumped on every change, so a reader can cache what it parsed. */
  version = 0;

  /* ----------------------------------------------------------- output */

  async toBytes(): Promise<Uint8Array> {
    const zip = new JSZip();
    const seen = new Set<string>();
    for (const p of [...this.order, ...this.files.keys()]) {
      if (seen.has(p) || !this.files.has(p)) continue;
      seen.add(p);
      zip.file(this.names.get(p) ?? p.replace(/\//g, this.separator), this.files.get(p)!);
    }
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  }

  /* ----------------------------------------------------------- inside */

  /** The stored path for a name, matched without regard to case or separator. */
  private resolve(path: string, required = true): string {
    const p = normalise(path);
    if (HIDDEN.test(p)) throw new WorkspaceError(`${p} holds the PLC connection and is not readable`);
    if (this.files.has(p)) return p;
    const lower = p.toLowerCase();
    for (const k of this.files.keys()) if (k.toLowerCase() === lower) return k;
    if (required) throw new WorkspaceError(`${p} does not exist`);
    return undefined as unknown as string;
  }

  private guard(p: string): void {
    if (HIDDEN.test(p)) throw new WorkspaceError(`${p} holds the PLC connection and cannot be changed here`);
    if (p.split("/").some((s) => s === ".." || s === "")) throw new WorkspaceError(`${p} is not a path inside the project`);
  }

  private put(p: string, data: Uint8Array): void {
    const existing = this.resolve(p, false);
    const key = existing ?? p;
    if (!existing && !this.names.has(key)) this.names.set(key, key.replace(/\//g, this.separator));
    this.files.set(key, data);
    this.version++;
  }
}

export const normalise = (path: string) => path.replace(/\\/g, "/").replace(/^\.?\/+/, "").replace(/\/+$/, "");

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
