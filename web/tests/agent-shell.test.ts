/**
 * The agent's shell: files go up to the sandbox, and what a command changes
 * comes back through the workspace's checks. lib/agent/sandbox.ts.
 *
 * The sandbox here is a temporary folder and the local bash, which runs the
 * same sync commands the microVM does. Set AGENT_LIVE=1 with a
 * VERCEL_OIDC_TOKEN to run one command in a real Vercel Sandbox as well.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Workspace } from "@/lib/agent/workspace";
import { Shell, openVercelBox, type Box } from "@/lib/agent/sandbox";
import { packageProject } from "@/lib/ote/packager";
import { numericDisplay, screenOf } from "@/lib/ote/parts";
import { readProject } from "@/lib/ote/reader";

const target = { model: "HMIST6600", width: 1280, height: 800 };
const BASH = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const HAS_BASH = process.platform !== "win32" || fs.existsSync(BASH);

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

/** A sandbox that is a folder: /vercel in a script means that folder. */
function localBox(): Box & { root: string; stopped: boolean } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-shell-")).replace(/\\/g, "/");
  roots.push(root);
  const box = {
    root,
    stopped: false,
    async writeFiles(files: { path: string; content: Uint8Array }[]) {
      for (const f of files) {
        const p = path.join(root, f.path);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, f.content);
      }
    },
    async run(script: string, { timeoutMs }: { timeoutMs: number }) {
      const r = spawnSync(BASH, ["-c", script.replaceAll("/vercel", root)], { encoding: "utf8", timeout: timeoutMs });
      return { exitCode: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    async read(p: string) {
      const f = path.join(root, p);
      return fs.existsSync(f) ? new Uint8Array(fs.readFileSync(f)) : null;
    },
    async stop() {
      box.stopped = true;
    },
  };
  return box;
}

async function made() {
  const volts = numericDisplay("Volts", { left: 20, top: 80, width: 90, height: 24 }, 1);
  const screen = screenOf("Drive", [volts], target);
  const bytes = await packageProject({ name: "P", target, screens: [screen], variables: [], alarms: [], wires: [] });
  const ws = await Workspace.open(bytes, "p.eote");
  return { ws, file: `Screens/${screen.UniqueId}/Screen.dat` };
}

const CORE = (p: string) => /^(Project\.dat|Screens\/[^/]+\/Screen\.dat)$/i.test(p);

describe.skipIf(!HAS_BASH)("the agent's shell", () => {
  it("brings back what a command changed, added and deleted, and nothing else", async () => {
    const { ws, file } = await made();
    const box = localBox();
    const shell = new Shell(ws, CORE, async () => box);

    const edit = await shell.run(`sed -i 's/"Volts"/"Amps"/' ${file} && echo hi > notes.txt && ls ../work`);
    expect(edit.isError).toBe(false);
    expect(edit.text).toMatch(/workspace: modified .*Screen\.dat; added notes\.txt/);
    expect((await readProject(await ws.toBytes(), "p.eote")).screens[0].Children[0].Children[0].Name).toBe("Amps");

    expect((await shell.run("cat notes.txt")).text).toMatch(/hi\nworkspace: unchanged/);
    expect((await shell.run("rm notes.txt")).text).toContain("deleted notes.txt");
    expect(ws.has("notes.txt")).toBe(false);
    await shell.stop();
    expect(box.stopped).toBe(true);
  });

  it("sends up what changed in the workspace between commands", async () => {
    const { ws } = await made();
    const shell = new Shell(ws, CORE, async () => localBox());
    await shell.run("true");
    ws.writeText("readme.txt", "from the workspace");
    expect((await shell.run("cat readme.txt")).text).toContain("from the workspace");
    ws.delete("readme.txt");
    expect((await shell.run("test -f readme.txt")).isError).toBe(true);
  });

  it("refuses broken JSON, puts back core files, and keeps out the PLC connection", async () => {
    const { ws, file } = await made();
    const before = ws.text(file);
    const shell = new Shell(ws, CORE, async () => localBox());

    const broken = await shell.run(`echo '{ nope' > ${file}`);
    expect(broken.text).toMatch(/refused .*Screen\.dat \(not written: .* must be valid JSON/);
    expect(ws.text(file)).toBe(before);
    // The next command sees the workspace's version again.
    expect((await shell.run(`head -c 1 ${file} | od -An -c`)).text).not.toContain("{ n");
    expect((await shell.run(`grep -c Volts ${file}`)).text).toMatch(/exit 0\n1/);

    expect((await shell.run("rm Project.dat")).text).toContain("refused Project.dat (a core file; it was put back)");
    expect(ws.has("Project.dat")).toBe(true);
    expect((await shell.run("test -f Project.dat")).isError).toBe(false);

    const plc = await shell.run("echo x > DriverConfig.db");
    expect(plc.text).toMatch(/refused DriverConfig\.db/);
    expect(ws.list().some((p) => /DriverConfig/i.test(p))).toBe(false);
    expect((await shell.run("ls DriverConfig.db")).isError).toBe(true);
  });

  it("reports a failing command with its exit code and output", async () => {
    const { ws } = await made();
    const shell = new Shell(ws, CORE, async () => localBox());
    const r = await shell.run("echo out; echo err >&2; exit 3");
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/^exit 3\nout\nstderr:\nerr\nworkspace: unchanged$/);
  });
});

describe.skipIf(!(process.env.AGENT_LIVE === "1" && process.env.VERCEL_OIDC_TOKEN))("in a real Vercel Sandbox", () => {
  it("runs Python on the project and brings the change back", async () => {
    const { ws, file } = await made();
    const shell = new Shell(ws, CORE, openVercelBox);
    try {
      const script = `python3 - <<'PY'\nimport json\np = "${file}"\ns = json.load(open(p, encoding="utf-8-sig"))\ns["Children"][0]["Children"][0]["Name"] = "Amps"\njson.dump(s, open(p, "w"), indent=2)\nprint("ok")\nPY\ncurl -sS -m 5 https://example.com >/dev/null || echo blocked`;
      const r = await shell.run(script);
      expect(r.text).toMatch(/exit 0\nok\nblocked/);
      expect(r.text).toMatch(/modified .*Screen\.dat/);
      expect((await readProject(await ws.toBytes(), "p.eote")).screens[0].Children[0].Children[0].Name).toBe("Amps");
    } finally {
      await shell.stop();
    }
  }, 120_000);
});
