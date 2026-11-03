/**
 * The agent at a terminal: open a project, give it a job, watch every step.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/agent.mts <file.eote> "<what to do>" [--out <file.eote>]
 *
 * Uses the provider the app uses (.env.local: AI_PROVIDER, ANTHROPIC_API_KEY
 * or GEMINI_API_KEY; AGENT_MODEL to choose the model). With --out, the
 * project is written there when anything changed; without it nothing is
 * saved. lib/agent/run.ts.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { Workspace } from "../src/lib/agent/workspace.js";
import { runAgent } from "../src/lib/agent/run.js";

const env = await fs.readFile(path.join(import.meta.dirname, "..", ".env.local"), "utf8").catch(() => "");
for (const line of env.split(/\r?\n/)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const out = outAt >= 0 ? args.splice(outAt, 2)[1] : undefined;
const [file, instruction] = args;
if (!file || !instruction) {
  console.error('usage: agent.mts <file.eote> "<what to do>" [--out <file.eote>]');
  process.exit(2);
}

const ws = await Workspace.open(new Uint8Array(await fs.readFile(file)), path.basename(file));
let tokens = { input: 0, output: 0, cached: 0 };
for await (const e of runAgent({ ws, instruction })) {
  if (e.type === "status") console.log(`# ${e.message}`);
  else if (e.type === "text") console.log(`\n${e.text}\n`);
  else if (e.type === "tool") console.log(`> ${e.name}${e.writes ? " (writes)" : ""} ${JSON.stringify(e.input).slice(0, 160)}`);
  else if (e.type === "result") console.log(`  ${e.ok ? "ok" : "ERR"} ${e.summary}${e.image ? " [image]" : ""}`);
  else if (e.type === "usage") tokens = { input: tokens.input + e.input, output: tokens.output + e.output, cached: tokens.cached + e.cached };
  else if (e.type === "error") console.log(`! ${e.message}`);
  else if (e.type === "done") {
    console.log(`# done with ${e.provider} ${e.model}: ${e.changes.length} file(s) changed; tokens in ${tokens.input} (cached ${tokens.cached}), out ${tokens.output}`);
    for (const c of e.changes) console.log(`  ${c.kind} ${c.path}`);
    if (out && e.changes.length) {
      await fs.writeFile(out, await ws.toBytes());
      console.log(`# wrote ${out}`);
    }
  }
}
