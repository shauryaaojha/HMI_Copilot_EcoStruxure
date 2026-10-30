"use client";

/**
 * The live transport, over Supabase Realtime instead of server-sent events.
 *
 * Only `subscribe` changes. Posting changes, reading a snapshot and the
 * revision fetch all stay on the existing HTTP routes, because a broadcast
 * carries a notification and never the ops: Supabase's Free plan caps one
 * message at 256 KB and a batch of ops can exceed it
 * (docs/PLAN_FULL_ARCHITECTURE.md §2.3).
 *
 * What that buys is the thing SSE could not do on Vercel. A function may run
 * for 60 seconds, so every event stream was cut at 55 and reopened; a Realtime
 * channel is a WebSocket to Supabase and is not a function, so it stays up.
 *
 * The shape of a round trip:
 *
 *   1. a broadcast arrives saying revision N landed, and who landed it;
 *   2. if N is the revision we already have, there is nothing to do - this is
 *      our own change coming back;
 *   3. otherwise fetch everything since our revision over HTTP and hand each
 *      change to the session, exactly as the stream used to;
 *   4. if the log no longer reaches that far back, the fetch answers with a
 *      snapshot instead and the session resets to it.
 *
 * A conflict is never resolved from a broadcast. The Mongo transaction has
 * already decided who won; this only says that it did.
 *
 * Two things can go wrong with a token, and they are not the same thing. If
 * the first mint fails, this session cannot have a channel at all and takes
 * the event stream for the rest of its life rather than asking again. If a
 * later re-mint fails, the session had a channel and has lost its access, so
 * the stream closes and the reconnect decides afresh.
 */

import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { REVISION_EVENT, type RevisionNotice } from "@/lib/realtime/config";
import type { LoggedChange } from "./types";
import type { Snapshot } from "@/lib/server/repo";
import { browserTransport } from "./browser";
import type { StreamHandlers, Transport } from "./sync";

interface MintedToken {
  token: string;
  topic: string;
  expiresIn: number;
  url: string;
  anonKey: string;
}

/** What `GET /changes?since=` answers: more changes, or a snapshot to reset to. */
type SinceResult =
  | { changes: LoggedChange[] }
  | { reset: Snapshot; rev: number };

async function mint(projectId: string): Promise<MintedToken | null> {
  const response = await fetch(`/api/projects/${projectId}/realtime-token`, { cache: "no-store" });
  if (!response.ok) return null;
  return (await response.json()) as MintedToken;
}

async function changesSince(projectId: string, since: number): Promise<SinceResult | null> {
  const response = await fetch(`/api/projects/${projectId}/changes?since=${since}`, { cache: "no-store" });
  if (!response.ok) return null;
  return (await response.json()) as SinceResult;
}

/** What `catchUp` needs from the world, so it can be tested without one. */
export interface CatchUp {
  /** The revision already applied here. */
  cursor: number;
  fetch(since: number): Promise<SinceResult | null>;
  change(entry: LoggedChange): void;
  reset(body: { rev: number; snapshot: Snapshot }): void;
  /** Stop early: the channel closed while the fetch was in flight. */
  cancelled?: () => boolean;
}

/**
 * Close a revision gap over HTTP, and answer with the new cursor.
 *
 * This is the whole of what a broadcast causes. It is written as a function of
 * its inputs rather than a closure over the channel so that the property that
 * matters - a gap is closed by fetching, never by trusting the broadcast - is
 * a test rather than a comment.
 *
 * A reset ends the pass: the log no longer reaches back to this cursor, the
 * session has been handed the snapshot instead, and there is nothing further
 * to ask for.
 */
export async function catchUpFrom(io: CatchUp): Promise<number> {
  let cursor = io.cursor;
  while (!io.cancelled?.()) {
    const found = await io.fetch(cursor);
    if (!found) return cursor;
    if ("reset" in found) {
      io.reset({ rev: found.rev, snapshot: found.reset });
      return found.rev;
    }
    if (found.changes.length === 0) return cursor;
    for (const change of found.changes) {
      cursor = change.rev;
      io.change(change);
    }
  }
  return cursor;
}

/** Re-mint this long before a token lapses, so the channel never drops. */
export const REFRESH_LEAD_SECONDS = 60;

/**
 * When to re-mint a token that lives `expiresIn` seconds, in milliseconds.
 *
 * A minute's lead on a fifteen-minute token: long enough to survive a slow
 * mint and a retry, short enough that the replacement is barely younger than
 * the one it replaces. For a token too short-lived for a whole minute's lead
 * the refresh lands halfway through it instead, so a small TTL cannot produce
 * a refresh scheduled for the past.
 */
