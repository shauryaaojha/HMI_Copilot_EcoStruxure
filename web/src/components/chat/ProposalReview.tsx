"use client";

/**
 * A change that is waiting for the engineer, put in front of them.
 *
 * A proposal used to be a few lines of small print in the chat pane, with its
 * Accept button beside them: easy to miss when the chat was closed, and with
 * nothing to decide on but the op labels. This is the same decision as a
 * proper review: who asked for what and when, what it touches, the screen as
 * it is beside the screen as it would be, every change with a tick, what could
 * not be done, and what accepting means.
 *
 * It opens by itself when a proposal arrives for someone who can decide it,
 * once per proposal. Closing it decides nothing: the proposal stays waiting,
 * and a bar at the bottom of the workspace brings the review back.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AlertTriangle, ArrowRight, Check, Sparkles, X } from "lucide-react";
import { create } from "zustand";
import { StaticScreen } from "@/components/canvas/StaticScreen";
import { Button, cn } from "@/components/ui";
import { apply, docOf } from "@/lib/collab/changes";
import type { Doc, StoreChange } from "@/lib/collab/types";
import { useCanEdit } from "@/store/access";
import { useProject } from "@/store/project";
import { decideProposal, useProposals, type SharedProposal } from "@/store/proposals";

/** Which proposal is being reviewed, and which have already been put in front of this person. */
const useReview = create<{ open: string | null; seen: Record<string, true>; show: (id: string | null) => void; markSeen: (id: string) => void }>()((set) => ({
  open: null,
  seen: {},
  show: (id) => set((s) => ({ open: id, seen: id ? { ...s.seen, [id]: true } : s.seen })),
  markSeen: (id) => set((s) => ({ seen: { ...s.seen, [id]: true } })),
}));

/** Open the review of one proposal, from anywhere that lists it. */
export const openReview = (id: string) => useReview.getState().show(id);

export interface ScreenBrief {
  id: string;
  name: string;
  /** The screen itself is new, or is removed, in this proposal. */
  state: "new" | "removed" | "changed";
  added: number;
  changed: number;
  removed: number;
}

export interface ProposalBrief {
  screens: ScreenBrief[];
  tags: { set: number; removed: number };
  alarms: { set: number; removed: number };
  bindings: { set: number; removed: number };
  other: number;
}

