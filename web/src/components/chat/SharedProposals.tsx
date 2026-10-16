"use client";

/**
 * The Copilot's proposals in a shared project, in the chat pane (Phase D).
 *
 * In a browser-only project a proposal lives on the chat message that made it
 * and only its author sees it. In a shared project a proposal belongs to the
 * project: every member sees it here and as ghosts on the canvas, editors and
 * the owner accept the ticked ops or discard it, commenters can say what they
 * think of it, and viewers watch. The decision is the server's to record; the
 * accepted changes arrive back through the change log like any other edit.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Eye, MessageSquare, Sparkles } from "lucide-react";
import { dryRun, previewOf } from "@/lib/ai/applier";
import type { Op } from "@/lib/ai/ops";
import { selectedOps } from "@/lib/ai/review";
import { docOf } from "@/lib/collab/changes";
import { previewOfChanges } from "@/lib/collab/proposal";
import { useCan, useCanEdit } from "@/store/access";
import { useProject } from "@/store/project";
import { decideProposal, useProposals, type SharedProposal } from "@/store/proposals";
import { cn } from "@/components/ui";

/** Ghost a proposal (or the ticked part of it) on the canvas, under its id. */
function showGhosts(proposal: SharedProposal, keep?: number[]) {
  const store = useProject.getState();
  const partial = keep && proposal.ops && keep.length < proposal.labels.length;
  const screens = partial
    ? previewOf(dryRun(selectedOps(proposal.ops as Op[], new Set(keep))))
    : previewOfChanges(docOf(store), proposal.changes);
  store.setPreview({ messageId: proposal._id, screens });
}

/** "Accepted by Asha", "Discarded by Ravi": a decided proposal says who decided. */
function outcome(p: SharedProposal): string {
  const who = p.decidedByName ? ` by ${p.decidedByName}` : "";
  if (p.status === "partially-accepted") return `Partly accepted${who}`;
  if (p.status === "accepted") return `Accepted${who}`;
  return `Discarded${who}`;
}

