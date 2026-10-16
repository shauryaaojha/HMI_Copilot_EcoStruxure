/**
 * The browser half of live co-editing (Phase C).
 *
 * Nothing in the editor was rewritten to make it collaborative. A session
 * subscribes to the project store, and every committed store action is turned
 * into a `Change` by diffing the shared slice before and after it
 * (lib/collab/changes.ts). Changes queue locally and are POSTed in batches
 * every 300 ms; remote changes arrive over Server-Sent Events and are applied
 * to the store without being captured again.
 *
 * The session keeps two documents in mind: `confirmed`, what the server's log
 * says up to the last revision heard, and the store, which is `confirmed` plus
 * this person's changes still on their way. When a remote change arrives it is
 * applied to `confirmed` and the pending changes are replayed on top - a
 * rebase - so a local edit is never lost under someone else's, and the server
 * (which applies in arrival order) ends in the same place.
 *
 * Undo is per person. The store's own undo would restore a whole slice and
 * take other people's work with it, so while a session runs, undo sends the
 * inverse of this person's last change instead, and redo the inverse of that.
 */
import { apply, compact, diff, docOf, invert, SYNCED_KEYS } from "./changes";
import type { Change, ChangesResult, Doc, LoggedChange, Presence, StoreChange } from "./types";
import type { Snapshot } from "@/lib/server/repo";

/** How the session talks to the server; the browser uses fetch and EventSource. */
export interface Transport {
  post(projectId: string, body: { base: number; changes: Change[] }): Promise<ChangesResult>;
  presence(projectId: string, body: { screenId?: string; selection: string[]; cursor?: { x: number; y: number } }): Promise<void>;
  /** Open the event stream from `since`; returns a function that closes it. */
  subscribe(projectId: string, since: number, handlers: StreamHandlers): () => void;
  /** The current snapshot and rev, for recovering after a refused change. */
  snapshot(projectId: string): Promise<{ rev: number; snapshot: Snapshot }>;
}

export interface StreamHandlers {
  change(entry: LoggedChange): void;
  reset(body: { rev: number; snapshot: Snapshot }): void;
  presence(body: { users: Presence[] }): void;
  proposal?(body: unknown): void;
  agent?(body: unknown): void;
  /** The connection ended (time limit or error): the session reconnects from its last rev. */
  closed(): void;
}

/** The store surface a session needs: zustand's, narrowed. */
export interface SessionStore {
  getState(): SessionState;
  setState(partial: Partial<SessionState>): void;
  subscribe(listener: (state: SessionState, previous: SessionState) => void): () => void;
}

/** The store fields a session reads or replaces, beyond the synced slice. */
export type SessionState = Doc & {
  id: string;
  activeScreenId?: string;
  selectedIds: string[];
  past: unknown[];
  future: unknown[];
  undo: () => void;
  redo: () => void;
} & Record<string, unknown>;

export interface SessionOptions {
  projectId: string;
  /** The signed-in user's id, or null for a read-only visitor who only listens. */
  author: string | null;
  /** The revision the store was loaded at. */
  rev: number;
  store: SessionStore;
  transport: Transport;
  /** Batching interval for outgoing changes. */
  interval?: number;
  /** Presence heartbeat interval. */
  heartbeat?: number;
  /** Told when the confirmed revision or the queue changes (for the save status). */
  onStatus?: (status: { rev: number; pending: number; error?: string }) => void;
  onPresence?: (users: Presence[]) => void;
  onProposal?: (body: unknown) => void;
  onAgent?: (body: unknown) => void;
  newId?: () => string;
  timers?: { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
}

/** One of this person's changes, remembered so undo can send its inverse. */
interface UndoEntry {
  inverse: StoreChange[];
}

type Capture = "edit" | "undo" | "redo";

/** Fastest a moving pointer is reported. */
const CURSOR_MS = 1000;

/** How long to wait before reopening a closed stream. */
const RECONNECT_MS = 500;

/** One live connection between a project in the store and the server's log. */
export class CollabSession {
  private confirmed: Doc;
  private rev: number;
  /** Changes made here and not yet heard back from the log, oldest first. */
  private pending: Change[] = [];
  /** Of those, the ones not yet POSTed. */
  private queued: Change[] = [];
  private inflight = false;
  private applyingRemote = false;
  private capture: Capture = "edit";
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private unsubscribeStore?: () => void;
  private closeStream?: () => void;
  private flushTimer?: unknown;
  private beatTimer?: unknown;
  private reconnectTimer?: unknown;
  private cursor?: { x: number; y: number };
  private lastBeat = 0;
  private originalUndo?: () => void;
  private originalRedo?: () => void;
  private stopped = false;
  private readonly timers: NonNullable<SessionOptions["timers"]>;
  private readonly newId: () => string;

