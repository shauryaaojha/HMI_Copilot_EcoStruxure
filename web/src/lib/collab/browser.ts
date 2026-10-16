"use client";

/**
 * The real transport for a live session: fetch for changes and heartbeats,
 * EventSource for the stream. Kept apart from sync.ts so the session's logic
 * is tested with an in-memory transport and no network.
 */
import type { StreamHandlers, Transport } from "./sync";

/** Read a JSON answer, turning a refusal into an error that names it. */
async function answer<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? `The server answered ${response.status}`);
  return body as T;
}

/** fetch + EventSource, against the project routes. */
export const browserTransport: Transport = {
  async post(projectId, body) {
    const response = await fetch(`/api/projects/${projectId}/changes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return answer(response);
  },

  async presence(projectId, body) {
    await fetch(`/api/projects/${projectId}/presence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },

  async snapshot(projectId) {
    const body = await answer<{ rev: number; snapshot: never }>(await fetch(`/api/projects/${projectId}`, { cache: "no-store" }));
    return { rev: body.rev, snapshot: body.snapshot };
  },

  subscribe(projectId, since, handlers: StreamHandlers) {
    const source = new EventSource(`/api/projects/${projectId}/stream?since=${since}`);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      source.close();
    };
    const on = (name: string, handle: ((body: never) => void) | undefined) => {
      source.addEventListener(name, (event) => {
        if (!handle) return;
        try {
          handle(JSON.parse((event as MessageEvent<string>).data) as never);
        } catch {
          // A malformed event is skipped; the next reset or change corrects the state.
        }
      });
    };
    on("change", handlers.change);
    on("reset", handlers.reset);
    on("presence", handlers.presence);
    on("proposal", handlers.proposal);
    on("agent", handlers.agent);
    // The server ends each connection with a ping; EventSource would reconnect
    // from the original `since`, so the session reopens it from its own rev.
    source.addEventListener("ping", () => {
      close();
      handlers.closed();
    });
    source.onerror = () => {
      close();
      handlers.closed();
    };
    return close;
  },
};
