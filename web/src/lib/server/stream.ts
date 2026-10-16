/**
 * The push half of live co-editing: what one Server-Sent Events connection
 * says, as an async generator the route serialises and tests iterate.
 *
 * A function cannot be told when the database changes, so it polls: the log
 * after the client's revision about once a second (the latency the design
 * accepts for engineering work), and presence every couple of seconds. Each
 * connection ends before the function's time limit and the client reconnects
 * with the last revision it applied, so no event is lost between connections.
 */
import type { LoggedChange, Presence } from "@/lib/collab/types";
import type { Snapshot } from "./repo";
import { repo, type Repo } from "./repo";

/** One event on the stream; `event` is the SSE event name. */
export type StreamEvent =
  | { event: "change"; data: LoggedChange }
  | { event: "reset"; data: { rev: number; snapshot: Snapshot } }
  | { event: "presence"; data: { users: Presence[] } }
  | { event: "proposal"; data: unknown }
  | { event: "agent"; data: unknown }
  | { event: "ping"; data: { rev: number } };

export interface StreamOptions {
  /** Stop after this many milliseconds; the client reconnects. */
  duration?: number;
  /** Delay between log polls. */
  poll?: number;
  /** Polls between presence reads. */
  presenceEvery?: number;
  signal?: AbortSignal;
  /**
   * Extra sources polled alongside the log (Phase D's proposals and agent
   * steps). Each returns the events that are new since it was last asked.
   */
  extras?: (() => Promise<StreamEvent[]>)[];
  storage?: Repo;
  sleep?: (ms: number) => Promise<void>;
}

/** Vercel's limit is 60 s for this route; the stream ends a little before. */
export const STREAM_MS = 55_000;

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Everything a client at `since` needs to hear, until the connection's time is up. */
export async function* projectEvents(projectId: string, since: number, options: StreamOptions = {}): AsyncGenerator<StreamEvent> {
  const storage = options.storage ?? repo();
  const sleep = options.sleep ?? wait;
  const duration = options.duration ?? STREAM_MS;
  const poll = options.poll ?? 1000;
  const presenceEvery = options.presenceEvery ?? 2;
  const started = Date.now();
  let cursor = since;
  let lastPresence = "";
  let round = 0;
  while (!options.signal?.aborted) {
    const found = await storage.live.since(projectId, cursor);
    if ("reset" in found) {
      cursor = found.rev;
      yield { event: "reset", data: { rev: found.rev, snapshot: found.reset } };
    } else {
      for (const change of found.changes) {
        cursor = change.rev;
        yield { event: "change", data: change };
      }
    }
    if (round % presenceEvery === 0) {
      const users = await storage.live.presence.list(projectId);
      // Heartbeats refresh expiry every few seconds; only who-is-where matters.
      const key = JSON.stringify(users.map(u => [u.userId, u.screenId, u.selection, u.cursor]));
      if (key !== lastPresence) {
        lastPresence = key;
        yield { event: "presence", data: { users } };
      }
    }
    for (const extra of options.extras ?? []) {
      for (const event of await extra()) yield event;
    }
    round += 1;
    if (Date.now() - started + poll >= duration) break;
    await sleep(poll);
  }
  yield { event: "ping", data: { rev: cursor } };
}

/** One event in the SSE wire format. */
export function sse(event: StreamEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