  constructor(private options: SessionOptions) {
    this.confirmed = docOf(options.store.getState());
    this.rev = options.rev;
    this.timers = options.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  /** Begin listening to the store and to the server. */
  start() {
    const store = this.options.store;
    this.unsubscribeStore = store.subscribe((state, previous) => this.onStore(state, previous));
    if (this.options.author) {
      const s = store.getState();
      this.originalUndo = s.undo;
      this.originalRedo = s.redo;
      store.setState({ undo: () => this.undo(), redo: () => this.redo() });
      this.scheduleBeat(0);
    }
    this.connect();
  }

  /** Stop: flush nothing more, close the stream, give the store its own undo back. */
  stop() {
    this.stopped = true;
    this.unsubscribeStore?.();
    this.closeStream?.();
    for (const timer of [this.flushTimer, this.beatTimer, this.reconnectTimer]) {
      if (timer !== undefined) this.timers.clear(timer);
    }
    if (this.originalUndo && this.originalRedo) {
      this.options.store.setState({ undo: this.originalUndo, redo: this.originalRedo });
    }
  }

  /** The last revision this session has applied from the server. */
  get revision() {
    return this.rev;
  }

  /** Changes made here that the server has not yet confirmed. */
  get unconfirmed() {
    return this.pending.length;
  }

  /**
   * Where this person's pointer is on the active screen. Sent with the next
   * heartbeat, or at once if none went out in the last second, so a moving
   * pointer is seen moving without a request per mouse event.
   */
  setCursor(cursor: { x: number; y: number } | undefined) {
    this.cursor = cursor;
    if (Date.now() - this.lastBeat >= CURSOR_MS) this.beat();
  }

  /** Send a heartbeat now, e.g. when the selection or screen changes. */
  beat() {
    if (!this.options.author || this.stopped) return;
    this.lastBeat = Date.now();
    const s = this.options.store.getState();
    void this.options.transport
      .presence(this.options.projectId, { screenId: s.activeScreenId, selection: s.selectedIds, ...(this.cursor ? { cursor: this.cursor } : {}) })
      .catch(() => undefined);
  }

  /* --- capturing local edits ----------------------------------------- */

  private onStore(state: SessionState, previous: SessionState) {
    if (this.applyingRemote) return;
    if (state.activeScreenId !== previous.activeScreenId || state.selectedIds !== previous.selectedIds) this.beat();
    const before = docOf(previous);
    const ops = diff(before, docOf(state));
    if (ops.length === 0) return;
    if (!this.options.author) return;
    const change: Change = { id: this.newId(), base: this.rev, author: this.options.author, ops };
    this.pending.push(change);
    this.queued.push(change);
    const entry = { inverse: invert(before, ops) };
    if (this.capture === "undo") this.redoStack.push(entry);
    else if (this.capture === "redo") this.undoStack.push(entry);
    else {
      this.undoStack.push(entry);
      this.redoStack = [];
    }
    this.scheduleFlush();
    this.report();
  }

  /** Revert this person's last change by sending its inverse. */
  undo() {
    this.replay(this.undoStack, "undo");
  }

  /** Re-apply what the last undo reverted. */
  redo() {
    this.replay(this.redoStack, "redo");
  }

  private replay(stack: UndoEntry[], mode: Capture) {
    const entry = stack.pop();
    if (!entry) return;
    const store = this.options.store;
    const next = apply(docOf(store.getState()), entry.inverse);
    this.capture = mode;
    try {
      store.setState(this.patchFor(next));
    } finally {
      this.capture = "edit";
    }
  }

  /* --- sending ------------------------------------------------------- */

  private scheduleFlush() {
    if (this.flushTimer !== undefined || this.stopped) return;
    this.flushTimer = this.timers.set(() => {
      this.flushTimer = undefined;
      void this.flush();
    }, this.options.interval ?? 300);
  }

  /**
   * POST what is queued as one change per batch. Merging is safe: undo keeps
   * its own records, and `compact` never changes what the ops do.
   */
  async flush(): Promise<void> {
    if (this.inflight || this.queued.length === 0 || !this.options.author) return;
    const batch = this.queued.splice(0);
    const merged: Change = { id: batch[batch.length - 1].id, base: this.rev, author: this.options.author, ops: compact(batch.flatMap((c) => c.ops)) };
    // The merged change stands in for its parts in the pending list.
    const ids = new Set(batch.map((c) => c.id));
    const at = this.pending.findIndex((c) => ids.has(c.id));
    this.pending = this.pending.filter((c) => !ids.has(c.id));
    this.pending.splice(Math.max(0, at), 0, merged);
    this.inflight = true;
    try {
      const result = await this.options.transport.post(this.options.projectId, { base: this.rev, changes: [merged] });
      if (result.rejected.length > 0) await this.recover(result.rejected.map((r) => r.reason).join("; "));
    } catch (error) {
      // Offline or refused: keep it, and try again with the next batch.
      this.queued.unshift(merged);
      this.report(error instanceof Error ? error.message : "Could not reach the server");
    } finally {
      this.inflight = false;
    }
    if (this.queued.length > 0) this.scheduleFlush();
  }

  /**
   * The server refused a change: this browser has drifted. Start again from
   * the server's snapshot, keep what is still queued, and say so.
   */
  private async recover(reason: string) {
    const { rev, snapshot } = await this.options.transport.snapshot(this.options.projectId);
    this.pending = [...this.queued];
    this.onReset({ rev, snapshot });
    this.report(`Some changes were refused (${reason}); the project was reloaded`);
  }

  /* --- receiving ----------------------------------------------------- */

  private connect() {
    if (this.stopped) return;
    this.closeStream = this.options.transport.subscribe(this.options.projectId, this.rev, {
      change: (entry) => this.onRemote(entry),
      reset: (body) => this.onReset(body),
      presence: (body) => this.options.onPresence?.(body.users),
      proposal: (body) => this.options.onProposal?.(body),
      agent: (body) => this.options.onAgent?.(body),
      closed: () => {
        this.closeStream?.();
        if (this.stopped) return;
        this.reconnectTimer = this.timers.set(() => this.connect(), RECONNECT_MS);
      },
    });
  }

  /** A change from the log: ours is a confirmation, anyone else's is applied and rebased under. */
  onRemote(entry: LoggedChange) {
    if (entry.rev <= this.rev) return;
    this.rev = entry.rev;
    this.confirmed = apply(this.confirmed, entry.change.ops);
    const own = this.pending.findIndex((c) => c.id === entry.change.id);
    if (own !== -1) this.pending.splice(own, 1);
    this.rebase();
    this.report();
  }

  /** The server sent its whole snapshot: take it, then replay what is still ours. */
  onReset(body: { rev: number; snapshot: Snapshot }) {
    this.rev = body.rev;
    this.confirmed = docOf(body.snapshot);
    this.rebase();
    this.report();
  }

  /** Put the store at `confirmed` plus the pending changes, without capturing it. */
  private rebase() {
    let local = this.confirmed;
    for (const change of this.pending) {
      try {
        local = apply(local, change.ops);
      } catch {
        // A pending edit to a screen someone deleted cannot land; drop it.
        this.pending = this.pending.filter((c) => c !== change);
        this.queued = this.queued.filter((c) => c !== change);
      }
    }
    const store = this.options.store;
    if (diff(docOf(store.getState()), local).length === 0) return;
    this.applyingRemote = true;
    try {
      store.setState(this.patchFor(local));
    } finally {
      this.applyingRemote = false;
    }
  }

  /**
   * The store patch for a new document: the synced keys, plus an active
   * screen and selection that still point at things that exist.
   */
  private patchFor(doc: Doc): Partial<SessionState> {
    const patch: Partial<SessionState> = {};
    for (const key of SYNCED_KEYS) (patch as Record<string, unknown>)[key] = doc[key];
    const s = this.options.store.getState();
    if (!doc.screens.some((x) => x.UniqueId === s.activeScreenId)) patch.activeScreenId = doc.screens[0]?.UniqueId;
    const present = new Set(doc.screens.flatMap((x) => x.Children[0].Children.map((p) => p.UniqueId)));
    const selected = s.selectedIds.filter((id) => present.has(id));
    if (selected.length !== s.selectedIds.length) patch.selectedIds = selected;
    return patch;
  }

  /* --- presence and status -------------------------------------------- */

  private scheduleBeat(ms: number) {
    if (this.stopped) return;
    this.beatTimer = this.timers.set(() => {
      this.beat();
      this.scheduleBeat(this.options.heartbeat ?? 5000);
    }, ms);
  }

  private report(error?: string) {
    this.options.onStatus?.({ rev: this.rev, pending: this.pending.length, ...(error ? { error } : {}) });
  }
}
