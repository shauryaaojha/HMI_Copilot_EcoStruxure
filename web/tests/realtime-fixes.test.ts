/**
 * The review's six findings, each as the property that was missing.
 *
 * Like tests/realtime.test.ts, every case here runs with no Supabase project:
 * the client and the server are exercised against a Supabase client that
 * records what was asked of it, which is enough to show who is told what and
 * when. What still cannot be shown here is Supabase's own answer - whether a
 * policy refuses a topic - and that is what `npm run realtime:check` is for
 * (scripts/realtime-check.mts, docs/REALTIME_SETUP.md).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeJwt } from "jose";

/* --- the doubles ------------------------------------------------------ */

/** What `after` was handed, so a test can run it when the response is gone. */
const deferred = vi.hoisted(() => ({ tasks: [] as (() => unknown)[], outsideRequest: false }));
vi.mock("next/server", () => ({
  after: (task: () => unknown) => {
    // Next throws when there is no request to be after; the route must not.
    if (deferred.outsideRequest) throw new Error("`after` was called outside a request scope");
    deferred.tasks.push(task);
  },
}));

const broadcasts = vi.hoisted(() => ({ notices: [] as unknown[], sent: true }));
vi.mock("@/lib/realtime/publish", () => ({
  publishRevision: async (notice: unknown) => {
    broadcasts.notices.push(notice);
    return broadcasts.sent;
  },
  resetRealtimeClient: () => undefined,
}));

const log = vi.hoisted(() => ({ rev: 7, accepted: ["c1"] as string[] }));
vi.mock("@/lib/server/repo", () => ({
  repo: () => ({ live: { append: async () => ({ rev: log.rev, accepted: log.accepted, rejected: [] }) } }),
}));
vi.mock("@/lib/server/access", () => ({
  requireAccess: async () => ({ id: "alice", name: "Alice" }),
  requireReader: async () => undefined,
  sourceInfo: async () => null,
}));
vi.mock("@/lib/server/session", () => ({ currentUser: async () => ({ id: "alice", name: "Alice" }) }));

/** Everything the Supabase client was asked to do, in order. */
const supabase = vi.hoisted(() => ({
  clients: [] as { url: string; anonKey: string }[],
  tokens: [] as string[],
  channels: [] as { topic: string; config: unknown; listeners: string[] }[],
  tracked: 0,
  presenceRead: 0,
  removed: 0,
  /** What `subscribe` reports back; a test can make the join fail. */
  status: "SUBSCRIBED" as string,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (url: string, anonKey: string) => {
    supabase.clients.push({ url, anonKey });
    return {
      realtime: {
        setAuth: async (token: string) => {
          supabase.tokens.push(token);
        },
      },
      channel: (topic: string, config: unknown) => {
        const record = { topic, config, listeners: [] as string[] };
        supabase.channels.push(record);
        const channel = {
          on: (event: string) => {
            record.listeners.push(event);
            return channel;
          },
          subscribe: (callback?: (status: string) => void) => {
            callback?.(supabase.status);
            return channel;
          },
          track: async () => {
            supabase.tracked++;
          },
          presenceState: () => {
            supabase.presenceRead++;
            return {};
          },
        };
        return channel;
      },
      removeChannel: async () => {
        supabase.removed++;
      },
    };
  },
}));

import { CollabSession, type SessionStore, type StreamHandlers } from "@/lib/collab/sync";
import { browserTransport } from "@/lib/collab/browser";
import { REFRESH_LEAD_SECONDS, realtimeTransport, refreshDelayMs } from "@/lib/collab/realtime";
import { TOKEN_TTL_SECONDS } from "@/lib/realtime/token";
import { createProjectStore } from "@/store/project";
import { CHECK_ENV, envComplaint, exitCode, expiredToken, joinOutcome, line, missingEnv, readResults } from "@/lib/realtime/check";
import { POST as postChanges } from "@/app/api/projects/[id]/changes/route";
import { GET as keepalive } from "@/app/api/realtime/keepalive/route";

