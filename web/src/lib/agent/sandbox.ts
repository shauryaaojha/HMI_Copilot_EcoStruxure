/**
 * A real shell for the agent: a Linux microVM (Vercel Sandbox) holding a copy
 * of the project's files.
 *
 * QuickJS (script.ts) covers a loop over JSON. This covers the rest of what an
 * engineer does at a terminal: Python, sqlite3, unzip, jq, grep over a whole
 * project, a quick pip install. The microVM is the isolation boundary; its
 * network reaches only the Python and npm package registries, so nothing in
 * the project can be sent anywhere.
 *
 * The workspace stays the source of truth. Before each command the files that
 * changed in it are copied up to /vercel/project; after it, every file is
 * hashed there, and what the command changed, added or deleted is brought
 * back through the workspace's own checks - a .dat must still be JSON, the
 * PLC connection is never uploaded and cannot be written, and the project's
 * core files cannot be deleted. Hashes rather than mtimes, because Linux
 * stamps files at clock-tick resolution and a write right after the copy can
 * carry the same time.
 *
 * One sandbox per agent run, created on the first command and stopped when
 * the run ends (or by its own timeout if the function dies first).
 */

import { createHash } from "node:crypto";
import { JSON_FILE, WorkspaceError, type Workspace } from "./workspace";

/** What the shell needs from a sandbox; the tests provide a local one. */
export interface Box {
  /** Paths relative to the sandbox home. */
  writeFiles(files: { path: string; content: Uint8Array }[]): Promise<void>;
  run(script: string, options: { timeoutMs: number; signal?: AbortSignal }): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  read(path: string): Promise<Uint8Array | null>;
  stop(): Promise<void>;
}

const HOME = "/vercel";
/** A sandbox outlives one run only by this much if nothing stops it. */
const LIFETIME_MS = 15 * 60_000;
const MAX_OUTPUT = 12_000;
const REGISTRIES = ["pypi.org", "files.pythonhosted.org", "registry.npmjs.org"];
/** Never carried back: a command's caches. */
const JUNK = /(^|\/)(__pycache__|node_modules|\.cache)\/|\.pyc$/;

const env = (name: string) => process.env[name]?.trim() || undefined;

/** Whether a sandbox can be had here: on Vercel, or with a token locally. */
export function shellAvailable(): boolean {
  if (env("AGENT_SHELL") === "off") return false;
  return Boolean(env("VERCEL_OIDC_TOKEN") || (env("VERCEL_TOKEN") && env("VERCEL_TEAM_ID") && env("VERCEL_PROJECT_ID")) || env("VERCEL") === "1");
}

export async function openVercelBox(): Promise<Box> {
  const { Sandbox } = await import("@vercel/sandbox");
  const sbx = await Sandbox.create({ timeout: LIFETIME_MS, resources: { vcpus: 2 }, networkPolicy: { allow: REGISTRIES } });
  return {
    writeFiles: (files) => sbx.writeFiles(files),
    async run(script, { timeoutMs, signal }) {
      const r = await sbx.runCommand("bash", ["-lc", script], { timeoutMs, signal });
      return { exitCode: r.exitCode, stdout: await r.stdout(), stderr: await r.stderr() };
    },
    async read(path) {
      const b = await sbx.readFileToBuffer({ path: `${HOME}/${path}` });
      return b ? new Uint8Array(b) : null;
    },
    async stop() {
      await sbx.stop();
    },
  };
}