export function refreshDelayMs(expiresIn: number): number {
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) return 0;
  const lead = Math.min(REFRESH_LEAD_SECONDS, expiresIn / 2);
  return Math.max(0, Math.round((expiresIn - lead) * 1000));
}

/**
 * Realtime for the stream, HTTP for everything else.
 *
 * Presence is one of the "everything else", and deliberately: it stays whole
 * on the heartbeat route (api/projects/[id]/presence), which stores it in
 * Mongo with an expiry and answers with the whole list. The channel's own
 * presence feature is not used at all - not configured, not tracked, not read.
 * Two reasons. The names and ids shown belong to the server, which decides
 * them from the session rather than taking a browser's word for who it is; and
 * the fifteen-second expiry that makes a closed laptop disappear lives in
 * Mongo, with nowhere to live on a channel. Having the route hold it and the
 * channel carry only revisions leaves one source of truth instead of two
 * halves.
 */
export const realtimeTransport: Transport = {
  post: browserTransport.post,
  presence: browserTransport.presence,
  snapshot: browserTransport.snapshot,

  subscribe(projectId, since, handlers: StreamHandlers) {
    let closed = false;
    let client: SupabaseClient | null = null;
    let channel: RealtimeChannel | null = null;
    /** The revision this client has applied; the gap is measured from it. */
    let cursor = since;
    /** One fetch at a time, so two quick broadcasts do not race. */
    let draining: Promise<void> | null = null;
    /** Set when this session gave up on Realtime and took the event stream. */
    let fallback: (() => void) | null = null;
    /** The pending re-mint; cleared on teardown so a closed session has no timer. */
    let refresh: ReturnType<typeof setTimeout> | undefined;

    const close = () => {
      if (closed) return;
      closed = true;
      if (refresh !== undefined) clearTimeout(refresh);
      refresh = undefined;
      fallback?.();
      fallback = null;
      if (client && channel) void client.removeChannel(channel);
      channel = null;
      client = null;
    };

    const drain = async () => {
      cursor = await catchUpFrom({
        cursor,
        fetch: (since) => changesSince(projectId, since),
        change: handlers.change,
        reset: handlers.reset,
        cancelled: () => closed,
      });
    };

    /** Serialised, so a burst of broadcasts makes one pass over the log. */
    const catchUp = () => {
      draining = (draining ?? Promise.resolve())
        .then(drain)
        .catch(() => {
          // The fetch failed; the next broadcast or reconnect tries again.
        });
    };

    /**
     * Replace the token before Realtime drops the socket under it.
     *
     * A token lives fifteen minutes and the channel outlives it, so without
     * this the channel fails about a quarter of an hour into every session.
     * `setAuth` hands the new one to the open socket; the channel is not
     * rejoined, and the policy is re-evaluated against the new claims.
     */
    const scheduleRefresh = (expiresIn: number) => {
      if (closed) return;
      refresh = setTimeout(() => {
        refresh = undefined;
        void (async () => {
          const next = await mint(projectId);
          if (closed) return;
          if (!next) {
            // Access ended, or the mint route is down. Either way the current
            // token is about to lapse and the socket with it, so end the
            // stream here and let the session reconnect, which goes through
            // the same mint and falls back to the event stream if it fails.
            close();
            handlers.closed();
            return;
          }
          await client?.realtime.setAuth(next.token);
          scheduleRefresh(next.expiresIn);
        })();
      }, refreshDelayMs(expiresIn));
    };

    void (async () => {
      const minted = await mint(projectId);
      if (closed) return;
      if (!minted) {
        // Not a hiccup to retry: a share-link visitor has no identity to scope
        // a token to (401) and a deployment without a JWT secret never will
        // (503). Reporting it as a closed stream had the session re-mint every
        // 500 ms for as long as the tab stayed open, so this session takes the
        // event stream instead - once, and for its whole life.
        console.info("[realtime] no token for this session; using the event stream instead");
        fallback = browserTransport.subscribe(projectId, cursor, handlers);
        return;
      }

      client = createClient(minted.url, minted.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      // Our own token, not an anon session: it names the one topic this
      // person may join, and the policy on realtime.messages checks it.
      await client.realtime.setAuth(minted.token);

      channel = client.channel(minted.topic, { config: { private: true } });

      channel.on("broadcast", { event: REVISION_EVENT }, (message) => {
        const notice = message.payload as RevisionNotice;
        if (!Number.isSafeInteger(notice?.rev) || notice.rev <= cursor) return;
        catchUp();
      });

      scheduleRefresh(minted.expiresIn);

      channel.subscribe((status) => {
        if (closed) return;
        if (status === "SUBSCRIBED") {
          // Anything that landed between loading the project and joining.
          catchUp();
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          close();
          handlers.closed();
        }
      });
    })();

    return close;
  },
};