/* --- the fake network ------------------------------------------------- */

/** A minted token as the route answers it; the topic is the project's. */
const minted = (token: string, expiresIn = TOKEN_TTL_SECONDS) => ({
  token,
  topic: "project:p1",
  expiresIn,
  url: "https://example.supabase.co",
  anonKey: "anon",
});

interface Net {
  urls: string[];
  /** Tokens handed out in order; `null` is a refusal (a 401 or a 503). */
  tokens: (ReturnType<typeof minted> | null)[];
  /** What the presence heartbeat answers with, or null for a refusal. */
  presence: { users: unknown[] } | null;
}

let net: Net;
const answer = (body: unknown, ok = true) =>
  ({ ok, status: ok ? 200 : 401, json: async () => body }) as unknown as Response;

function network(): Net {
  const state: Net = { urls: [], tokens: [minted("token-1")], presence: { users: [] } };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    state.urls.push(url);
    if (url.includes("/realtime-token")) {
      const next = state.tokens.length > 1 ? state.tokens.shift()! : state.tokens[0];
      return next ? answer(next) : answer({ error: "unauthorized" }, false);
    }
    if (url.includes("/changes")) return answer({ changes: [] });
    if (url.includes("/presence")) return state.presence ? answer(state.presence) : answer({ error: "unauthorized" }, false);
    return answer({}, false);
  }) as typeof fetch;
  return state;
}

/** Let the subscribe path's awaits run; it is a chain of resolved promises. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

/** Stream handlers that only record, so a test can see what was reported. */
function handlers() {
  const seen = { changes: [] as unknown[], resets: 0, presence: [] as unknown[], closed: 0 };
  const stream: StreamHandlers = {
    change: (entry) => seen.changes.push(entry),
    reset: () => seen.resets++,
    presence: (body) => seen.presence.push(body),
    closed: () => seen.closed++,
  };
  return { seen, stream };
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  deferred.tasks = [];
  deferred.outsideRequest = false;
  broadcasts.notices = [];
  broadcasts.sent = true;
  log.rev = 7;
  log.accepted = ["c1"];
  Object.assign(supabase, { clients: [], tokens: [], channels: [], tracked: 0, presenceRead: 0, removed: 0, status: "SUBSCRIBED" });
  net = network();
  delete process.env.CRON_SECRET;
  for (const key of CHECK_ENV) delete process.env[key];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.CRON_SECRET;
  for (const key of CHECK_ENV) delete process.env[key];
});

/* --- 1. presence has one home --------------------------------------- */

describe("presence", () => {
  it("reaches the session in the heartbeat's own answer", async () => {
    const store = createProjectStore();
    const here = [{ userId: "bob", name: "Bob", selection: [], expiresAt: Date.now() + 15_000 }];
    const seen: unknown[][] = [];
    const session = new CollabSession({
      projectId: "p1",
      author: "alice",
      rev: 1,
      store: store as unknown as SessionStore,
      transport: { ...browserTransport, presence: async () => ({ users: here }) },
      onPresence: (users) => seen.push(users),
      timers: { set: () => 0, clear: () => undefined },
    });
    session.beat();
    await settle();
    expect(seen).toEqual([here]);
  });

  it("is read out of the heartbeat by the one transport that sends it", async () => {
    net.presence = { users: [{ userId: "bob", name: "Bob", selection: [], expiresAt: 1 }] };
    await expect(browserTransport.presence("p1", { selection: [] })).resolves.toEqual(net.presence);
    // A refused heartbeat tells the session nothing rather than clearing it.
    net.presence = null;
    await expect(browserTransport.presence("p1", { selection: [] })).resolves.toBeUndefined();
  });

  it("is not half-kept on the channel: it is neither configured, tracked nor read", async () => {
    const { stream } = handlers();
    const close = realtimeTransport.subscribe("p1", 4, stream);
    await settle();
    expect(supabase.channels).toHaveLength(1);
    // No presence key in the channel's configuration, so Supabase keeps no
    // presence state for it; nothing tracks and nothing reads one.
    expect(supabase.channels[0].config).toEqual({ config: { private: true } });
    expect(supabase.channels[0].listeners).toEqual(["broadcast"]);
    expect(supabase.tracked).toBe(0);
    expect(supabase.presenceRead).toBe(0);
    close();
  });

  it("stays on the route both transports share", () => {
    // The HTTP heartbeat is the single source of truth, so the Realtime
    // transport does not wrap it, replace it or add a second one.
    expect(realtimeTransport.presence).toBe(browserTransport.presence);
  });
});

