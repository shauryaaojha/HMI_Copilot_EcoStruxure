"use client";

/**
 * The comment threads on the screen being looked at, beside the canvas.
 *
 * The canvas shows where each thread is - a numbered pin - and this shows what
 * it says: the first comment, its replies (one level, the way review threads
 * stay readable), a reply box, Resolve or Reopen, and Delete for your own.
 * Threads pinned to the project rather than to a screen are listed under the
 * screen's own, so they are seen from wherever the reviewer is.
 *
 * Resolved threads are hidden unless asked for. A review is a list of what is
 * still open; what was settled is history, one toggle away.
 *
 * Everything here goes through useComments, and the server decides who may do
 * what. The buttons follow the same rules - commenter and up may write and
 * resolve, authors may delete their own, a manager may delete any - so a
 * viewer sees the threads without controls that would only be refused.
 */

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, MessageSquare, RotateCcw, Trash2, X } from "lucide-react";
import { getAccount } from "@/store/persist";
import { Button, EmptyState, Textarea, Toggle, cn } from "@/components/ui";
import { MAX_COMMENT, type Comment, type CommentThread, type UseComments } from "./useComments";

/** "just now", "5 min ago", "3 h ago", then a date - the precision a review needs. */
function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * The signed-in user's id, for "delete your own". Null for a signed-out
 * share-link visitor, who can read but never author.
 */
function useMyId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getAccount()
      .then((account) => live && setId(account.user?.id ?? null))
      .catch(() => {
        // No account service: nothing here is the visitor's own.
      });
    return () => {
      live = false;
    };
  }, []);
  return id;
}

/** A thread with the number its pin carries. */
export interface NumberedThread extends CommentThread {
  n: number;
}

export interface CommentsPanelProps {
  data: UseComments;
  /** Threads on the active screen, already numbered the way the pins are. */
  threads: NumberedThread[];
  /** Threads that belong to the project rather than to any screen. */
  general: NumberedThread[];
  screenName?: string;
  showResolved: boolean;
  onShowResolved: (on: boolean) => void;
  /** The thread last picked, on the canvas or here; it is scrolled to and outlined. */
  activeId: string | null;
  onActive: (id: string | null) => void;
  canComment: boolean;
  canManage: boolean;
  /** Names an object id on the screen, so a thread says what it is about. */
  objectName?: (objectId: string) => string | undefined;
  onClose: () => void;
}

/**
 * The side list. Rendered by CanvasPane in comments mode, for server
 * projects only.
 */
export function CommentsPanel({
  data,
  threads,
  general,
  screenName,
  showResolved,
  onShowResolved,
  activeId,
  onActive,
  canComment,
  canManage,
  objectName,
  onClose,
}: CommentsPanelProps) {
  const me = useMyId();
  const visible = (list: NumberedThread[]) =>
    showResolved ? list : list.filter((t) => !t.comment.resolvedAt);
  const shown = visible(threads);
  const shownGeneral = visible(general);
  const hiddenCount = threads.length + general.length - shown.length - shownGeneral.length;

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-l border-line-subtle bg-surface-panel" aria-label="Comments">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line-subtle px-3">
        <MessageSquare size={13} aria-hidden className="text-brand-400" />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">
          Comments {screenName && <span className="font-normal text-text-muted">· {screenName}</span>}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close comments"
          className="focus-ring rounded-md p-1 text-text-muted transition hover:bg-surface-hover hover:text-text-primary"
        >
          <X size={13} aria-hidden />
        </button>
      </header>

      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line-subtle px-3 py-2">
        <Toggle size="sm" checked={showResolved} onChange={onShowResolved} label="Show resolved" className="text-xs" />
        {!showResolved && hiddenCount > 0 && (
          <span className="text-[10px] text-text-faint">{hiddenCount} resolved</span>
        )}
      </div>

      {data.error && (
        <p role="alert" className="mx-3 mt-2 rounded-md border border-status-warn/30 bg-status-warn/[0.06] p-2 text-[11px] text-status-warn">
          {data.error}
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {shown.length === 0 && shownGeneral.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title={data.loading && data.comments.length === 0 ? "Loading comments…" : "No open comments"}
            body={
              canComment
                ? "Click anywhere on the screen to start a thread there, or on an object to talk about that object."
                : "Comments on this screen appear here."
            }
          />
        ) : (
          <>
            {shown.map((thread) => (
              <ThreadCard
                key={thread.comment._id}
                thread={thread}
                data={data}
                active={activeId === thread.comment._id}
                onActive={onActive}
                canComment={canComment}
                canManage={canManage}
                me={me}
                objectName={objectName}
              />
            ))}
            {shownGeneral.length > 0 && (
              <p className="label-eyebrow pt-2">Whole project</p>
            )}
            {shownGeneral.map((thread) => (
              <ThreadCard
                key={thread.comment._id}
                thread={thread}
                data={data}
                active={activeId === thread.comment._id}
                onActive={onActive}
                canComment={canComment}
                canManage={canManage}
                me={me}
                objectName={objectName}
              />
            ))}
          </>
        )}
      </div>
    </aside>
  );
}

