/**
 * S3: one prompt through the chat path exactly as the Copilot's Chat tab sends it
 * (components/chat/useChat.ts `ask`): the digest and catalog built from the project store, POSTed
 * to the running server's /api/chat. Then the returned ops are dry-run and applied with the same
 * core/ops the browser uses, including the one repair call when ops are rejected. Geometry is
 * measured before and after with s3-geometry.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/audit/s3-chat-run.mts <file.eote> <screen> "<prompt>" <out.json> [--match a,b] [--select a,b]
 *
 * --select names the objects to select first, which is what an engineer does before saying "these".
 * One model call per run (two with a repair). It calls the server at S3_BASE (default http://localhost:3000).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { readProject } from "@/lib/ote/reader";
import { digestOf, type HistoryItem } from "@/lib/ai/converse";
import { applyOps, dryRun, type Op, type Turn } from "@/core/ops";
import { createProjectStore } from "@/store/project";
import { alignment, matchParts, measureScreen } from "./s3-geometry.mts";

const [file, screenName, prompt, out, ...rest] = process.argv.slice(2);
const opt = (k: string) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
const base = process.env.S3_BASE ?? "http://localhost:3000";

const read = await readProject(new Uint8Array(readFileSync(file)), file);
const screen = read.screens.find((s) => s.Name === screenName)!;
const store = createProjectStore();
store.getState().hydrate({
  name: read.name, target: read.target, screens: structuredClone(read.screens), foreign: read.foreign, activeScreenId: screen.UniqueId,
  variables: structuredClone(read.variables), alarms: structuredClone(read.alarms),
  bindings: read.wires.map((w) => ({ tag: w.tag, targetId: w.part.UniqueId, targetName: w.part.Name, property: w.property })),
} as never);
const selectNames = (opt("--select") ?? "").split(",").filter(Boolean);
if (selectNames.length) {
  const ids = store.getState().screens.find((s) => s.UniqueId === screen.UniqueId)!.Children[0].Children.filter((p) => selectNames.includes(p.Name)).map((p) => p.UniqueId);
  store.setState({ selectedIds: ids } as never);
}

const snap = () => structuredClone(store.getState().screens.find((s) => s.UniqueId === screen.UniqueId)!);
const before = snap();
const terms = (opt("--match") ?? "").split(",").filter(Boolean);

async function ask(history: HistoryItem[], repair: boolean) {
  const s = store.getState();
  const body = {
    history, repair,
    catalog: {
      alarms: s.alarms,
      tags: s.variables.map((v) => ({ name: v.Name, dataType: v.DataType, comment: v.Comments ?? "" })),
      objects: s.screens.flatMap((sc) => sc.Children[0].Children.map((p) => ({ handle: s.handles[p.UniqueId] ?? "?", name: p.Name, type: p.Type, screen: s.handles[sc.UniqueId] ?? sc.Name }))),
    },
    digest: digestOf({ name: s.name, target: s.target, screens: s.screens, foreign: s.foreign, activeScreenId: s.activeScreenId, variables: s.variables, alarms: s.alarms, bindings: s.bindings, selectedIds: s.selectedIds, handles: s.handles }, prompt),
  };
  const at = new Date().toISOString();
  const t = performance.now();
  const r = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await r.json()) as { turn?: Turn; error?: string; code?: string; model?: string; usage?: unknown };
  return { at, ms: Math.round(performance.now() - t), status: r.status, ...json };
}

const calls: unknown[] = [];
const first = await ask([{ role: "user", text: prompt }], false);
calls.push(first);
let ops: Op[] = first.turn?.mode === "edit" ? first.turn.ops ?? [] : [];
let run = dryRun(ops, store);
if (run.outcome.rejected.length > 0 && ops.length > 0) {
  const second = await ask([{ role: "user", text: prompt }, { role: "assistant", text: first.turn!.reply, turn: { mode: "edit", applied: run.outcome.applied, rejected: run.outcome.rejected.map((r) => ({ op: r.op.op, reason: r.reason })), renamed: run.outcome.renamed } }], true);
  calls.push(second);
  if (second.turn?.mode === "edit" && second.turn.ops?.length) { ops = second.turn.ops; run = dryRun(ops, store); }
}
const outcome = ops.length ? applyOps(ops, store) : null;
const after = snap();

const mb = matchParts(before, terms), ma = matchParts(after, terms);
const result = {
  prompt, calls, ops, outcome: outcome && { applied: outcome.applied, rejected: outcome.rejected.map((r) => ({ op: r.op.op, reason: r.reason })) },
  before: { ...measureScreen(before, read.target), matched: mb, alignment: alignment(mb.flatMap((m) => (m.box ? [m.box] : []))) },
  after: { ...measureScreen(after, read.target), matched: ma, alignment: alignment(ma.flatMap((m) => (m.box ? [m.box] : []))) },
};
writeFileSync(out, JSON.stringify(result, null, 2));
const short = (x: typeof result.before) => ({ oob: x.outOfBounds, overlaps: x.overlaps, overlapPx: x.overlapArea, labelOverlaps: x.labelOverlaps, labelPx: x.labelOverlapArea, align: x.alignment });
console.log(JSON.stringify({ calls: calls.map((c) => { const k = c as { at: string; ms: number; status: number; code?: string; error?: string; turn?: Turn }; return { at: k.at, ms: k.ms, status: k.status, code: k.code, error: k.error?.slice(0, 160), mode: k.turn?.mode, reply: k.turn?.reply }; }), ops, outcome: result.outcome, before: short(result.before), after: short(result.after) }, null, 1));
