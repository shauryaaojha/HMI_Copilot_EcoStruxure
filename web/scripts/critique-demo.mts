/**
 * Ask the critic about a generated screen, from the command line.
 *
 *   npx tsx scripts/critique-demo.mts [sample-slug]
 *
 * Builds the sample plant through the pipeline (no key needed for that),
 * renders every screen to demo_project/renders/<name>.png, and sends the
 * first process view - or the first screen - to the critic configured in
 * .env.local. Prints the report. Used to record what the critic says about
 * our own output before a Schneider engineer does.
 */

import fs from "node:fs";
import path from "node:path";
import { runPipeline } from "../src/lib/ai/pipeline.js";
import { parseTags } from "../src/lib/tags/parse.js";
import { screenToPng } from "../src/lib/critic/render.js";
import { critique } from "../src/lib/critic/critic.js";
import { resolveProvider } from "../src/lib/ai/provider.js";
import type { Screen } from "../src/lib/ote/schema.js";

function loadEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv(path.join(process.cwd(), ".env.local"));

const slug = process.argv[2] ?? "transfer-pump-station";
const file = path.join(process.cwd(), "..", "samples", slug, "tags.csv");
const { variables } = parseTags(fs.readFileSync(file), "tags.csv");

const screens = new Map<string, Screen>();
const parts = new Map<string, Screen["Children"][0]["Children"]>();
for await (const e of runPipeline({ intent: slug.replace(/-/g, " "), variables })) {
  if (e.type === "object") {
    const list = parts.get(e.parentId) ?? [];
    list.push(e.part);
    parts.set(e.parentId, list);
    if (!screens.has(e.parentId)) {
      screens.set(e.parentId, {
        Type: "Screen",
        UniqueId: e.parentId,
        Name: e.screenName ?? "Screen",
        Children: [{ Type: "ViewBox", UniqueId: e.parentId, Name: "ViewBox", Options: 108, Width: 1024, Height: 600, Children: list }],
      });
    }
  }
}

const out = path.join(process.cwd(), "..", "demo_project", "renders");
fs.mkdirSync(out, { recursive: true });
for (const s of screens.values()) {
  fs.writeFileSync(path.join(out, `${slug}-${s.Name}.png`), await screenToPng(s));
}
console.log(`rendered ${screens.size} screens to ${path.relative(process.cwd(), out)}`);

const choice = resolveProvider();
if (!choice.provider) {
  console.log(`no critic: ${choice.reason}`);
  process.exit(0);
}
const target = [...screens.values()].find((s) => /Process$/.test(s.Name)) ?? [...screens.values()][0];
console.log(`\nasking ${choice.model} about ${target.Name}…`);
const result = await critique(target);
if (!result) {
  console.log("the critic did not answer with a report");
  process.exit(1);
}
console.log(`\n${result.report.score}/5  ${result.report.summary}\n`);
for (const f of result.report.findings) {
  console.log(`  [${f.severity}] ${f.rule}${f.object ? ` ${f.object}` : ""}: ${f.message}\n      → ${f.suggestion}`);
}