const sha1 = (b: Uint8Array) => createHash("sha1").update(b).digest("hex");
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const clip = (s: string) => (s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT / 2)}\n... (${s.length - MAX_OUTPUT} characters cut) ...\n${s.slice(-MAX_OUTPUT / 2)}` : s);

export class Shell {
  private box?: Promise<Box>;
  /** Per path, the bytes the sandbox holds, as far as we know. */
  private synced = new Map<string, Uint8Array>();

  constructor(
    private ws: Workspace,
    /** Files that cannot be deleted. */
    private core: (path: string) => boolean,
    private open: () => Promise<Box> = openVercelBox,
  ) {}

  get started() {
    return this.box !== undefined;
  }

  async run(command: string, timeoutS = 120, signal?: AbortSignal): Promise<{ text: string; isError: boolean }> {
    const box = await (this.box ??= this.open().then(async (b) => {
      await b.run(`mkdir -p ${HOME}/project ${HOME}/work`, { timeoutMs: 20_000 });
      return b;
    }));
    await this.upload(box);
    const timeoutMs = Math.min(Math.max(timeoutS, 1), 280) * 1000;
    const r = await box.run(`cd ${HOME}/project && ${command}`, { timeoutMs, signal });
    const back = await this.download(box);
    const out = [
      `exit ${r.exitCode}`,
      r.stdout.trim() && clip(r.stdout.trimEnd()),
      r.stderr.trim() && `stderr:\n${clip(r.stderr.trimEnd())}`,
      back,
    ].filter(Boolean).join("\n");
    return { text: out, isError: r.exitCode !== 0 };
  }

  async stop() {
    const box = this.box;
    this.box = undefined;
    this.synced.clear();
    if (box) await (await box).stop().catch(() => undefined);
  }

  private async upload(box: Box) {
    const now = this.ws.list();
    const changed = now.filter((p) => this.synced.get(p) !== this.ws.bytes(p));
    const gone = [...this.synced.keys()].filter((p) => !this.ws.has(p));
    for (let i = 0; i < changed.length; i += 200) {
      const batch = changed.slice(i, i + 200);
      await box.writeFiles(batch.map((p) => ({ path: `project/${p}`, content: this.ws.bytes(p) })));
      for (const p of batch) this.synced.set(p, this.ws.bytes(p));
    }
    if (gone.length) {
      await box.run(`cd ${HOME}/project && rm -f -- ${gone.map(quote).join(" ")}`, { timeoutMs: 20_000 });
      for (const p of gone) this.synced.delete(p);
    }
  }

  /** Bring back what the command changed. Returns a line for the model, or "". */
  private async download(box: Box): Promise<string> {
    const listing = await box.run(`cd ${HOME}/project && find . -type f -print0 | xargs -0 -r sha1sum`, { timeoutMs: 60_000 });
    const there = new Map<string, string>();
    for (const line of listing.stdout.split("\n")) {
      const m = /^([0-9a-f]{40}) [ *]\.\/(.+)$/.exec(line);
      if (m && !JUNK.test(m[2])) there.set(m[2], m[1]);
    }
    const modified: string[] = [], added: string[] = [], deleted: string[] = [], refused: string[] = [];

    for (const [p, hash] of there) {
      const known = this.synced.get(p);
      if (known && sha1(known) === hash) continue;
      const bytes = await box.read(`project/${p}`);
      if (!bytes) continue;
      try {
        if (JSON_FILE.test(p)) this.ws.writeText(p, new TextDecoder().decode(bytes));
        else this.ws.writeBytes(p, bytes);
        (known ? modified : added).push(p);
        // The workspace may keep a byte-order mark the command dropped; the
        // next command then gets the workspace's version.
        this.synced.set(p, bytes);
        if (sha1(this.ws.bytes(p)) !== hash) this.synced.set(p, new Uint8Array());
      } catch (e) {
        if (!(e instanceof WorkspaceError || (e as Error).name === "WorkspaceError")) throw e;
        refused.push(`${p} (${(e as Error).message})`);
        // A file the workspace has goes back up as it was before the next
        // command; one it does not have is removed there.
        this.synced.set(p, this.ws.has(p) ? new Uint8Array() : bytes);
      }
    }
    for (const p of [...this.synced.keys()]) {
      if (there.has(p)) continue;
      if (this.core(p)) {
        refused.push(`${p} (a core file; it was put back)`);
        this.synced.delete(p);
        continue;
      }
      if (this.ws.has(p)) this.ws.delete(p);
      this.synced.delete(p);
      deleted.push(p);
    }

    const parts = [
      modified.length && `modified ${modified.join(", ")}`,
      added.length && `added ${added.join(", ")}`,
      deleted.length && `deleted ${deleted.join(", ")}`,
      refused.length && `refused ${refused.join("; ")}`,
    ].filter(Boolean);
    return parts.length ? `workspace: ${parts.join("; ")}` : "workspace: unchanged";
  }
}
