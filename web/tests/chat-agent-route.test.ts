/**
 * /api/chat with the agent loop: which path a turn takes, and the fallback.
 *
 * Gemini with the project in the request goes through the loop and the
 * answer carries its steps. When the loop's model is out of quota the turn is
 * still answered, by one call on the fallback model, and says so; an older
 * client that sends no project keeps the single call.
 */
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  loop: "ok" as "ok" | "quota" | "broken",
  calls: [] as string[],
}));
vi.mock("@/lib/server/model-gate", () => ({ modelCaller: async () => ({ id: "owner-a", name: "Engineer" }) }));
vi.mock("@/lib/ai/provider", () => ({ resolveProvider: () => ({ provider: "gemini", model: "gemini-3.8-flash", reason: "test" }), providerName: () => "Gemini" }));
vi.mock("@/lib/knowledge/store", async (original) => ({ ...await original<typeof import("@/lib/knowledge/store")>(), allKnowledge: async () => [] }));
vi.mock("@/lib/ai/agent-chat", () => ({
  agentChat: async (input: { onStep?: (step: unknown) => void }) => {
    state.calls.push("loop");
    if (state.loop === "quota") throw Object.assign(new Error('{"error":{"code":429,"message":"requests per day exceeded","status":"RESOURCE_EXHAUSTED"}}'), { status: 429 });
    if (state.loop === "broken") throw new Error("something else broke");
    const step = { tool: "find_tags", summary: "find_tags(PUMP): 3 tags" };
    input.onStep?.(step);
    return { provider: "gemini", model: "gemini-3.8-flash", turn: { mode: "answer", reply: "from the loop" }, steps: [step] };
  },
}));
vi.mock("@/lib/ai/converse", async (original) => ({
  ...await original<typeof import("@/lib/ai/converse")>(),
  converse: async () => {
    state.calls.push("single");
    return { provider: "gemini", model: "gemini-3.8-flash", turn: { mode: "answer", reply: "from one call" } };
  },
  withGemini: async (_input: unknown, model: string) => {
    state.calls.push(`fallback:${model}`);
    return { provider: "gemini", model, turn: { mode: "answer", reply: "from the fallback" } };
  },
}));
import { POST } from "@/app/api/chat/route";

const DOC = { screens: [], variables: [] };
const turn = (doc?: unknown, extra: Record<string, unknown> = {}) =>
  POST(
    new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ history: [{ role: "user", text: "Which tags are pumps?" }], digest: { name: "test" }, ...(doc ? { doc } : {}), ...extra }),
    }),
  );

beforeEach(() => {
  state.loop = "ok";
  state.calls = [];
  delete process.env.GEMINI_FALLBACK_MODEL;
});

it("runs a Gemini turn with the project through the loop, and returns its steps", async () => {
  const body = await (await turn(DOC)).json();
  expect(state.calls).toEqual(["loop"]);
  expect(body.turn.reply).toBe("from the loop");
  expect(body.steps).toEqual([{ tool: "find_tags", summary: "find_tags(PUMP): 3 tags" }]);
});

it("answers in one call on the fallback model when the loop's model is out of quota, and says so", async () => {
  state.loop = "quota";
  const response = await turn(DOC);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(state.calls).toEqual(["loop", "fallback:gemini-flash-lite-latest"]);
  expect(body.turn.reply).toBe("from the fallback");
  expect(body.steps[0]).toMatchObject({ tool: "fallback", isError: true });
  expect(body.steps[0].summary).toContain("out of quota");

  process.env.GEMINI_FALLBACK_MODEL = "gemini-2.5-flash";
  state.calls = [];
  await turn(DOC);
  expect(state.calls).toEqual(["loop", "fallback:gemini-2.5-flash"]);
});

it("does not hide a real failure behind the fallback", async () => {
  state.loop = "broken";
  const response = await turn(DOC);
  expect(response.status).toBe(502);
  expect(state.calls).toEqual(["loop"]);
});

it("keeps the single call for a client that sends no project", async () => {
  const body = await (await turn()).json();
  expect(state.calls).toEqual(["single"]);
  expect(body.steps).toBeUndefined();
});

it("streams each step as it happens and the turn last, when asked to", async () => {
  const response = await turn(DOC, { stream: true });
  expect(response.headers.get("content-type")).toContain("x-ndjson");
  const lines = (await response.text()).trim().split("\n").map((l) => JSON.parse(l));
  expect(lines.map((l) => l.type)).toEqual(["step", "turn"]);
  expect(lines[0].step).toEqual({ tool: "find_tags", summary: "find_tags(PUMP): 3 tags" });
  expect(lines[1].turn.reply).toBe("from the loop");
});

it("reports a failure as the last line of the stream, with the same code the JSON path sends", async () => {
  state.loop = "broken";
  const lines = (await (await turn(DOC, { stream: true })).text()).trim().split("\n").map((l) => JSON.parse(l));
  expect(lines).toEqual([{ type: "error", error: expect.stringContaining("something else broke"), code: "failed", retryable: false }]);
});

it("moves a gateway turn that ran out of budget onto the Google key, with its tools", async () => {
  vi.resetModules();
  vi.doMock("@/lib/ai/menu", () => ({ chooseModel: () => ({ provider: "openai", model: "anthropic/claude-haiku-5.5", reason: "test" }) }));
  vi.doMock("@/lib/ai/agent-chat", () => ({
    agentChat: async (_input: unknown, model: string, provider: string) => {
      state.calls.push(`${provider}:${model}`);
      if (provider === "openai") throw Object.assign(new Error("402 API Key Budget Exceeded"), { status: 402 });
      return { provider: "gemini", model, turn: { mode: "answer", reply: "from gemini" }, steps: [] };
    },
  }));
  process.env.GEMINI_API_KEY = "g";
  const { POST: post } = await import("@/app/api/chat/route");
  const response = await post(
    new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ history: [{ role: "user", text: "hi" }], digest: { name: "test" }, doc: DOC }),
    }),
  );
  const body = await response.json();
  delete process.env.GEMINI_API_KEY;
  expect(state.calls).toEqual(["openai:anthropic/claude-haiku-5.5", "gemini:gemini-3.8-flash"]);
  expect(body.turn.reply).toBe("from gemini");
});
