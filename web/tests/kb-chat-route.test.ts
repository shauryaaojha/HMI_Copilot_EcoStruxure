import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import type { ProjectKnowledge } from "@/lib/knowledge/scan";

const state = vi.hoisted(() => ({ reads: 0, available: true, provider: null as string | null, seen: [] as unknown[] }));
vi.mock("@/lib/server/model-gate", () => ({ modelCaller: async () => ({ id: "owner-a", name: "Engineer" }) }));
vi.mock("@/lib/ai/provider", () => ({ resolveProvider: () => ({ provider: state.provider, model: "m", reason: "no key" }), providerName: () => "none" }));
vi.mock("@/lib/knowledge/store", async (original) => ({
  ...await original<typeof import("@/lib/knowledge/store")>(),
  allKnowledge: async () => {
    state.reads++;
    return [{ id: "a", ownerId: "owner-a", fileName: "mine.eote" }, { id: "b", ownerId: "owner-b", fileName: "theirs.eote" }] as ProjectKnowledge[];
  },
}));
vi.mock("@/lib/kb", async (original) => {
  const module = await original<typeof import("@/lib/kb")>();
  return { ...module, loadKb: () => state.available ? module.codeKb() : undefined };
});
vi.mock("@/lib/ai/converse", async (original) => ({
  ...await original<typeof import("@/lib/ai/converse")>(),
  converse: async (input: { knowledge?: ProjectKnowledge[]; kb?: unknown }) => {
    state.seen.push(input);
    return { provider: "gemini", model: "m", turn: { mode: "answer", reply: "ok" } };
  },
}));
import { POST } from "@/app/api/chat/route";
import { codeKb } from "@/lib/kb";

const turn = () => POST(new Request("http://localhost:3000/api/chat", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ history: [{ role: "user", text: "How do I show a level?" }], digest: { name: "test" } }) }));

beforeEach(() => {
  Object.assign(state, { reads: 0, available: true, provider: null, seen: [] });
});

it("records the index version on a chat turn, and reads no scans with no model to give them to", async () => {
  const response = await turn();
  expect(response.status).toBe(200);
  expect((await response.json()).trace.kb).toEqual(codeKb().version);
  expect(state.reads).toBe(0);
});

it("keeps the chat turn alive when the index cannot load", async () => {
  state.available = false;
  const response = await turn();
  expect(response.status).toBe(200);
  expect((await response.json()).trace.kb).toBeNull();
});

it("gives a turn the index and the caller's own scans, never another account's", async () => {
  state.provider = "gemini";
  const response = await turn();
  expect((await response.json()).trace.kb).toEqual(codeKb().version);
  const input = state.seen[0] as { knowledge: ProjectKnowledge[]; kb: unknown };
  expect(input.kb).toBeDefined();
  expect(input.knowledge.map((record) => record.fileName)).toEqual(["mine.eote"]);
});

it("keeps the index out of what the browser downloads", () => {
  // useChat imports lib/ai/converse, which imports lib/ai/tools.
  for (const file of ["src/lib/ai/converse.ts", "src/lib/ai/tools.ts", "src/lib/kb/serve.ts"]) {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    expect(source, file).not.toMatch(/^import (?!type )[^\n]*from "(@\/lib\/kb|\.\/index|\.)";/m);
  }
});
