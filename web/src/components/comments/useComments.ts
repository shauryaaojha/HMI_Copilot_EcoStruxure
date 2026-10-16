"use client";

/**
 * The browser's side of a project's comments.
 *
 * Comments live on the server beside the project (src/app/api/projects/[id]/
 * comments) and exist only for a project that has a server copy - a
 * browser-only project has nobody to talk to. This hook is the one place the
 * canvas, the side list and the shared view read them from and write them
 * through, so a reply posted in the list and a pin placed on the canvas are the
 * same request.
 *
 * There is no live push yet. While the comments are open the list is fetched
 * again every ten seconds and after every change this browser makes, which is
 * enough for two people reviewing a screen together; a later phase replaces the
 * interval with the project's change stream.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** One comment as the server returns it. Mirrors the repo record, not imported from server code. */
export interface Comment {
  _id: string;
  projectId: string;
  screenId?: string;
  objectId?: string;
  x?: number;
  y?: number;
  authorId: string;
  body: string;
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
  parentId?: string;
  editedAt?: number;
}

/** What a new top-level comment is pinned to. Replies inherit all of it from their parent. */
export interface CommentPlacement {
  screenId?: string;
  objectId?: string;
  x?: number;
  y?: number;
}

/** A top-level comment with its replies, oldest first - the shape the list draws. */
export interface CommentThread {
  comment: Comment;
  replies: Comment[];
}

/** The server's limit on a comment body; the composer stops there rather than failing on post. */
export const MAX_COMMENT = 4000;

/** How often an open comments list asks again, until live updates arrive. */
const POLL_MS = 10_000;

/** The error text the server put in its body, or a plain fallback. */
async function failure(response: Response, fallback: string): Promise<Error> {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    return new Error(body.error ?? body.message ?? fallback);
  } catch {
    return new Error(fallback);
  }
}

/**
 * Top-level comments with their replies attached, oldest first.
 *
 * Exported because the numbering of pins depends on it: a pin's number is its
 * thread's place in this order, so it does not change when a later comment is
 * resolved or deleted.
 */
export function threadsOf(comments: Comment[]): CommentThread[] {
  const byTime = [...comments].sort((a, b) => a.createdAt - b.createdAt);
  const threads = new Map<string, CommentThread>();
  for (const c of byTime) {
    if (!c.parentId) threads.set(c._id, { comment: c, replies: [] });
  }
  for (const c of byTime) {
    if (c.parentId) threads.get(c.parentId)?.replies.push(c);
  }
  return [...threads.values()];
}

export interface UseComments {
  comments: Comment[];
  /** Display names keyed by user id, as the server resolved them. */
  authors: Record<string, string>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (placement: CommentPlacement, body: string) => Promise<Comment | null>;
  reply: (parentId: string, body: string) => Promise<Comment | null>;
  setResolved: (id: string, resolved: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/**
 * Comments for `projectId`, fetched while `open` is true.
 *
 * Pass `open: false` for a browser-only project, or while the comments are
 * hidden: nothing is requested and the lists stay empty. Every mutation
 * refetches afterwards rather than patching the list in place, so the order,
 * the authors and what the server decided (a reply's inherited position, a
 * resolve time) always come from the server.
 */
export function useComments(projectId: string, open: boolean): UseComments {
  const [comments, setComments] = useState<Comment[]>([]);
  const [authors, setAuthors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The project the latest response belongs to, so a slow reply for the last project is dropped. */
  const current = useRef(projectId);
  current.current = projectId;

  const base = `/api/projects/${encodeURIComponent(projectId)}/comments`;

  const refresh = useCallback(async () => {
    if (!projectId) return;
    const asked = projectId;
    setLoading(true);
    try {
      const response = await fetch(base, { cache: "no-store" });
      if (!response.ok) throw await failure(response, "Could not load comments");
      const body = (await response.json()) as { comments: Comment[]; authors?: Record<string, string> };
      if (current.current !== asked) return;
      setComments(body.comments ?? []);
      setAuthors(body.authors ?? {});
      setError(null);
    } catch (e) {
      if (current.current === asked) setError(e instanceof Error ? e.message : "Could not load comments");
    } finally {
      if (current.current === asked) setLoading(false);
    }
  }, [base, projectId]);

  useEffect(() => {
    if (!open || !projectId) return;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [open, projectId, refresh]);

  // A different project starts from an empty list, not the last project's threads.
  useEffect(() => {
    setComments([]);
    setAuthors({});
    setError(null);
  }, [projectId]);

  /** One write, then the list again. Errors are kept for the panel to show, not thrown. */
  const mutate = useCallback(
    async <T,>(run: () => Promise<Response>, fallback: string, pick: (body: unknown) => T): Promise<T | null> => {
      try {
        const response = await run();
        if (!response.ok) throw await failure(response, fallback);
        const value = pick(await response.json());
        setError(null);
        await refresh();
        return value;
      } catch (e) {
        setError(e instanceof Error ? e.message : fallback);
        return null;
      }
    },
    [refresh],
  );

  const post = useCallback(
    (payload: Record<string, unknown>) =>
      mutate(
        () =>
          fetch(base, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }),
        "Could not post the comment",
        (body) => (body as { comment: Comment }).comment,
      ),
    [base, mutate],
  );

  const create = useCallback(
    (placement: CommentPlacement, body: string) => post({ ...placement, body: body.slice(0, MAX_COMMENT) }),
    [post],
  );

  const reply = useCallback(
    (parentId: string, body: string) => post({ parentId, body: body.slice(0, MAX_COMMENT) }),
    [post],
  );

  const setResolved = useCallback(
    async (id: string, resolved: boolean) => {
      await mutate(
        () =>
          fetch(`${base}/${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resolved }),
          }),
        resolved ? "Could not resolve the comment" : "Could not reopen the comment",
        () => true,
      );
    },
    [base, mutate],
  );

  const remove = useCallback(
    async (id: string) => {
      await mutate(
        () => fetch(`${base}/${encodeURIComponent(id)}`, { method: "DELETE" }),
        "Could not delete the comment",
        () => true,
      );
    },
    [base, mutate],
  );

  return { comments, authors, loading, error, refresh, create, reply, setResolved, remove };
}
