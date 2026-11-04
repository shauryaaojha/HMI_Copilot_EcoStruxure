/**
 * S3-04: the model-calling routes have no caller check, no rate limit and no body cap.
 *
 * /api/chat (src/app/api/chat/route.ts:61), /api/critique (critique/route.ts:25) and
 * /api/agent (agent/route.ts:36, with an anonymous import id) call the configured model
 * for anyone who can reach the deployment. The only per-user/per-project limit in the app
 * is on MCP `generate` (lib/mcp/generate.ts:399-400). So one script spends the shared
 * Gemini/Claude key without signing in, and a request body of any size is forwarded.
 *
 * The model itself is mocked here: the test counts how many model calls the routes let
 * through, it does not make any.
 */
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoScreen } from "@/fixtures";

const web = path.resolve(import.meta.dirname, "..", "..");

const calls = vi.hoisted(() => ({ converse: 0, critique: 0 }));
vi.mock("@/lib/server/session", () => ({ currentUser: async () => null }));
vi.mock("@/lib/ai/converse", async (original) => ({
  ...(await original<typeof import("@/lib/ai/converse")>()),
  converse: async () => { calls.converse++; return { turn: { mode: "answer", reply: "ok" }, provider: "gemini", model: "mock" }; },
}));
vi.mock("@/lib/critic/critic", () => ({
  critique: async () => { calls.critique++; return { report: { summary: "ok", score: 3, findings: [] }, provider: "gemini", model: "mock" }; },
}));
vi.mock("@/lib/knowledge/store", async (original) => ({ ...(await original<typeof import("@/lib/knowledge/store")>()), allKnowledge: async () => [] }));
import { POST as chat } from "@/app/api/chat/route";
import { POST as critiqueRoute } from "@/app/api/critique/route";

const digest = { name: "x", target: { model: "m", width: 1024, height: 600 }, screens: [], equipment: [], variables: [], variableCount: 0, alarms: [], bindings: [], selection: [], structureHash: "0" };
const post = (body: unknown) => new Request("https://hmi.example.com/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  calls.converse = 0; calls.critique = 0;
  vi.stubEnv("AI_PROVIDER", "gemini");
  vi.stubEnv("GEMINI_API_KEY", "test-key-not-real");
});

describe("S3-04 model routes are open to anonymous, unlimited callers", () => {
  it("/api/chat refuses an anonymous caller, or rate-limits 50 calls in a row", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 50; i++) statuses.push((await chat(post({ history: [{ role: "user", text: `turn ${i}` }], digest }))).status);
    const refused = statuses.filter((s) => s === 401 || s === 403 || s === 429).length;
    expect(refused, `50 anonymous /api/chat calls: statuses ${[...new Set(statuses)].join(",")}, model calls let through: ${calls.converse}`).toBeGreaterThan(0);
  });

  it("/api/chat refuses a 4 MB request body", async () => {
    const huge = "x".repeat(4 * 1024 * 1024);
    const r = await chat(post({ history: [{ role: "user", text: huge }], digest }));
    expect([400, 413], `a 4 MB user turn answered ${r.status} and reached the model (${calls.converse} call)`).toContain(r.status);
  });

  it("/api/critique refuses an anonymous caller", async () => {
    const r = await critiqueRoute(new Request("https://hmi.example.com/api/critique", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ screen: demoScreen }) }));
    expect([401, 403, 429], `anonymous /api/critique answered ${r.status}; model calls: ${calls.critique}`).toContain(r.status);
  });
});
