/**
 * Record a real conversational session as a transcript that replays without
 * a key. docs/PLAN_PHASE2.md item 3; docs/PLAN_PHASE1.md item 6.
 *
 *   npx tsx scripts/record-session.mts --name "pump edits" --seed demo-full \
 *     --out tests/transcripts/recorded-pump-edits.json \
 *     "add a lamp for the standby pump" "move it right of the flow reading"
 *
 * Each request goes through the same path the client uses: the live provider
 * (from .env.local), the dry run on a scratch store, one repair pass when
 * something was rejected, and a commit only when the turn came back clean.
 * The model's final answer for each turn is written down with what the
 * applier made of it, so tests/transcripts.test.ts can replay the answer
 * against the same invariants forever, whatever the model does next week.
 *
 * Nothing here touches the browser store or a saved project.
 */

import fs from "node:fs";
import path from "node:path";
import { converse, describeOp, digestOf, type HistoryItem, type TurnRecord } from "../src/lib/ai/converse.js";
import { resolveProvider } from "../src/lib/ai/provider.js";
import { dryRun, commit, type OpOutcome } from "../src/lib/ai/applier.js";
import { coerceTurn, type Turn } from "../src/lib/ai/ops.js";
import { createProjectStore } from "../src/store/project.js";
import { demoScreen, demoVariables } from "../src/fixtures/index.js";

/* --- .env.local, without a dependency ------------------------------------ */
function loadEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv(path.join(process.cwd(), ".env.local"));

/* --- arguments ------------------------------------------------------------ */
const args = process.argv.slice(2);
const option = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= args.length) return fallback;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const name = option("name", "recorded session")!;
const seed = (option("seed", "demo-full") as "demo-full" | "demo-sparse");
const out = option("out", `tests/transcripts/recorded-${Date.now()}.json`)!;
const requests = args.filter((a) => !a.startsWith("--"));

if (requests.length === 0) {
  console.error("Give at least one request after the options.");
  process.exit(2);
}

const choice = resolveProvider();
if (!choice.provider || !choice.model) {
  console.error(`No provider: ${choice.reason}`);
  process.exit(2);
}

/* --- the store, seeded as the replay seeds it ---------------------------- */
const store = createProjectStore();
{
  const screen = structuredClone(demoScreen);
  if (seed === "demo-sparse") screen.Children[0].Children = screen.Children[0].Children.slice(0, 1);
  store.getState().hydrate({
    id: "record",
    name: "Recorded",
    target: { model: "HMIGTO6310", width: 1024, height: 600 },
    screens: [screen],
    activeScreenId: screen.UniqueId,
    variables: structuredClone(demoVariables),
  });
}

function recordOf(mode: Turn["mode"], outcome: OpOutcome): TurnRecord {
  return {
    mode,
    applied: outcome.applied,
    rejected: outcome.rejected.map((r) => ({ op: describeOp(r.op), reason: r.reason })),
    renamed: outcome.renamed,
  };
}

async function ask(history: HistoryItem[], request: string, repair: boolean) {
  const s = store.getState();
  const result = await converse({
    history,
    repair,
    catalog: {
      tags: s.variables.map((v) => ({ name: v.Name, dataType: v.DataType, comment: v.Comments ?? "" })),
      objects: s.screens.flatMap((screen) =>
        screen.Children[0].Children.map((p) => ({
          handle: s.handles[p.UniqueId] ?? "?",
          name: p.Name,
          type: p.Type,
          screen: s.handles[screen.UniqueId] ?? screen.Name,
          tag: s.bindings.find((b) => b.targetId === p.UniqueId)?.tag,
        })),
      ),
    },
    digest: digestOf(
      {
        name: s.name,
        target: s.target,
        screens: s.screens,
        activeScreenId: s.activeScreenId,
        variables: s.variables,
        alarms: s.alarms,
        bindings: s.bindings,
        selectedIds: s.selectedIds,
        handles: s.handles,
      },
      request,
    ),
  });
  if (!result) throw new Error("the provider answered nothing");
  return result;
}

/* --- the session ---------------------------------------------------------- */
interface Recorded {
  request: string;
  turn: unknown;
  repaired: boolean;
  reply: string;
  expect: { rejected: number; applied: number; created: number; renamed: number; deleted: boolean };
}

const history: HistoryItem[] = [];
const turns: Recorded[] = [];

console.log(`${choice.reason} · ${choice.model} · seed ${seed}\n`);

for (const request of requests) {
  process.stdout.write(`> ${request}\n`);
  const first = await ask([...history, { role: "user", text: request }], request, false);
  let turn = coerceTurn(first.turn) ?? first.turn;
  let repaired = false;
  let outcome: OpOutcome | null = null;

  if (turn.mode === "edit") {
    let run = dryRun(turn.ops ?? [], store);
    if (run.outcome.rejected.length > 0 && (turn.ops ?? []).length > 0) {
      const record = recordOf("edit", run.outcome);
      const second = await ask(
        [...history, { role: "user", text: request }, { role: "assistant", text: turn.reply, turn: record }],
        request,
        true,
      );
      const again = coerceTurn(second.turn) ?? second.turn;
      if (again.mode === "edit" && again.ops && again.ops.length > 0) {
        turn = again;
        run = dryRun(again.ops, store);
        repaired = true;
      }
    }
    outcome = run.outcome;
    const clean = run.outcome.rejected.length === 0 && !run.outcome.deleted;
    if (clean && (turn.ops ?? []).length > 0) commit(run, "recorded", store);
    for (const line of run.outcome.applied) console.log(`  + ${line}`);
    for (const r of run.outcome.rejected) console.log(`  x ${describeOp(r.op)}: ${r.reason}`);
  } else {
    console.log(`  (${turn.mode}) ${turn.reply}`);
  }

  const record: TurnRecord = outcome
    ? recordOf("edit", outcome)
    : { mode: turn.mode, applied: [], rejected: [], renamed: [] };
  history.push({ role: "user", text: request }, { role: "assistant", text: turn.reply, turn: record });

  turns.push({
    request,
    turn,
    repaired,
    reply: turn.reply,
    expect: {
      rejected: outcome?.rejected.length ?? 0,
      applied: outcome?.applied.length ?? 0,
      created: outcome?.created.length ?? 0,
      renamed: outcome?.renamed.length ?? 0,
      deleted: outcome?.deleted ?? false,
    },
  });
}

const transcript = {
  name,
  seed,
  recorded: { provider: choice.provider, model: choice.model, at: new Date().toISOString() },
  turns,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(transcript, null, 2) + "\n");
console.log(`\nwrote ${out} (${turns.length} turns)`);
