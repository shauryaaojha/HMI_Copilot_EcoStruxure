/**
 * The agent route spends the model like /api/chat does, so it passes the same
 * gate: a caller over the per-user window is refused before a screen is taken
 * or the loop starts (lib/server/model-gate.ts).
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ServerError } from "@/lib/server/errors";

const calls = vi.hoisted(() => ({ started: 0, counted: [] as string[], allow: true }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/server/rate-limit", () => ({
  countAttempt: vi.fn(async (scope: string) => {
    calls.counted.push(scope);
    if (!calls.allow) throw new ServerError(429, "rate_limited", "Too many calls");
  }),
}));
vi.mock("@/lib/server/agent-run", () => ({
  startAgent: vi.fn(async () => { calls.started += 1; return { screenId: "s", mode: "build", goal: "" }; }),
  runAgentOnSnapshot: vi.fn(async () => undefined),
}));
vi.mock("next/server", () => ({ after: vi.fn() }));

import { POST } from "@/app/api/projects/[id]/agent/route";

const call = () =>
  POST(
    new Request("https://hmibuildtimecopilot.vercel.app/api/projects/p1/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ screenId: "s", mode: "build" }) }),
    { params: Promise.resolve({ id: "p1" }) } as never,
  );

beforeEach(() => { calls.started = 0; calls.counted = []; calls.allow = true; });
afterEach(() => vi.unstubAllEnvs());

it("refuses an anonymous caller before the run starts", async () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("AUTH_SECRET", "test-only-secret");
  const response = await call();
  expect({ status: response.status, started: calls.started }).toEqual({ status: 401, started: 0 });
});

it("counts each run against the caller's model window", async () => {
  vi.stubEnv("VERCEL", ""); vi.stubEnv("AUTH_SECRET", "");
  const response = await call();
  expect(response.status).toBe(202);
  expect(calls.counted).toEqual(["model-user"]);
});

it("refuses a caller over the window before the run starts", async () => {
  vi.stubEnv("VERCEL", ""); vi.stubEnv("AUTH_SECRET", "");
  calls.allow = false;
  const response = await call();
  expect({ status: response.status, started: calls.started }).toEqual({ status: 429, started: 0 });
});