/* --- 2. a refused mint is not retried forever ------------------------ */

describe("a session whose token is refused", () => {
  it("ends up on the event stream, once, and does not report a closed stream", async () => {
    const stream = vi.spyOn(browserTransport, "subscribe").mockReturnValue(() => undefined);
    const said = vi.spyOn(console, "info").mockImplementation(() => undefined);
    net.tokens = [null];
    const { seen, stream: handle } = handlers();

    const close = realtimeTransport.subscribe("p1", 9, handle);
    await settle();

    expect(stream).toHaveBeenCalledTimes(1);
    // From the same revision, so the stream picks up where the channel would.
    expect(stream.mock.calls[0][0]).toBe("p1");
    expect(stream.mock.calls[0][1]).toBe(9);
    // `closed` is what makes the session reconnect in 500 ms; it is the loop.
    expect(seen.closed).toBe(0);
    expect(supabase.clients).toHaveLength(0);
    expect(said.mock.calls.flat().join(" ")).toContain("event stream");

    // And it asked once: no second mint, now or later.
    await settle();
    expect(net.urls.filter((u) => u.includes("/realtime-token"))).toHaveLength(1);
    close();
  });

  it("closes the stream it fell back to when the session stops", async () => {
    let closedFallback = 0;
    vi.spyOn(browserTransport, "subscribe").mockReturnValue(() => {
      closedFallback++;
    });
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    net.tokens = [null];
    const { stream } = handlers();
    const close = realtimeTransport.subscribe("p1", 0, stream);
    await settle();
    close();
    expect(closedFallback).toBe(1);
  });
});

/* --- 3. the notice survives the response ----------------------------- */

describe("the revision notice", () => {
  const request = () =>
    new Request("http://localhost/api/projects/p1/changes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base: 1, changes: [{ id: "c1", base: 1, ops: [] }] }),
    });
  const context = { params: Promise.resolve({ id: "p1" }) };

  it("is scheduled through after, not left to a function that may be frozen", async () => {
    const response = await postChanges(request(), context);
    expect(response.status).toBe(200);
    // Nothing was sent while the response was being made: the publish is the
    // scheduled work, which is the whole point of `after`.
    expect(broadcasts.notices).toEqual([]);
    expect(deferred.tasks).toHaveLength(1);

    await deferred.tasks[0]();
    expect(broadcasts.notices).toEqual([{ projectId: "p1", rev: 7, author: "alice" }]);
  });

  it("is not scheduled when nothing was accepted", async () => {
    log.accepted = [];
    await postChanges(request(), context);
    expect(deferred.tasks).toEqual([]);
  });

  it("does not cost the edit its answer where there is nothing to be after", async () => {
    deferred.outsideRequest = true;
    const response = await postChanges(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ rev: 7, accepted: ["c1"] });
  });
});

/* --- 4. the token is replaced before it lapses ----------------------- */

