/**
 * A script the agent writes, run in a sandbox.
 *
 * QuickJS compiled to WebAssembly: a separate JavaScript engine with its own
 * heap, so the script has no `require`, no `process`, no network, no file
 * system and no timers - only the `ws` functions handed to it, which act on
 * the workspace. Node's `vm` module is not a security boundary; this is. It
 * needs no service and costs nothing, so it runs the same in a Vercel
 * Function and on a laptop. Every run gets a fresh runtime with a memory cap
 * and a deadline.
 */

import { getQuickJS, shouldInterruptAfterDeadline, type QuickJSContext, type QuickJSHandle } from "quickjs-emscripten";
import type { Workspace } from "./workspace";

const TIME_MS = 10_000;
const MEMORY = 64 * 1024 * 1024;
const MAX_OUTPUT = 20_000;

const PRELUDE = `
const __j = (r) => { const o = JSON.parse(r); if (o.error) throw new Error(o.error); return o.value; };
const __c = (name, ...args) => __j(__host(name, JSON.stringify(args)));
const ws = {
  list: (folder) => __c("list", folder ?? ""),
  read: (path) => __c("read", path),
  json: (path) => JSON.parse(__c("read", path)),
  write: (path, text) => __c("write", path, String(text)),
  writeJson: (path, value) => __c("write", path, JSON.stringify(value, null, 2)),
  copy: (from, to) => __c("copy", from, to),
  delete: (path) => __c("delete", path),
  exists: (path) => __c("exists", path),
  guid: () => __c("guid"),
};
const print = (...a) => __print(a.map((v) => typeof v === "string" ? v : JSON.stringify(v)).join(" "));
const console = { log: print, error: print, warn: print };
`;

export interface ScriptResult {
  output: string;
  error?: string;
}

export async function runScript(ws: Workspace, code: string): Promise<ScriptResult> {
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(MEMORY);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + TIME_MS));
  const vm = runtime.newContext();
  let output = "";
  const log = (s: string) => {
    if (output.length < MAX_OUTPUT) output += `${s}\n`;
  };

  const host: Record<string, (...a: string[]) => unknown> = {
    list: (folder) => ws.list(folder),
    read: (path) => ws.text(path),
    write: (path, text) => (ws.writeText(path, text), true),
    copy: (from, to) => ws.copy(from, to),
    delete: (path) => (ws.has(path) ? [path] : ws.list(path)).map((p) => (ws.delete(p), p)),
    exists: (path) => ws.has(path),
    guid: () => crypto.randomUUID(),
  };

  try {
    fn(vm, "__print", (h) => (log(vm.getString(h)), vm.undefined));
    fn(vm, "__host", (nameH, argsH) => {
      const name = vm.getString(nameH);
      let reply: string;
      try {
        const args = JSON.parse(vm.getString(argsH)) as string[];
        if (!host[name]) throw new Error(`no ws.${name}`);
        reply = JSON.stringify({ value: host[name](...args) ?? null });
      } catch (e) {
        reply = JSON.stringify({ error: (e as Error).message });
      }
      return vm.newString(reply);
    });

    const result = vm.evalCode(`${PRELUDE}\n${code}`, "agent-script.js");
    if (result.error) {
      const err = vm.dump(result.error);
      result.error.dispose();
      return { output, error: typeof err === "object" && err ? `${err.name ?? "Error"}: ${err.message ?? JSON.stringify(err)}` : String(err) };
    }
    const value = vm.dump(result.value);
    result.value.dispose();
    if (value !== undefined) log(typeof value === "string" ? value : JSON.stringify(value, null, 1));
    return { output: output || "(no output)" };
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}

function fn(vm: QuickJSContext, name: string, body: (...args: QuickJSHandle[]) => QuickJSHandle) {
  const handle = vm.newFunction(name, body);
  vm.setProp(vm.global, name, handle);
  handle.dispose();
}
