/**
 * Runs one chat turn through the agent loop (lib/ai/agent-chat.ts) against a
 * saved project JSON, and prints every step and the turn it finished with.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/chat-loop.mts <project.json> "<request>"
 *
 * The project file is a v3 PersistedProject, as scripts/seed-look.mts writes
 * one. Uses GEMINI_API_KEY and GEMINI_MODEL from .env.local; nothing is saved.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const text = await readFile(join(process.cwd(), ".env.local"), "utf8").catch(() => "");
for (const line of text.split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const [file, request] = process.argv.slice(2);
if (!file || !request) {
  console.error('Usage: chat-loop.mts <project.json> "<request>"');
  process.exit(1);
}

const { docOf } = await import("@/lib/collab/changes");
const { digestOf } = await import("@/lib/ai/converse");
const { agentChat } = await import("@/lib/ai/agent-chat");
const { resolveProvider } = await import("@/lib/ai/provider");

const { createProjectStore } = await import("@/store/project");
const raw = JSON.parse(await readFile(file, "utf8"));
const saved = raw.project ?? raw;
// Through a store, as the app loads it, so every object has its handle.
const store = createProjectStore();
store.getState().hydrate({ ...saved, objectMeta: saved.objectMeta ?? {}, handles: saved.handles ?? {}, handleSeq: saved.handleSeq ?? 0 });
const doc = docOf(store.getState());
const digest = digestOf(
  {
    name: doc.name,
    target: doc.target,
    screens: doc.screens,
    foreign: doc.foreign,
    activeScreenId: saved.activeScreenId ?? doc.screens[0]?.UniqueId,
    variables: doc.variables,
    alarms: doc.alarms,
    bindings: doc.bindings,
    selectedIds: [],
    handles: doc.handles ?? {},
    structure: doc.tagImport?.structure,
  },
  request,
);
const catalog = {
  alarms: doc.alarms,
  tags: doc.variables.map((v) => ({ name: v.Name, dataType: v.DataType, comment: v.Comments ?? "" })),
  objects: doc.screens.flatMap((screen) =>
    screen.Children[0].Children.map((p) => ({
      handle: doc.handles?.[p.UniqueId] ?? "?",
      name: p.Name,
      type: p.Type,
      screen: doc.handles?.[screen.UniqueId] ?? screen.Name,
      tag: doc.bindings.find((b) => b.targetId === p.UniqueId)?.tag,
    })),
  ),
};

const choice = resolveProvider();
console.log(`model ${choice.model}\n`);
const started = Date.now();
const result = await agentChat({ history: [{ role: "user", text: request }], digest, catalog, doc, structure: doc.tagImport?.structure }, choice.model!);
if (!result) {
  console.log("no turn");
  process.exit(1);
}
for (const [i, step] of result.steps.entries()) console.log(`${String(i + 1).padStart(2, "0")} ${step.isError ? "!" : " "} ${step.summary}`);
console.log(`\nturn: ${result.turn.mode}  "${result.turn.reply}"`);
for (const op of result.turn.ops ?? []) console.log(`  ${JSON.stringify(op)}`);
console.log(`\n${((Date.now() - started) / 1000).toFixed(1)} s, tokens ${JSON.stringify(result.usage)}`);