/** One proposal: what was asked, the ops to tick, and the decision buttons. */
function ProposalCard({ proposal }: { proposal: SharedProposal }) {
  const canEdit = useCanEdit();
  const canComment = useCan("comment");
  const projectId = useProject((s) => s.id);
  const ghosted = useProject((s) => s.preview?.messageId === proposal._id);
  const [keep, setKeep] = useState<number[]>(() => proposal.labels.map((_, i) => i));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState("");
  const [noted, setNoted] = useState(false);
  const open = proposal.status === "open";
  const many = proposal.labels.length > 1;

  const toggle = (i: number) => {
    const next = keep.includes(i) ? keep.filter((x) => x !== i) : [...keep, i].sort((a, b) => a - b);
    setKeep(next);
    showGhosts(proposal, next);
  };

  async function decide(action: "accept" | "discard") {
    setBusy(true);
    setError(undefined);
    try {
      await decideProposal(projectId, proposal._id, action, action === "accept" && many ? keep : undefined);
      if (useProject.getState().preview?.messageId === proposal._id) useProject.getState().setPreview(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the decision");
    } finally {
      setBusy(false);
    }
  }

  /** A comment on the proposal is an ordinary project comment that names it. */
  async function comment() {
    const body = note.trim();
    if (!body) return;
    const response = await fetch(`/api/projects/${projectId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: `On the Copilot's proposal "${proposal.request.slice(0, 80)}": ${body}`, proposalId: proposal._id, screenId: proposal.screenId }),
    });
    if (response.ok) {
      setNote("");
      setNoted(true);
    } else setError("The comment could not be saved");
  }

  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border p-2.5",
        open ? "border-brand-500/40 bg-brand-500/[0.06]" : "border-line-subtle bg-surface-raised/40",
      )}
    >
      <div className="flex items-start gap-2">
        <Sparkles size={12} aria-hidden className="mt-0.5 shrink-0 text-brand-400" />
        <p className="min-w-0 flex-1 text-[11px] leading-snug text-text-secondary">
          <span className="font-medium text-text-primary">HMI Copilot</span> for {proposal.requestedByName}:{" "}
          {proposal.request || "a change"}
        </p>
        {open && (
          <button
            type="button"
            onClick={() => (ghosted ? useProject.getState().setPreview(undefined) : showGhosts(proposal, keep))}
            title={ghosted ? "Hide the ghosts" : "Show on the canvas"}
            className={cn("focus-ring rounded p-0.5 transition hover:bg-surface-hover", ghosted ? "text-brand-400" : "text-text-faint")}
          >
            <Eye size={12} aria-hidden />
          </button>
        )}
      </div>

      <ul className="space-y-1" aria-label="Proposed changes">
        {proposal.labels.map((label, i) => (
          <li key={i}>
            {open && many && canEdit ? (
              <label className="flex cursor-pointer gap-2 text-[11px] leading-relaxed text-text-secondary">
                <input type="checkbox" checked={keep.includes(i)} onChange={() => toggle(i)} className="mt-0.5 accent-[var(--color-brand-500)]" />
                <span className="min-w-0">{label}</span>
              </label>
            ) : (
              <span className="flex gap-2 text-[11px] leading-relaxed text-text-muted">
                <Check size={11} aria-hidden strokeWidth={2.5} className={cn("mt-0.5 shrink-0", !open && !(proposal.acceptedOpIndexes ?? []).includes(i) ? "text-text-faint" : "text-brand-400")} />
                <span className="min-w-0">{label}</span>
              </span>
            )}
          </li>
        ))}
      </ul>

      {proposal.rejected.length > 0 && (
        <ul className="space-y-1">
          {proposal.rejected.map((line, i) => (
            <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-status-warn">
              <AlertTriangle size={11} aria-hidden className="mt-0.5 shrink-0" />
              <span className="min-w-0">{line}</span>
            </li>
          ))}
        </ul>
      )}

      {open && canEdit && (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            disabled={busy || keep.length === 0}
            onClick={() => void decide("accept")}
            className="focus-ring rounded-md bg-brand-500 px-2.5 py-1 text-[11px] font-medium text-text-onbrand transition hover:bg-brand-600 disabled:opacity-40"
          >
            {many ? `Accept ${keep.length} of ${proposal.labels.length}` : "Accept"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void decide("discard")}
            className="focus-ring rounded-md border border-line px-2.5 py-1 text-[11px] font-medium text-text-secondary transition hover:bg-surface-hover disabled:opacity-40"
          >
            Discard
          </button>
        </div>
      )}
      {open && !canEdit && <p className="text-[10px] text-text-faint">Waiting for an editor to accept or discard.</p>}
      {!open && <p className="label-eyebrow">{outcome(proposal)}</p>}

      {open && canComment && !canEdit && (
        <div className="flex gap-1.5">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={noted ? "Comment saved. Another?" : "Comment on this proposal…"}
            maxLength={1000}
            aria-label="Comment on this proposal"
            className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-2 py-1 text-[11px] text-text-primary outline-none focus:border-brand-500/60"
          />
          <button type="button" onClick={() => void comment()} title="Comment" className="focus-ring rounded-md border border-line px-2 text-text-muted hover:bg-surface-hover">
            <MessageSquare size={12} aria-hidden />
          </button>
        </div>
      )}
      {error && <p className="text-[11px] text-status-warn">{error}</p>}
    </div>
  );
}

/** Every proposal on the shared project, open ones first, with this person's agent steps. */
export function SharedProposals() {
  const list = useProposals((s) => s.list);
  const steps = useProposals((s) => s.steps);
  const ordered = useMemo(() => [...list.filter((p) => p.status === "open"), ...list.filter((p) => p.status !== "open").slice(0, 5)], [list]);
  const newest = list.find((p) => p.status === "open");

  // Ghosts of a proposal someone has just decided go away for everyone.
  useEffect(() => {
    const store = useProject.getState();
    const shown = list.find((p) => p._id === store.preview?.messageId);
    if (shown && shown.status !== "open") store.setPreview(undefined);
  }, [list]);

  // The newest open proposal is ghosted when it arrives, for whoever is looking.
  useEffect(() => {
    const store = useProject.getState();
    if (newest && !store.preview) showGhosts(newest);
  }, [newest]);

  if (ordered.length === 0 && steps.length === 0) return null;
  return (
    <section aria-label="Copilot proposals for this project" className="space-y-2">
      <p className="label-eyebrow">Shared with the project</p>
      {steps.length > 0 && (
        <ul className="space-y-0.5 rounded-lg border border-line-subtle p-2 font-mono text-[10px] text-text-muted">
          {steps.slice(-6).map((step, i) => (
            <li key={i} className={step.kind === "error" ? "text-status-warn" : undefined}>
              {step.kind}: {step.message}
            </li>
          ))}
        </ul>
      )}
      {ordered.map((proposal) => (
        <ProposalCard key={`${proposal._id}:${proposal.updatedAt}`} proposal={proposal} />
      ))}
    </section>
  );
}
