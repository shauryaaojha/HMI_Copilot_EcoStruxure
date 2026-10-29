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
 */

import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { REVISION_EVENT, type RevisionNotice } from "@/lib/realtime/config";
import type { LoggedChange, Presence } from "./types";
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

/**
 * Realtime for the stream, HTTP for everything else.
 *
 * `presenceState` is keyed by the connection, so two tabs of one person are
 * two entries; they are folded to one per user, newest wins, which is what the
 * server's presence list did.
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

    const close = () => {
      if (closed) return;
      closed = true;
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

    void (async () => {
      const minted = await mint(projectId);
      // No token means no access or no Supabase: the caller falls back.
      if (!minted || closed) {
        if (!closed) handlers.closed();
        return;
      }

      client = createClient(minted.url, minted.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      // Our own token, not an anon session: it names the one topic this
      // person may join, and the policy on realtime.messages checks it.
      await client.realtime.setAuth(minted.token);

      channel = client.channel(minted.topic, {
        config: { private: true, presence: { key: "" } },
      });

      channel.on("broadcast", { event: REVISION_EVENT }, (message) => {
        const notice = message.payload as RevisionNotice;
        if (!Number.isSafeInteger(notice?.rev) || notice.rev <= cursor) return;
        catchUp();
      });

      channel.on("presence", { event: "sync" }, () => {
        const state = channel?.presenceState<Presence>() ?? {};
        const byUser = new Map<string, Presence>();
        for (const entries of Object.values(state)) {
          for (const entry of entries) if (entry?.userId) byUser.set(entry.userId, entry);
        }
        handlers.presence({ users: [...byUser.values()] });
      });

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
