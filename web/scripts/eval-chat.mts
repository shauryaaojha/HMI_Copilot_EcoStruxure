/**
 * The chat loop measured on one model: the same six jobs on the demo project,
 * scored by what can be scored without a person - whether the answer's ops
 * all land, how many steps and tool errors it took, tokens, rupees, seconds.
 *
 *   npm run eval:chat -- --provider openai --model z-ai/glm-5.3-flash [--jobs 3] [--out docs/eval/glm.json]
 *   npm run eval:chat -- --provider gemini --model gemini-3.8-flash
 *
 * The provider's key and endpoint come from the environment (.env.local or
 * the shell): OPENAI_API_KEY + OPENAI_BASE_URL, or GEMINI_API_KEY. Nothing
 * here says whether a layout is good; that is the person's half of the eval
 * (docs/MODEL_GATEWAY.md). This half says whether the model drives the tools.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { demoScreen, demoVariables } from "../src/fixtures/index.js";
import { docOf } from "../src/lib/collab/changes.js";
import { dryRunToDoc } from "../src/lib/collab/proposal.js";
import { digestOf } from "../src/lib/ai/converse.js";
import { agentChat } from "../src/lib/ai/agent-chat.js";
import { resolveProvider } from "../src/lib/ai/provider.js";
import { createProjectStore } from "../src/store/project.js";
import type { Op } from "../src/core/ops.js";

const env = await fs.readFile(path.join(import.meta.dirname, "..", ".env.local"), "utf8").catch(() => "");
for (const line of env.split(/\r?\n/)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
if (flag("provider")) process.env.AI_PROVIDER = flag("provider");
if (flag("model")) process.env.AI_MODEL = flag("model");
const choice = resolveProvider();
if (!choice.provider || !choice.model || (choice.provider !== "gemini" && choice.provider !== "openai")) {
  console.error(`No loop model: ${choice.reason}. The loop runs on gemini or openai.`);
  process.exit(2);
}
const { provider, model } = choice;

/** Rupees per million tokens, AICredits list 2026-11-11 at ₹93.96/$ (Google's own Gemini price is the same). Cached input is charged as input here, which overstates a little. */
const PRICE_INR: Record<string, { in: number; out: number }> = {
  "z-ai/glm-5.3-flash": { in: 7.4, out: 24.7 },
  "z-ai/glm-5.3": { in: 138, out: 434 },
  "google/gemini-3.8-flash": { in: 74, out: 370 },
  "gemini-3.8-flash": { in: 74, out: 370 },
  "gemini-flash-latest": { in: 74, out: 370 },
  "anthropic/claude-haiku-5.5": { in: 9.9, out: 49.3 },
  "anthropic/claude-opus-5.5": { in: 376, out: 1879 },
  "qwen/qwen3.8-flash": { in: 14.8, out: 46.4 },
  "deepseek/deepseek-v4.1-flash": { in: 29.6, out: 118.4 },
  "minimax/minimax-m3.1-flash": { in: 14.1, out: 56.4 },
  "xiaomi/mimo-v2.6-flash": { in: 13.2, out: 26.3 },
  "openai/gpt-6-luna": { in: 9.4, out: 47 },
};

/** The jobs, on the demo pump station. Each names what a right answer must do, so a person can judge the rest. */
const JOBS = [
  { id: "move", request: "Move the pump 1 run lamp to the right of the tank level display.", expect: "edit; one moveObject; no refused ops" },
  { id: "display", request: "Add a numeric display for the tank level, bound to its tag, below the lamp.", expect: "edit; addObject NumericDisplay bound to LT_101_PV; tag looked up, not guessed" },
  { id: "question", request: "Which tags are bound on this screen, and to what?", expect: "answer; names real bindings only" },
  { id: "button", request: "Add a start button for pump 2 that writes its run command.", expect: "edit; a Switch (not a ToggleSwitch) with setTag on PMP_102_RUN or a clarify" },
  { id: "corners", request: "Give the title text rounded corners.", expect: "a Rectangle behind it, or an answer saying only a Rectangle has corners; never a refused op" },
  { id: "two", request: "Rename this screen to Overview and add a text that shows the pump 2 fault state.", expect: "edit; renameScreen plus a bound object on PMP_102_FLT" },
];