/** What a proposal touches, counted from its changes against the project as it is now. */
export function briefOf(doc: Pick<Doc, "screens">, changes: StoreChange[]): ProposalBrief {
  const names = new Map(doc.screens.map((s) => [s.UniqueId, s.Name]));
  const existing = new Set(doc.screens.flatMap((s) => s.Children[0].Children.map((p) => p.UniqueId)));
  const screens = new Map<string, ScreenBrief>();
  const at = (id: string, state: ScreenBrief["state"] = "changed") => {
    const row = screens.get(id) ?? { id, name: names.get(id) ?? "a screen", state, added: 0, changed: 0, removed: 0 };
    if (state !== "changed") row.state = state;
    screens.set(id, row);
    return row;
  };
  const brief: ProposalBrief = { screens: [], tags: { set: 0, removed: 0 }, alarms: { set: 0, removed: 0 }, bindings: { set: 0, removed: 0 }, other: 0 };
  for (const c of changes) {
    if (c.kind === "setPart") {
      if (existing.has(c.part.UniqueId)) at(c.screenId).changed++;
      else at(c.screenId).added++;
    } else if (c.kind === "removePart") at(c.screenId).removed++;
    else if (c.kind === "addScreen") {
      const row = at(c.screen.UniqueId, "new");
      row.name = c.screen.Name;
      row.added += c.screen.Children[0].Children.length;
    } else if (c.kind === "removeScreen") at(c.screenId, "removed");
    else if (c.kind === "renameScreen") at(c.screenId).name = c.name;
    else if (c.kind === "reorderParts" || c.kind === "setScreenProps") at(c.screenId);
    else if (c.kind === "setVariable") brief.tags.set++;
    else if (c.kind === "removeVariable") brief.tags.removed++;
    else if (c.kind === "setAlarm") brief.alarms.set++;
    else if (c.kind === "removeAlarm") brief.alarms.removed++;
    else if (c.kind === "setBinding") brief.bindings.set++;
    else if (c.kind === "removeBinding") brief.bindings.removed++;
    else brief.other++;
  }
  brief.screens = [...screens.values()];
  return brief;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function ago(at: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${plural(minutes, "minute")} ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${plural(hours, "hour")} ago` : `${plural(Math.round(hours / 24), "day")} ago`;
}

/** "3 added, 1 changed" for one screen. */
function screenLine(s: ScreenBrief): string {
  if (s.state === "removed") return "the whole screen is deleted";
  const bits = [s.added && `${s.added} added`, s.changed && `${s.changed} changed`, s.removed && `${s.removed} removed`].filter(Boolean);
  return `${s.state === "new" ? "a new screen" : ""}${s.state === "new" && bits.length ? ", " : ""}${bits.join(", ")}` || "its properties";
}

function Picture({ label, doc, screenId, empty }: { label: string; doc: Doc | null; screenId: string; empty: string }) {
  const screen = doc?.screens.find((s) => s.UniqueId === screenId);
  return (
    <figure className="min-w-0 flex-1 space-y-1.5">
      <figcaption className="label-eyebrow">{label}</figcaption>
      <div className="overflow-hidden rounded-lg border border-line-subtle bg-surface-raised shadow-[var(--elev-1)]" style={{ aspectRatio: doc ? `${doc.target.width} / ${doc.target.height}` : "16 / 10" }}>
        {screen && doc ? (
          <StaticScreen screen={screen} foreign={doc.foreign?.[screenId]} panel={{ width: doc.target.width, height: doc.target.height }} />
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-center text-xs text-text-faint">{empty}</div>
        )}
      </div>
    </figure>
  );
}

export function ProposalReviewDialog({ proposal, onClose }: { proposal: SharedProposal; onClose: () => void }) {
  const canEdit = useCanEdit();
  const projectId = useProject((s) => s.id);
  const dialog = useRef<HTMLDivElement>(null);
  const many = proposal.labels.length > 1;
  const partial = many && !!proposal.ops;
  const [keep, setKeep] = useState<number[]>(() => proposal.labels.map((_, i) => i));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const open = proposal.status === "open";

  // The project as it is, and as it would be. A proposal made against an older
  // revision may no longer apply cleanly; the review then says so instead of drawing it.
  const { before, after, brief } = useMemo(() => {
    const now = docOf(useProject.getState());
    let next: Doc | null = null;
    try {
      next = apply(now, proposal.changes);
    } catch {
      next = null;
    }
    return { before: now, after: next, brief: briefOf(now, proposal.changes) };
  }, [proposal.changes]);
  const [shown, setShown] = useState(() => brief.screens.find((s) => s.id === proposal.screenId)?.id ?? brief.screens[0]?.id ?? proposal.screenId ?? "");
  const shownBrief = brief.screens.find((s) => s.id === shown);

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>("[data-first]")?.focus();
  }, []);

  function keys(event: KeyboardEvent) {
    if (event.key === "Escape") onClose();
  }

  async function decide(action: "accept" | "discard") {
    setBusy(true);
    setError(undefined);
    try {
      await decideProposal(projectId, proposal._id, action, action === "accept" && partial ? keep : undefined);
      if (useProject.getState().preview?.messageId === proposal._id) useProject.getState().setPreview(undefined);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The decision could not be recorded. Nothing has changed; try again.");
    } finally {
      setBusy(false);
    }
  }

  const facts = [
    brief.tags.set + brief.tags.removed > 0 && `${plural(brief.tags.set, "tag")} added or changed${brief.tags.removed ? `, ${brief.tags.removed} removed` : ""}`,
    brief.alarms.set + brief.alarms.removed > 0 && `${plural(brief.alarms.set, "alarm")} added or changed${brief.alarms.removed ? `, ${brief.alarms.removed} removed` : ""}`,
    brief.bindings.set + brief.bindings.removed > 0 && `${plural(brief.bindings.set, "binding")} set${brief.bindings.removed ? `, ${brief.bindings.removed} removed` : ""}`,
  ].filter(Boolean) as string[];
  const deletes = brief.screens.some((s) => s.state === "removed" || s.removed > 0) || brief.tags.removed > 0 || brief.alarms.removed > 0;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="proposal-review-title"
        onKeyDown={keys}
        className="menu animate-pop relative my-auto flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl text-left"
        style={{ boxShadow: "var(--elev-2)" }}
      >
        <header className="page-head flex items-start gap-3 border-b border-line-subtle px-6 py-5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-brand-400">
            <Sparkles size={15} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="proposal-review-title" className="text-base font-semibold text-text-primary">
              {open ? "A change is waiting for you" : "A change that was decided"}
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              Made by the HMI Copilot for {proposal.requestedByName}, {ago(proposal.createdAt)}. Nothing in the project has changed yet.
            </p>
          </div>
          <Button variant="ghost" size="sm" iconOnly aria-label="Close and decide later" icon={<X size={14} aria-hidden />} onClick={onClose} />
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <section className="space-y-1.5">
            <p className="label-eyebrow">What was asked</p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">{proposal.request || "A change, with no note."}</p>
          </section>

          <section className="space-y-2">
            <p className="label-eyebrow">What it touches</p>
            {brief.screens.length === 0 && facts.length === 0 ? (
              <p className="text-sm text-text-secondary">Nothing on a screen. {plural(proposal.labels.length, "change")} to the project itself.</p>
            ) : (
              <>
                {brief.screens.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {brief.screens.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => setShown(s.id)}
                          aria-pressed={shown === s.id}
                          className={cn(
                            "focus-ring rounded-lg border px-3 py-2 text-left text-xs transition",
                            shown === s.id ? "border-brand-500/60 bg-brand-500/[0.08]" : "border-line-subtle hover:border-line-strong",
                          )}
                        >
                          <span className="block font-semibold text-text-primary">{s.name}</span>
                          <span className={cn("block", s.state === "removed" ? "text-status-warn" : "text-text-muted")}>{screenLine(s)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {facts.length > 0 && <p className="text-xs text-text-secondary">Also: {facts.join("; ")}.</p>}
              </>
            )}
          </section>

          {shown && (
            <section className="space-y-2">
              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                <Picture label="Now" doc={before} screenId={shown} empty={shownBrief?.state === "new" ? "This screen does not exist yet." : "Not on this screen."} />
                <ArrowRight size={16} aria-hidden className="hidden shrink-0 text-text-faint sm:block" />
                <Picture
                  label="If you accept"
                  doc={after}
                  screenId={shown}
                  empty={after ? "This screen would be deleted." : "The project has changed since this was proposed, so it cannot be drawn. Accepting runs it against the project as it is now."}
                />
              </div>
              {partial && keep.length < proposal.labels.length && <p className="text-[11px] text-text-faint">The picture shows every change, including the ones you have unticked.</p>}
            </section>
          )}

          <section className="space-y-2">
            <p className="label-eyebrow">{plural(proposal.labels.length, "change")}</p>
            <ul className="space-y-1.5" aria-label="Proposed changes">
              {proposal.labels.map((label, i) => (
                <li key={i}>
                  {open && partial && canEdit ? (
                    <label className="flex cursor-pointer gap-2.5 text-sm leading-relaxed text-text-secondary">
                      <input
                        type="checkbox"
                        checked={keep.includes(i)}
                        onChange={() => setKeep((k) => (k.includes(i) ? k.filter((x) => x !== i) : [...k, i].sort((a, b) => a - b)))}
                        className="mt-1 accent-[var(--color-brand-500)]"
                      />
                      <span className="min-w-0">{label}</span>
                    </label>
                  ) : (
                    <span className="flex gap-2.5 text-sm leading-relaxed text-text-secondary">
                      <Check size={13} aria-hidden strokeWidth={2.5} className={cn("mt-1 shrink-0", !open && !(proposal.acceptedOpIndexes ?? []).includes(i) ? "text-text-faint" : "text-brand-400")} />
                      <span className="min-w-0">{label}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {proposal.rejected.length > 0 && (
            <section className="space-y-2 rounded-lg border border-status-warn/40 p-3">
              <p className="label-eyebrow text-status-warn">Asked for, and could not be done</p>
              <ul className="space-y-1.5">
                {proposal.rejected.map((line, i) => (
                  <li key={i} className="flex gap-2 text-sm leading-relaxed text-status-warn">
                    <AlertTriangle size={13} aria-hidden className="mt-1 shrink-0" />
                    <span className="min-w-0">{line}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="text-xs leading-relaxed text-text-muted">
            {open
              ? `Accepting applies ${partial ? "the ticked changes" : "these changes"} to the project as a new revision, with your name against the decision in the sign-off log. You can undo it from History. Discarding changes nothing and is logged the same way.${deletes ? " This proposal deletes something: check the list before you accept." : ""}`
              : `${proposal.status === "discarded" ? "Discarded" : proposal.status === "partially-accepted" ? "Partly accepted" : "Accepted"}${proposal.decidedByName ? ` by ${proposal.decidedByName}` : ""}.`}
          </p>
          {error && <p role="alert" className="text-sm text-status-warn">{error}</p>}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line-subtle px-6 py-4">
          {open && canEdit ? (
            <>
              <Button variant="ghost" onClick={onClose} disabled={busy}>Decide later</Button>
              <Button onClick={() => void decide("discard")} disabled={busy}>Discard</Button>
              <Button data-first variant="primary" onClick={() => void decide("accept")} disabled={busy || keep.length === 0}>
                {partial ? `Accept ${keep.length} of ${proposal.labels.length}` : "Accept"}
              </Button>
            </>
          ) : (
            <>
              {open && <span className="mr-auto text-xs text-text-muted">Waiting for an editor to accept or discard.</span>}
              <Button data-first onClick={onClose}>Close</Button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

/**
 * Mounted once in the workspace: the review dialog, and the bar that says
 * something is waiting when the dialog is closed.
 */
export function ProposalReviewHost() {
  const list = useProposals((s) => s.list);
  const canEdit = useCanEdit();
  const openId = useReview((s) => s.open);
  const seen = useReview((s) => s.seen);
  const waiting = useMemo(() => list.filter((p) => p.status === "open"), [list]);
  const reviewing = list.find((p) => p._id === openId);

  // A proposal that arrives for someone who can decide it is put in front of them, once.
  useEffect(() => {
    if (!canEdit || openId) return;
    const fresh = waiting.find((p) => !seen[p._id]);
    if (fresh) useReview.getState().show(fresh._id);
  }, [waiting, seen, canEdit, openId]);

  if (reviewing) return <ProposalReviewDialog key={reviewing._id} proposal={reviewing} onClose={() => useReview.getState().show(null)} />;
  if (waiting.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-10 z-40 flex justify-center px-4">
      <button
        type="button"
        onClick={() => openReview(waiting[0]._id)}
        className="focus-ring pointer-events-auto inline-flex items-center gap-2.5 rounded-full border border-brand-500/50 bg-surface-float px-4 py-2 text-sm text-text-primary transition hover:border-brand-400"
        style={{ boxShadow: "var(--elev-2)" }}
      >
        <Sparkles size={14} aria-hidden className="text-brand-400" />
        <span>{waiting.length === 1 ? "A change from the Copilot is waiting" : `${waiting.length} changes from the Copilot are waiting`}</span>
        <span className="rounded-full bg-brand-500 px-2.5 py-0.5 text-xs font-semibold text-text-onbrand">Review</span>
      </button>
    </div>
  );
}
