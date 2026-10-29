/**
 * Supabase Realtime: the parts that can be checked without Supabase.
 *
 * Every case here runs on a machine that has never seen a Supabase project,
 * which is the point - the feature is behind a flag, and with no keys the app
 * keeps the event stream it has always had. What cannot be checked here is
 * anything that needs a real project: that two browsers see each other inside
 * a second, and that a non-member's join is refused by the policy. Those wait
 * on the keys (docs/PLAN_FULL_ARCHITECTURE.md §6, phase 2).
 */

import { afterEach, describe, expect, it } from "vitest";
import { decodeJwt, jwtVerify } from "jose";
import {
  REVISION_EVENT,
  publicConfig,
  realtimeEnabled,
  serverConfig,
  topicFor,
  type RevisionNotice,
} from "@/lib/realtime/config";
import { TOKEN_TTL_SECONDS, mintRealtimeToken } from "@/lib/realtime/token";
import { publishRevision, resetRealtimeClient } from "@/lib/realtime/publish";
import { catchUpFrom } from "@/lib/collab/realtime";

const KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_JWT_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

/** A secret for signing in the test only; nothing here reaches a real project. */
const TEST_SECRET = "test-jwt-secret-not-a-real-one-0123456789";

function withKeys(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const key of KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

afterEach(() => {
  withKeys({});
  resetRealtimeClient();
});

describe("the flag", () => {
  it("is off when no keys are set, so the app keeps the event stream", () => {
    withKeys({});
    expect(publicConfig()).toBeNull();
    expect(serverConfig()).toBeNull();
    expect(realtimeEnabled()).toBe(false);
  });

  it("needs both public values before a browser will try Realtime", () => {
    withKeys({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" });
    expect(realtimeEnabled()).toBe(false);
    withKeys({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" });
    expect(realtimeEnabled()).toBe(false);
    withKeys({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" });
    expect(realtimeEnabled()).toBe(true);
  });

  it("treats blank keys as absent, so an empty deployment variable is not half-on", () => {
    withKeys({ NEXT_PUBLIC_SUPABASE_URL: "   ", NEXT_PUBLIC_SUPABASE_ANON_KEY: "" });
    expect(realtimeEnabled()).toBe(false);
  });

  it("needs the JWT secret before the server will mint anything", () => {
    withKeys({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" });
    expect(publicConfig()).not.toBeNull();
    expect(serverConfig()).toBeNull();
  });
});

describe("a minted token", () => {
  const configured = () =>
    withKeys({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_JWT_SECRET: TEST_SECRET,
    });

  it("is nothing at all when Realtime is not configured", async () => {
    withKeys({});
    expect(await mintRealtimeToken("u1", "p1")).toBeNull();
  });

  it("names one topic, and it is the project's", async () => {
    configured();
    const minted = await mintRealtimeToken("u1", "p1");
    expect(minted?.topic).toBe(topicFor("p1"));
    const claims = decodeJwt(minted!.token);
    expect(claims.project_topic).toBe("project:p1");
    expect(claims.sub).toBe("u1");
  });

  it("carries the aud and role Realtime needs to evaluate a policy at all", async () => {
    configured();
    const claims = decodeJwt((await mintRealtimeToken("u1", "p1"))!.token);
    expect(claims.aud).toBe("authenticated");
    expect(claims.role).toBe("authenticated");
  });

  it("is signed with the project secret, so a forged one does not verify", async () => {
    configured();
    const minted = await mintRealtimeToken("u1", "p1");
    const right = new TextEncoder().encode(TEST_SECRET);
    await expect(jwtVerify(minted!.token, right, { audience: "authenticated" })).resolves.toBeTruthy();
    const wrong = new TextEncoder().encode("a different secret entirely, long enough");
    await expect(jwtVerify(minted!.token, wrong)).rejects.toBeTruthy();
  });

  it("expires, so access ends by itself rather than by revocation", async () => {
    configured();
    const minted = await mintRealtimeToken("u1", "p1");
    const claims = decodeJwt(minted!.token);
    const life = (claims.exp ?? 0) - (claims.iat ?? 0);
    expect(life).toBe(TOKEN_TTL_SECONDS);
    expect(minted!.expiresIn).toBe(TOKEN_TTL_SECONDS);
    expect(life).toBeLessThanOrEqual(60 * 60);
  });

  it("never carries the secret it was signed with", async () => {
    configured();
    const minted = await mintRealtimeToken("u1", "p1");
    expect(JSON.stringify(minted)).not.toContain(TEST_SECRET);
    expect(minted!.anonKey).toBe("anon");
  });

  it("gives two projects two topics, so one token cannot read the other", async () => {
    configured();
    const a = await mintRealtimeToken("u1", "p1");
    const b = await mintRealtimeToken("u1", "p2");
    expect(a!.topic).not.toBe(b!.topic);
    expect(decodeJwt(a!.token).project_topic).not.toBe(decodeJwt(b!.token).project_topic);
  });
});

describe("a revision broadcast", () => {
  it("does nothing, quietly, when Supabase is not configured", async () => {
    withKeys({});
    await expect(publishRevision({ projectId: "p1", rev: 3, author: "u1" })).resolves.toBe(false);
  });

  it("needs the service-role key, not just the public ones", async () => {
    withKeys({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_JWT_SECRET: TEST_SECRET,
    });
    await expect(publishRevision({ projectId: "p1", rev: 3, author: "u1" })).resolves.toBe(false);
  });

  it("carries a notification and no ops, so it cannot approach the 256 KB cap", () => {
    const notice: RevisionNotice = { projectId: "a".repeat(64), rev: 2 ** 31, author: "b".repeat(64) };
    expect(Object.keys(notice).sort()).toEqual(["author", "projectId", "rev"]);
    expect(JSON.stringify(notice).length).toBeLessThan(1024);
    expect(REVISION_EVENT).toBe("revision");
  });
});

describe("closing a revision gap", () => {
  const snapshot = { doc: "snapshot" } as never;

  /** A fake log: what the HTTP route would answer for each `since`. */
  const logOf = (answers: Record<number, unknown>) => {
    const asked: number[] = [];
    return {
      asked,
      fetch: async (since: number) => {
        asked.push(since);
        return (answers[since] ?? { changes: [] }) as never;
      },
    };
  };

  it("fetches the ops rather than taking them from the broadcast", async () => {
    const log = logOf({
      4: { changes: [{ rev: 5 }, { rev: 6 }] },
      6: { changes: [] },
    });
    const seen: number[] = [];
    const cursor = await catchUpFrom({
      cursor: 4,
      fetch: log.fetch,
      change: (c) => seen.push((c as { rev: number }).rev),
      reset: () => expect.unreachable("no reset was offered"),
    });
    // It asked the API, twice, and moved only as far as the API said.
    expect(log.asked).toEqual([4, 6]);
    expect(seen).toEqual([5, 6]);
    expect(cursor).toBe(6);
  });

  it("resets when the log no longer reaches back, and stops there", async () => {
    const log = logOf({ 2: { reset: snapshot, rev: 40 } });
    let reset: { rev: number } | null = null;
    const cursor = await catchUpFrom({
      cursor: 2,
      fetch: log.fetch,
      change: () => expect.unreachable("a reset carries no changes"),
      reset: (body) => { reset = body; },
    });
    expect(reset).toEqual({ rev: 40, snapshot });
    expect(cursor).toBe(40);
    // One call: a reset is the end of the pass, not the start of another.
    expect(log.asked).toEqual([2]);
  });

  it("holds its place when the fetch fails, so the next broadcast retries", async () => {
    const cursor = await catchUpFrom({
      cursor: 9,
      fetch: async () => null,
      change: () => expect.unreachable("nothing was fetched"),
      reset: () => expect.unreachable("nothing was fetched"),
    });
    expect(cursor).toBe(9);
  });

  it("stops when the channel closed while a fetch was in flight", async () => {
    let closed = false;
    const log = logOf({ 0: { changes: [{ rev: 1 }] } });
    const seen: number[] = [];
    const cursor = await catchUpFrom({
      cursor: 0,
      fetch: async (since) => { closed = true; return log.fetch(since); },
      change: (c) => seen.push((c as { rev: number }).rev),
      reset: () => expect.unreachable("no reset was offered"),
      cancelled: () => closed,
    });
    // The batch in flight is applied; no further round is started.
    expect(seen).toEqual([1]);
    expect(cursor).toBe(1);
    expect(log.asked).toEqual([0]);
  });
});

describe("which transport a session uses", () => {
  it("is the event stream with no Supabase, and Realtime with it", async () => {
    const { browserTransport } = await import("@/lib/collab/browser");
    const { realtimeTransport } = await import("@/lib/collab/realtime");
    const { liveTransport } = await import("@/lib/collab/transport");

    withKeys({});
    expect(liveTransport()).toBe(browserTransport);

    withKeys({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" });
    expect(liveTransport()).toBe(realtimeTransport);
  });

  it("keeps posting, presence and snapshots on HTTP either way", async () => {
    const { browserTransport } = await import("@/lib/collab/browser");
    const { realtimeTransport } = await import("@/lib/collab/realtime");
    // Only the stream changes; a broadcast never carries ops, so the writes
    // and the snapshot read stay on the routes they always used.
    expect(realtimeTransport.post).toBe(browserTransport.post);
    expect(realtimeTransport.presence).toBe(browserTransport.presence);
    expect(realtimeTransport.snapshot).toBe(browserTransport.snapshot);
    expect(realtimeTransport.subscribe).not.toBe(browserTransport.subscribe);
  });
});
