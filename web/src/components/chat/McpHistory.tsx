"use client";

/**
 * Every proposal Claude made through MCP that has been decided, newest first,
 * each with its log.
 *
 * The open ones are decided in SharedProposals; this is what happened to the
 * rest. Each row says its state at a glance, and opens into a timeline built
 * from the proposal record the server keeps: when it was asked for and by
 * whom, every change it carried and whether that change was accepted, what
 * could not be done (also in the gap log), and who decided, when, and the
 * revision it landed at. Nothing here is fetched separately; it is the same
 * list the stream keeps current.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronRight, CircleDot, Minus, X } from "lucide-react";
import type { SharedProposal } from "@/store/proposals";
import { cn } from "@/components/ui";

const STATE: Record<Exclude<SharedProposal["status"], "open">, { label: string; tone: string }> = {
  accepted: { label: "Accepted", tone: "border-status-ok/40 bg-status-ok/10 text-status-ok" },
  "partially-accepted": { label: "Partly accepted", tone: "border-status-warn/40 bg-status-warn/10 text-status-warn" },
  discarded: { label: "Discarded", tone: "border-line bg-surface-raised text-text-muted" },
};

/** "3 min ago", "yesterday", or a date: short enough for a row. */
function ago(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172_800) return "yesterday";
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const stamp = (ms: number) => new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** One line of a proposal's log. */
function Entry({ at, icon, tone, children }: { at?: number; icon: React.ReactNode; tone?: string; children: React.ReactNode }) {
  return (
    <li className="relative flex gap-2.5 pb-3 last:pb-0">
      <span aria-hidden className={cn("relative z-10 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border bg-surface-panel", tone ?? "border-line text-text-faint")}>
        {icon}
      </span>
      <div className="min-w-0 flex-1 text-[11px] leading-relaxed text-text-secondary">
        {children}
        {at && (
          <span className="ml-1.5 font-mono text-[10px] text-text-faint" title={new Date(at).toLocaleString()}>
            {stamp(at)}
          </span>
        )}
      </div>
    </li>
  );
}

export function ProposalLog({ p }: { p: SharedProposal }) {
  const accepted = new Set(p.acceptedOpIndexes ?? (p.status === "accepted" ? p.labels.map((_, i) => i) : []));
  return (
    <ol className="relative mt-2 border-t border-line-subtle pt-3">
      {/* The rail the entries hang on. */}
      <span aria-hidden className="absolute bottom-2 left-[7.5px] top-4 w-px bg-line-subtle" />
      <Entry at={p.createdAt} icon={<CircleDot size={9} />} tone="border-connector-500/50 text-connector-400">
        Claude proposed {p.labels.length} change{p.labels.length === 1 ? "" : "s"} for <span className="text-text-primary">{p.requestedByName}</span>
        {p.request && <span className="mt-0.5 block text-text-muted">&ldquo;{p.request}&rdquo;</span>}
      </Entry>
      <Entry icon={<Minus size={9} />}>
        <span className="text-text-muted">What it carried</span>
        <ul className="mt-1 space-y-0.5">
          {p.labels.map((label, i) => (
            <li key={i} className="flex gap-1.5">
              {p.status === "discarded" || !accepted.has(i) ? (
                <X size={11} aria-label="not applied" className="mt-0.5 shrink-0 text-text-faint" />
              ) : (
                <Check size={11} aria-label="applied" strokeWidth={2.5} className="mt-0.5 shrink-0 text-status-ok" />
              )}
              <span className={cn("min-w-0", (p.status === "discarded" || !accepted.has(i)) && "text-text-faint line-through decoration-text-faint/50")}>{label}</span>
            </li>
          ))}
        </ul>
      </Entry>
      {p.rejected.length > 0 && (
        <Entry icon={<AlertTriangle size={9} />} tone="border-status-warn/50 text-status-warn">
          <span className="text-status-warn">
            {p.rejected.length} part{p.rejected.length === 1 ? "" : "s"} could not be done
          </span>
          <span className="text-text-faint"> · logged as gaps</span>
          <ul className="mt-1 space-y-0.5 text-text-muted">
            {p.rejected.map((line, i) => (
              <li key={i} className="break-words">{line}</li>
            ))}
          </ul>
        </Entry>
      )}
      {p.status !== "open" && (
        <Entry
          at={p.decidedAt}
          icon={p.status === "discarded" ? <X size={9} /> : <Check size={9} strokeWidth={3} />}
          tone={p.status === "discarded" ? "border-line text-text-muted" : "border-status-ok/50 text-status-ok"}
        >
          {STATE[p.status].label}
          {p.decidedByName && (
            <>
              {" "}by <span className="text-text-primary">{p.decidedByName}</span>
            </>
          )}
          {p.status !== "discarded" && p.labels.length > 1 && ` · ${accepted.size} of ${p.labels.length} changes`}
          {p.rev !== undefined && <span className="text-text-muted"> · landed as revision {p.rev}</span>}
        </Entry>
      )}
    </ol>
  );
}

export function McpHistory({ proposals }: { proposals: SharedProposal[] }) {
  const past = useMemo(() => proposals.filter((p) => p.status !== "open").sort((a, b) => (b.decidedAt ?? b.updatedAt) - (a.decidedAt ?? a.updatedAt)), [proposals]);
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  if (past.length === 0) return null;
  const shown = all ? past : past.slice(0, 8);
  const counts = {
    accepted: past.filter((p) => p.status === "accepted").length,
    partly: past.filter((p) => p.status === "partially-accepted").length,
    discarded: past.filter((p) => p.status === "discarded").length,
  };

  return (
    <section aria-label="Past proposals from MCP" className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="label-eyebrow">Past proposals</p>
        <p className="font-mono text-[10px] text-text-faint">
          {counts.accepted} accepted{counts.partly ? ` · ${counts.partly} partly` : ""} · {counts.discarded} discarded
        </p>
      </div>
      <ul className="space-y-1.5">
        {shown.map((p) => {
          const expanded = open === p._id;
          const state = STATE[p.status as keyof typeof STATE];
          return (
            <li key={p._id} className={cn("rounded-xl border px-2.5 py-2 transition-colors", expanded ? "border-line bg-surface-raised/60" : "border-line-subtle bg-surface-raised/30 hover:bg-surface-raised/50")}>
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : p._id)}
                aria-expanded={expanded}
                className="focus-ring flex w-full items-start gap-2 rounded text-left"
              >
                <ChevronRight size={12} aria-hidden className={cn("mt-0.5 shrink-0 text-text-faint transition-transform", expanded && "rotate-90")} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-[11px] leading-snug text-text-primary", !expanded && "line-clamp-2")}>{p.request || "A change"}</span>
                  <span className="mt-0.5 block text-[10px] text-text-faint">
                    {p.labels.length} change{p.labels.length === 1 ? "" : "s"}
                    {p.rejected.length > 0 && <span className="text-status-warn"> · {p.rejected.length} not done</span>} · {ago(p.decidedAt ?? p.updatedAt)}
                  </span>
                </span>
                <span className={cn("shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium", state.tone)}>{state.label}</span>
              </button>
              {expanded && <ProposalLog p={p} />}
            </li>
          );
        })}
      </ul>
      {past.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="focus-ring rounded text-[11px] text-connector-400 hover:underline">
          Show all {past.length}
        </button>
      )}
    </section>
  );
}