function project() {
  const store = createProjectStore();
  store.getState().hydrate({
    id: "eval",
    name: "Pump station",
    target: { model: "HMIST6500", width: 1024, height: 600 },
    screens: [structuredClone(demoScreen)],
    activeScreenId: demoScreen.UniqueId,
    variables: structuredClone(demoVariables),
    alarms: [],
    bindings: [],
    objectMeta: {},
    screenPlacement: {},
    versions: [],
    chat: [],
  });
  return store.getState();
}

interface Row {
  job: string;
  mode: string;
  ops: number;
  refused: number;
  steps: number;
  toolErrors: number;
  tokensIn: number;
  tokensOut: number;
  cached: number;
  inr: number;
  seconds: number;
  reply: string;
  error?: string;
}

const price = PRICE_INR[model] ?? PRICE_INR[model.replace(/^google\//, "")];
const rows: Row[] = [];
const count = Number(flag("jobs") ?? JOBS.length);
console.log(`# ${provider} ${model}, ${Math.min(count, JOBS.length)} job(s)${price ? "" : " (no price known for this model; ₹ shown as 0)"}`);

for (const job of JOBS.slice(0, count)) {
  const s = project();
  const doc = docOf(s);
  const digest = digestOf({ ...s, selectedIds: [] }, job.request);
  const t0 = Date.now();
  const row: Row = { job: job.id, mode: "-", ops: 0, refused: 0, steps: 0, toolErrors: 0, tokensIn: 0, tokensOut: 0, cached: 0, inr: 0, seconds: 0, reply: "" };
  try {
    const result = await agentChat({ history: [{ role: "user", text: job.request }], digest, doc }, model, provider);
    row.seconds = (Date.now() - t0) / 1000;
    if (!result) {
      row.error = "no usable turn";
    } else {
      row.mode = result.turn.mode;
      row.ops = result.turn.ops?.length ?? 0;
      row.refused = result.turn.ops?.length ? dryRunToDoc(doc, result.turn.ops as Op[], s.activeScreenId).outcome.rejected.length : 0;
      row.steps = result.steps.length;
      row.toolErrors = result.steps.filter((st) => st.isError).length;
      row.tokensIn = result.usage?.input ?? 0;
      row.tokensOut = result.usage?.output ?? 0;
      row.cached = result.usage?.cached ?? 0;
      row.reply = result.turn.reply ?? "";
      row.inr = price ? (row.tokensIn * price.in + row.tokensOut * price.out) / 1e6 : 0;
      console.log(`\n## ${job.id}: ${job.request}\n   expect: ${job.expect}`);
      for (const st of result.steps) console.log(`   ${st.isError ? "!" : "-"} ${st.tool}: ${st.summary}`);
      console.log(`   => ${row.mode}, ${row.ops} op(s), ${row.refused} refused, ${row.steps} steps, ${row.toolErrors} tool errors, ${row.tokensIn}+${row.tokensOut} tokens (${row.cached} cached), ₹${row.inr.toFixed(2)}, ${row.seconds.toFixed(1)} s`);
      console.log(`   reply: ${row.reply.slice(0, 200)}`);
      if (result.turn.ops?.length) console.log(`   ops: ${JSON.stringify(result.turn.ops).slice(0, 400)}`);
    }
  } catch (error) {
    row.seconds = (Date.now() - t0) / 1000;
    row.error = error instanceof Error ? error.message.slice(0, 200) : String(error);
    console.log(`\n## ${job.id}: failed after ${row.seconds.toFixed(1)} s: ${row.error}`);
  }
  rows.push(row);
}

const sum = (k: keyof Row) => rows.reduce((n, r) => n + (Number(r[k]) || 0), 0);
console.log(`\n# ${provider} ${model}: ${rows.length} jobs, ${rows.filter((r) => r.error).length} failed, ${sum("refused")} refused ops in answers, ${sum("steps")} steps, ${sum("toolErrors")} tool errors, ${sum("tokensIn")}+${sum("tokensOut")} tokens, ₹${sum("inr").toFixed(2)}, ${sum("seconds").toFixed(0)} s`);

const out = flag("out");
if (out) {
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify({ provider, model, at: new Date().toISOString(), rows }, null, 2));
  console.log(`# wrote ${out}`);
}
