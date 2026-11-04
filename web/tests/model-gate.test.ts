/**
 * S2-02 (docs/audit/BUGS.md), moved from web/scripts/audit/ with the fix.: the routes that spend the model (and the server's CPU) take no
 * identity. On a deployment with accounts (VERCEL=1, AUTH_SECRET set) and
 * nobody signed in, /api/chat and /api/brief/draft still call the model.
 * The model calls are mocked here, so this spends no quota: the assertion is
 * that an anonymous caller is refused before the model is reached.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ converse: 0, brief: 0 }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/ai/provider", async (original) => ({
  ...(await original<typeof import("@/lib/ai/provider")>()),
  resolveProvider: () => ({ provider: "gemini", model: "mocked", reason: "test" }),
}));
vi.mock("@/lib/ai/converse", () => ({
  converse: vi.fn(async () => { calls.converse += 1; return { provider: "gemini", model: "mocked", turn: { mode: "answer", reply: "spent" } }; }),
}));
vi.mock("@/lib/knowledge/store", () => ({ allKnowledge: async () => [] }));
vi.mock("@/lib/brief/draft", () => ({ draftBrief: vi.fn(async () => { calls.brief += 1; return { brief: {}, by: "model" }; }) }));
vi.mock("@/lib/brief/evidence", () => ({ suggestionsFor: async () => [] }));

import { POST as chat } from "@/app/api/chat/route";
import { POST as brief } from "@/app/api/brief/draft/route";

beforeEach(() => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("AUTH_SECRET", "test-only-secret");
  calls.converse = 0; calls.brief = 0;
});
afterEach(() => vi.unstubAllEnvs());

const post = (url: string, body: unknown) =>
  new Request(`https://hmibuildtimecopilot.vercel.app${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

it("refuses an anonymous chat turn before calling the model", async () => {
  const response = await chat(post("/api/chat", { history: [{ role: "user", text: "hi" }], digest: { name: "x" } }));
  expect({ status: response.status, modelCalls: calls.converse }, "anonymous POST /api/chat reached the model").toEqual({ status: 401, modelCalls: 0 });
});

it("refuses an anonymous brief draft before calling the model", async () => {
  const response = await brief(post("/api/brief/draft", { intent: "two pumps and a tank" }));
  expect({ status: response.status, modelCalls: calls.brief }, "anonymous POST /api/brief/draft reached the model").toEqual({ status: 401, modelCalls: 0 });
});

it("refuses a 4 MB chat turn from a signed-in caller before calling the model", async () => {
  vi.stubEnv("VERCEL", ""); vi.stubEnv("AUTH_SECRET", ""); // laptop mode: the local engineer is signed in
  const huge = "x".repeat(4 * 1024 * 1024);
  const response = await chat(post("/api/chat", { history: [{ role: "user", text: huge }], digest: { name: "x" } }));
  expect({ status: response.status, modelCalls: calls.converse }, "a 4 MB chat body reached the model").toEqual({ status: 413, modelCalls: 0 });
});