describe("a channel's token", () => {
  it("is re-minted a minute before it would lapse", () => {
    expect(refreshDelayMs(TOKEN_TTL_SECONDS)).toBe((TOKEN_TTL_SECONDS - REFRESH_LEAD_SECONDS) * 1000);
    expect(REFRESH_LEAD_SECONDS).toBe(60);
    // A token too short-lived for a whole minute's lead refreshes halfway in,
    // never in the past.
    expect(refreshDelayMs(30)).toBe(15_000);
    expect(refreshDelayMs(0)).toBe(0);
  });

  it("is handed to the open socket, without rejoining the channel", async () => {
    vi.useFakeTimers();
    net.tokens = [minted("token-1"), minted("token-2")];
    const { seen, stream } = handlers();
    const close = realtimeTransport.subscribe("p1", 0, stream);
    await vi.advanceTimersByTimeAsync(0);
    expect(supabase.tokens).toEqual(["token-1"]);

    await vi.advanceTimersByTimeAsync(refreshDelayMs(TOKEN_TTL_SECONDS) - 1);
    expect(supabase.tokens).toEqual(["token-1"]);

    await vi.advanceTimersByTimeAsync(1);
    expect(supabase.tokens).toEqual(["token-1", "token-2"]);
    // One channel for the session: the socket is re-authorised, not rejoined.
    expect(supabase.channels).toHaveLength(1);
    expect(seen.closed).toBe(0);
    close();
  });

  it("ends the stream when the re-mint is refused, so the session decides again", async () => {
    vi.useFakeTimers();
    net.tokens = [minted("token-1"), null];
    const { seen, stream } = handlers();
    realtimeTransport.subscribe("p1", 0, stream);
    await vi.advanceTimersByTimeAsync(refreshDelayMs(TOKEN_TTL_SECONDS));
    expect(seen.closed).toBe(1);
    expect(supabase.removed).toBe(1);
  });

  it("leaves no timer behind when the subscription is torn down", async () => {
    vi.useFakeTimers();
    net.tokens = [minted("token-1"), minted("token-2")];
    const { stream } = handlers();
    const close = realtimeTransport.subscribe("p1", 0, stream);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);

    close();
    expect(vi.getTimerCount()).toBe(0);
    // Nothing is minted after the session is gone, however long it is left.
    const asked = net.urls.filter((u) => u.includes("/realtime-token")).length;
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(net.urls.filter((u) => u.includes("/realtime-token"))).toHaveLength(asked);
    expect(supabase.tokens).toEqual(["token-1"]);
  });
});

/* --- 5. the keep-alive is the cron's --------------------------------- */

describe("the keep-alive route", () => {
  const call = (authorization?: string) =>
    keepalive(new Request("http://localhost/api/realtime/keepalive", authorization ? { headers: { authorization } } : undefined));

  it("refuses a request with no authorization at all", async () => {
    process.env.CRON_SECRET = "a-secret-for-this-test-only";
    expect((await call()).status).toBe(401);
  });

  it("refuses the wrong secret, and a bare secret with no scheme", async () => {
    process.env.CRON_SECRET = "a-secret-for-this-test-only";
    expect((await call("Bearer something-else")).status).toBe(401);
    expect((await call("a-secret-for-this-test-only")).status).toBe(401);
  });

  it("answers the cron's own header", async () => {
    process.env.CRON_SECRET = "a-secret-for-this-test-only";
    const response = await call("Bearer a-secret-for-this-test-only");
    expect(response.status).toBe(200);
    // With no Supabase project there is nothing to keep alive, and saying so
    // is still a success: a red cron would be noise.
    expect(await response.json()).toMatchObject({ ok: true });
    expect(broadcasts.notices).toEqual([]);
  });

  it("refuses everything when no secret is set, rather than letting everyone in", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer ")).status).toBe(401);
    expect((await call("Bearer undefined")).status).toBe(401);
  });
});

/* --- what the acceptance script can be sure of ----------------------- */

