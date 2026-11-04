/**
 * S4-22 (docs/audit/BUGS.md): with Supabase Realtime on, a proposal or an agent
 * step never reached the open tab. The event stream polls them off the store
 * (lib/server/proposals.ts proposalEvents), but a Realtime session has no event
 * stream, and nothing was broadcast on the channel for them, so the proposal
 * card showed only after a reload.
 *
 * Server half: making, deciding a proposal and each agent step broadcast on the
 * project's channel. Client half: the Realtime transport turns those
 * broadcasts into the session's `proposal` and `agent` handlers. The broadcast
 * endpoint and the Supabase client are doubles; nothing leaves the process.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoScreen, demoVariables } from "@/fixtures";
import { MemoryRepo, type Snapshot, type User } from "@/lib/server/repo";
import type { Op } from "@/lib/ai/ops";
import { sample } from "./fixtures/collab";

const state = vi.hoisted(() => ({ repo: null as unknown as MemoryRepo, user: null as User | null }));
vi.mock("@/lib/server/repo", async original => ({ ...await original<typeof import("@/lib/server/repo")>(), repo: () => state.repo }));
vi.mock("@/lib/server/session", () => ({ currentUser: async () => state.user }));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: (fn: () => unknown) => { void fn(); } }));

/** The channel's listeners, by broadcast event, as the transport registered them. */
const channel = vi.hoisted(() => ({ listeners: new Map<string, (message: { payload: unknown }) => void>() }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    realtime: { setAuth: async () => undefined },
    channel: () => {
      const ch = {
        on: (_type: string, filter: { event: string }, fn: (message: { payload: unknown }) => void) => {
          channel.listeners.set(filter.event, fn);
          return ch;
        },
        subscribe: () => ch,
      };
      return ch;
    },
    removeChannel: async () => undefined,
  }),
}));

import { decideProposal, proposeEdit } from "@/lib/server/proposals";
import { runAgentOnSnapshot } from "@/lib/server/agent-run";
import { realtimeTransport } from "@/lib/collab/realtime";

const ID = "project-test";
const flush = () => new Promise(resolve => setTimeout(resolve, 10));

describe("the server broadcasts proposals and agent steps", () => {
  const events: { event: string; payload: Record<string, unknown> }[] = [];
  beforeEach(async () => {
    vi.stubEnv("AI_PROVIDER", "none");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://realtime.invalid");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    events.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).includes("/realtime/v1/api/broadcast")) events.push(...JSON.parse(String(init.body)).messages);
      return new Response(null, { status: 202 });
    }));
    state.repo = new MemoryRepo();
    state.user = { id: "alice", name: "Alice" };
    const snapshot: Snapshot = { ...sample(ID), screens: [structuredClone(demoScreen)], variables: structuredClone(demoVariables) };
    await state.repo.projects.create("alice", snapshot);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("a new proposal and its decision each send a proposal hint", async () => {
    const move: Op = { op: "moveObject", target: "Lamp_PUMP1_RUN", left: 400, top: 300 };
    const proposal = await proposeEdit(state.user, ID, { screenId: demoScreen.UniqueId, request: "move", ops: [move] }, state.repo);
    await flush();
    expect(events.filter(e => e.event === "proposal"), "a new proposal sent nothing on the channel").toHaveLength(1);
    await decideProposal(state.user, ID, proposal._id, { action: "discard" }, state.repo);
    await flush();
    expect(events.filter(e => e.event === "proposal"), "a decided proposal sent nothing on the channel").toHaveLength(2);
  });

  it("each agent step is broadcast with its requester", async () => {
    await state.repo.locks.acquire(ID, demoScreen.UniqueId, "alice", "Alice");
    await runAgentOnSnapshot(state.user!, ID, { screenId: demoScreen.UniqueId, mode: "repair", goal: "tidy" }, state.repo).catch(() => undefined);
    const steps = events.filter(e => e.event === "agent");
    expect(steps.length, "an agent run sent no step on the channel").toBeGreaterThan(0);
    expect(steps.every(s => s.payload.holder === "alice" && s.payload.screenId === demoScreen.UniqueId)).toBe(true);
  });
});

describe("the Realtime transport hands proposals and agent steps to the session", () => {
  const proposal = { _id: "p1", projectId: "p1", status: "open" };
  beforeEach(() => {
    channel.listeners.clear();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/realtime-token")) return Response.json({ token: "t", topic: "project:p1", expiresIn: 900, url: "https://x.supabase.co", anonKey: "anon", userId: "alice" });
      if (url.includes("/proposals")) return Response.json({ proposals: [proposal] });
      return Response.json({ changes: [] });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a proposal hint fetches the list; an agent step reaches only its requester", async () => {
    const got = { proposals: [] as unknown[], steps: [] as unknown[] };
    const close = realtimeTransport.subscribe("p1", 0, {
      change: () => undefined, reset: () => undefined, presence: () => undefined, closed: () => undefined,
      proposal: body => got.proposals.push(body),
      agent: body => got.steps.push(body),
    });
    await flush();
    expect([...channel.listeners.keys()], "the channel listens for no proposal or agent event").toEqual(expect.arrayContaining(["proposal", "agent"]));
    channel.listeners.get("proposal")!({ payload: { projectId: "p1" } });
    channel.listeners.get("agent")!({ payload: { holder: "alice", screenId: "s1", at: 1, kind: "plan", message: "mine", released: false } });
    channel.listeners.get("agent")!({ payload: { holder: "bob", screenId: "s1", at: 2, kind: "plan", message: "bob's", released: false } });
    await flush();
    close();
    expect(got.proposals).toEqual([proposal]);
    expect(got.steps).toEqual([{ screenId: "s1", at: 1, kind: "plan", message: "mine", released: false }]);
  });
});
