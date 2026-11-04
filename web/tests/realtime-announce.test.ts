/**
 * S2-04 (docs/audit/BUGS.md), moved from web/scripts/audit/ with the fix. Before it, only POST /api/projects/[id]/changes announces a new revision on
 * Supabase Realtime (src/app/api/projects/[id]/changes/route.ts:32-40). Four
 * other writes move the project's revision and announce nothing, so a
 * session on the Realtime transport (lib/collab/realtime.ts), which learns of
 * new revisions only from broadcasts, does not see them until somebody else
 * happens to POST a change:
 *   - accepting a Copilot proposal (lib/server/proposals.ts:148)
 *   - a whole-snapshot save (app/api/projects/[id]/route.ts:24)
 *   - restoring a version (app/api/projects/[id]/versions/route.ts:16)
 *   - a direct MCP write (lib/mcp/write.ts:236) - not exercised here (S3).
 * The broadcast endpoint is stubbed; nothing leaves the process.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { demoScreen, demoVariables } from "@/fixtures";
import { MemoryRepo, type Snapshot, type User } from "@/lib/server/repo";
import type { Op } from "@/lib/ai/ops";
import { sample } from "./fixtures/collab";

const state = vi.hoisted(() => ({ repo: null as unknown as MemoryRepo, user: null as User | null }));
vi.mock("@/lib/server/repo", async original => ({ ...await original<typeof import("@/lib/server/repo")>(), repo: () => state.repo }));
vi.mock("@/lib/server/session", () => ({ currentUser: async () => state.user }));
// `after` has no request scope outside Next; run the callback at once, as Next would after the response.
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: (fn: () => unknown) => { void fn(); } }));

import { decideProposal, proposeEdit } from "@/lib/server/proposals";
import { PUT as save } from "@/app/api/projects/[id]/route";
import { POST as restore } from "@/app/api/projects/[id]/versions/route";
import { POST as changes } from "@/app/api/projects/[id]/changes/route";

const ID = "project-test";
const broadcasts: unknown[] = [];

beforeEach(async () => {
  vi.stubEnv("AI_PROVIDER", "none");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://realtime.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  broadcasts.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (String(url).includes("/realtime/v1/api/broadcast")) { const body = JSON.parse(String(init.body)); if (body.messages[0].event === "revision") broadcasts.push(body); }
    return new Response(null, { status: 202 });
  }));
  state.repo = new MemoryRepo();
  state.user = { id: "alice", name: "Alice" };
  const snapshot: Snapshot = { ...sample(ID), screens: [structuredClone(demoScreen)], variables: structuredClone(demoVariables) };
  await state.repo.projects.create("alice", snapshot);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const ctx = { params: Promise.resolve({ id: ID }) };
const req = (method: string, body: unknown) => new Request(`http://localhost/api/projects/${ID}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const flush = () => new Promise(resolve => setTimeout(resolve, 10));

it("control: a posted change is announced", async () => {
  const rev = (await state.repo.versions.current(ID))!.rev;
  const response = await changes(req("POST", { base: rev, changes: [{ id: "c1", base: rev, ops: [{ kind: "setField", field: "name", value: "Renamed" }] }] }), ctx);
  expect((await response.json()).accepted).toEqual(["c1"]);
  await flush();
  expect(broadcasts).toHaveLength(1);
});

it("announces an accepted Copilot proposal", async () => {
  const move: Op = { op: "moveObject", target: "Lamp_PUMP1_RUN", left: 400, top: 300 };
  const proposal = await proposeEdit(state.user, ID, { screenId: demoScreen.UniqueId, request: "move", ops: [move] }, state.repo);
  const before = (await state.repo.versions.current(ID))!.rev;
  await decideProposal(state.user, ID, proposal._id, { action: "accept" }, state.repo);
  const after = (await state.repo.versions.current(ID))!.rev;
  await flush();
  expect({ revMoved: after > before, broadcasts: broadcasts.length }, "accepting a proposal moved the revision without a broadcast").toEqual({ revMoved: true, broadcasts: 1 });
  // (only revision notices are counted; proposal hints are S4-22, tests/realtime-proposals.test.ts)
});

it("announces a whole-snapshot save", async () => {
  const response = await save(req("PUT", { rev: 1, snapshot: { ...sample(ID), name: "Saved" } }), ctx);
  expect(response.status).toBe(200);
  await flush();
  expect(broadcasts.length, "PUT /api/projects/[id] moved the revision without a broadcast").toBe(1);
});

it("announces a restore", async () => {
  await state.repo.projects.save(ID, 1, { ...sample(ID), name: "Second" }, "alice");
  const response = await restore(req("POST", { rev: 1 }), ctx);
  expect(response.status).toBe(200);
  await flush();
  expect(broadcasts.length, "POST /api/projects/[id]/versions moved the revision without a broadcast").toBe(1);
});