describe("the realtime:check script", () => {
  it("names the variables it is missing instead of throwing", () => {
    expect(missingEnv({})).toEqual([...CHECK_ENV]);
    const complaint = envComplaint(missingEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" }));
    expect(complaint).toContain("SUPABASE_JWT_SECRET");
    expect(complaint).not.toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(complaint).toContain("docs/REALTIME_SETUP.md");
  });

  it("counts a blank variable as missing, the way the app does", () => {
    expect(missingEnv({ ...Object.fromEntries(CHECK_ENV.map((k) => [k, "set"])), SUPABASE_JWT_SECRET: "   " })).toEqual([
      "SUPABASE_JWT_SECRET",
    ]);
  });

  it("exits non-zero unless all three checks passed", () => {
    const pass = (name: string) => ({ name, ok: true, detail: "" });
    expect(exitCode([pass("a"), pass("b"), pass("c")])).toBe(0);
    expect(exitCode([pass("a"), pass("b"), { name: "c", ok: false, detail: "refused" }])).toBe(1);
    // Two passes are not three: a check that never ran has proved nothing.
    expect(exitCode([pass("a"), pass("b")])).toBe(1);
  });

  it("reads as one line a person can act on", () => {
    expect(line({ name: "a member's token joins", ok: true, detail: "heard revision 41" })).toBe(
      "ok    a member's token joins: heard revision 41",
    );
    expect(line({ name: "an expired token is refused", ok: false, detail: "it joined" })).toContain("FAIL");
  });

  it("tells a refused join from one that never answered", async () => {
    const channel = (status?: string) => ({ subscribe: (cb: (s: string) => void) => (status ? cb(status) : undefined) });
    await expect(joinOutcome(channel("SUBSCRIBED"), 5)).resolves.toBe("joined");
    await expect(joinOutcome(channel("CHANNEL_ERROR"), 5)).resolves.toBe("refused");
    await expect(joinOutcome(channel("CLOSED"), 5)).resolves.toBe("refused");
    // Silence is its own answer: the check that expects a refusal must not
    // pass because the network was slow.
    await expect(joinOutcome(channel(), 5)).resolves.toBe("timeout");
  });

  it("builds an expired token that differs from a minted one only in its expiry", async () => {
    const token = await expiredToken("a-test-secret-long-enough-to-sign-with", "u1", "p1");
    const claims = decodeJwt(token);
    expect(claims.project_topic).toBe("project:p1");
    expect(claims.role).toBe("authenticated");
    expect(claims.aud).toBe("authenticated");
    expect(claims.sub).toBe("u1");
    expect(claims.exp).toBeLessThan(Math.floor(Date.now() / 1000));
  });
});

describe("reading the acceptance check's three results", () => {
  const joined = { name: "a member's token joins and hears a revision", ok: true, detail: "heard rev 7" };
  const refusedOther = { name: "a token for another project is refused here", ok: true, detail: "refused" };
  const refusedExpired = { name: "an expired token is refused", ok: true, detail: "refused" };

  it("reports all three plainly when the join worked", () => {
    const read = readResults([joined, refusedOther, refusedExpired]);
    expect(read.every((l) => l.startsWith("ok  "))).toBe(true);
  });

  it("will not call a refusal a pass when nothing joined at all", () => {
    // Point the script at a URL with no project and every join is refused, so
    // both refusal checks would otherwise read "ok" for the wrong reason.
    const read = readResults([{ ...joined, ok: false, detail: "the join was refused" }, refusedOther, refusedExpired]);
    expect(read[0]).toMatch(/^FAIL/);
    expect(read[1]).toMatch(/^\?\?/);
    expect(read[1]).toMatch(/unproven/);
    expect(read[2]).toMatch(/^\?\?/);
    // And it is still a failure overall, which it already was.
    expect(exitCode([{ ...joined, ok: false, detail: "x" }, refusedOther, refusedExpired])).toBe(1);
  });

  it("leaves a genuine refusal failure reading as a failure", () => {
    const read = readResults([joined, { ...refusedOther, ok: false, detail: "it was allowed in" }, refusedExpired]);
    expect(read[1]).toMatch(/^FAIL/);
  });
});