/** One thread: the opening comment, its replies, and what the reader may do to it. */
function ThreadCard({
  thread,
  data,
  active,
  onActive,
  canComment,
  canManage,
  me,
  objectName,
}: {
  thread: NumberedThread;
  data: UseComments;
  active: boolean;
  onActive: (id: string | null) => void;
  canComment: boolean;
  canManage: boolean;
  me: string | null;
  objectName?: (objectId: string) => string | undefined;
}) {
  const { comment, replies, n } = thread;
  const [reply, setReply] = useState("");
  const [posting, setPosting] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const resolved = !!comment.resolvedAt;
  const about = comment.objectId ? objectName?.(comment.objectId) : undefined;

  // A pin clicked on the canvas brings its thread into view here.
  useEffect(() => {
    if (active) card.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [active]);

  async function send() {
    const body = reply.trim();
    if (!body) return;
    setPosting(true);
    const posted = await data.reply(comment._id, body);
    setPosting(false);
    if (posted) setReply("");
  }

  return (
    <div
      ref={card}
      onClick={() => onActive(comment._id)}
      className={cn(
        "space-y-2 rounded-lg border bg-surface-raised p-2.5 text-xs transition",
        active ? "border-brand-500/60" : "border-line-subtle",
        resolved && "opacity-70",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold",
            resolved ? "bg-surface-active text-text-secondary" : "bg-brand-500 text-text-onbrand",
          )}
        >
          {n}
        </span>
        {about && <span className="min-w-0 truncate font-mono text-[10px] text-text-muted">#{about}</span>}
        {resolved && <span className="ml-auto text-[10px] font-medium text-status-ok">Resolved</span>}
      </div>

      <CommentLine comment={comment} data={data} me={me} canManage={canManage} />
      {replies.map((r) => (
        <div key={r._id} className="border-l border-line-subtle pl-2">
          <CommentLine comment={r} data={data} me={me} canManage={canManage} />
        </div>
      ))}

      {canComment && (
        <div className="space-y-1.5 pt-0.5" onClick={(e) => e.stopPropagation()}>
          {!resolved && (
            <Textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              maxLength={MAX_COMMENT}
              placeholder="Reply…"
              aria-label="Reply"
              className="p-2 text-xs"
            />
          )}
          <div className="flex items-center justify-end gap-1">
            {!resolved && reply.trim() && (
              <Button variant="primary" size="sm" disabled={posting} onClick={() => void send()}>
                Reply
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void data.setResolved(comment._id, !resolved)}
              icon={resolved ? <RotateCcw size={12} /> : <CheckCircle2 size={12} />}
            >
              {resolved ? "Reopen" : "Resolve"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** One comment's author, time, body and - for its author or a manager - Delete. */
function CommentLine({
  comment,
  data,
  me,
  canManage,
}: {
  comment: Comment;
  data: UseComments;
  me: string | null;
  canManage: boolean;
}) {
  const mine = me !== null && comment.authorId === me;
  return (
    <div className="group space-y-0.5">
      <div className="flex items-baseline gap-1.5">
        <span className="truncate font-medium text-text-primary">{data.authors[comment.authorId] ?? "Someone"}</span>
        <span className="shrink-0 text-[10px] text-text-faint" title={new Date(comment.createdAt).toLocaleString()}>
          {ago(comment.createdAt)}
          {comment.editedAt && " · edited"}
        </span>
        {(mine || canManage) && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void data.remove(comment._id);
            }}
            aria-label="Delete comment"
            title={comment.parentId ? "Delete this reply" : "Delete this comment and its replies"}
            className="focus-ring ml-auto shrink-0 rounded p-0.5 text-text-faint opacity-0 transition hover:text-status-alarm focus:opacity-100 group-hover:opacity-100"
          >
            <Trash2 size={11} aria-hidden />
          </button>
        )}
      </div>
      <p className="whitespace-pre-wrap break-words leading-relaxed text-text-secondary">{comment.body}</p>
    </div>
  );
}

/**
 * The small box that opens where a comment is being placed.
 *
 * Fixed to the viewport at the click, clamped so a click near an edge does not
 * open it off-screen. Enter posts, Shift+Enter is a new line, Escape cancels -
 * the same keys as the copilot's composer.
 */
export function CommentComposer({
  at,
  onSubmit,
  onCancel,
}: {
  at: { x: number; y: number };
  onSubmit: (body: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  async function post() {
    const text = body.trim();
    if (!text || posting) return;
    setPosting(true);
    const ok = await onSubmit(text);
    setPosting(false);
    if (ok) setBody("");
  }

  const width = 256;
  return (
    <div
      role="dialog"
      aria-label="New comment"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        left: Math.max(8, Math.min(at.x + 12, (globalThis.innerWidth ?? 1200) - width - 8)),
        top: Math.max(8, Math.min(at.y - 8, (globalThis.innerHeight ?? 800) - 170)),
        width,
        boxShadow: "var(--elev-3)",
      }}
      className="fixed z-50 space-y-2 rounded-lg border border-line bg-surface-float p-2.5"
    >
      <Textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void post();
          }
        }}
        rows={3}
        maxLength={MAX_COMMENT}
        placeholder="Add a comment…"
        aria-label="Comment"
        className="p-2 text-xs"
      />
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" disabled={!body.trim() || posting} onClick={() => void post()}>
          {posting ? "Posting…" : "Comment"}
        </Button>
      </div>
    </div>
  );
}
