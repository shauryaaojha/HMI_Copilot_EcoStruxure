"use client";

/**
 * The build timeline: what the AI is doing, in engineering language.
 * Reference screens 1, 2, 3, 5, 6. Phase 4 of docs/BUILD_PLAN.md.
 *
 * "Parsed 247 tags -> detected 2 pumps -> bound FT_101_PV" and never "Thinking...".
 * Each step becomes clickable in Phase 4 and highlights what it produced.
 *
 * The header is h-10, matching the dock's collapsed size in WorkspaceShell, so
 * collapsing the pane leaves the title bar rather than an empty strip.
 */

import { Check, Circle, Loader, X } from "lucide-react";
import { PIPELINE_STEPS, STEP_LABELS, type StepState } from "@/types/events";
import { useProject } from "@/store/project";
import { Badge, Toggle, cn } from "@/components/ui";
import { useState } from "react";

const MARK: Record<StepState, string> = {
  done: "bg-brand-500 text-white border-brand-500",
  running: "bg-brand-500/15 text-brand-400 border-brand-400",
  failed: "bg-status-alarm text-white border-status-alarm",
  pending: "bg-surface-raised text-text-faint border-line",
};

function StepMark({ state, index }: { state: StepState; index: number }) {
  return (
    <span
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
        MARK[state],
      )}
    >
      {state === "done" ? (
        <Check size={13} aria-hidden strokeWidth={3} />
      ) : state === "failed" ? (
        <X size={13} aria-hidden strokeWidth={3} />
      ) : state === "running" ? (
        <Loader size={13} aria-hidden className="animate-spin" />
      ) : (
        index + 1
      )}
    </span>
  );
}

export function BuildTimeline() {
  const steps = useProject((s) => s.steps);
  const logs = useProject((s) => s.logs);
  const [autoScroll, setAutoScroll] = useState(true);

  const done = PIPELINE_STEPS.filter((s) => steps[s] === "done").length;

  return (
    <section className="flex h-full w-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-line-subtle px-4">
        <Circle size={14} aria-hidden className="shrink-0 text-brand-400" />
        <h2 className="shrink-0 text-sm font-semibold">Build Timeline</h2>
        <Badge tone={done === PIPELINE_STEPS.length ? "ok" : "neutral"}>
          {done} of {PIPELINE_STEPS.length} steps
        </Badge>
        <Toggle
          className="ml-auto"
          size="sm"
          checked={autoScroll}
          onChange={setAutoScroll}
          label="Auto-scroll"
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <ol className="flex min-w-0 flex-1 gap-6 overflow-x-auto p-4">
          {PIPELINE_STEPS.map((step, i) => {
            const state = steps[step] ?? "pending";
            return (
              <li key={step} className="flex min-w-32 flex-col gap-1.5">
                <StepMark state={state} index={i} />
                <span className="text-xs font-medium">{STEP_LABELS[step]}</span>
                <span className="text-[11px] capitalize text-text-muted">{state}</span>
              </li>
            );
          })}
        </ol>

        <div className="w-96 shrink-0 overflow-y-auto border-l border-line-subtle p-3 font-mono text-[11px]">
          {logs.length === 0 ? (
            <p className="text-text-faint">Waiting for a generation run.</p>
          ) : (
            logs.map((l, i) => (
              <p key={i} className="flex gap-2">
                <span className="text-text-faint">{l.at}</span>
                <span className="text-text-secondary">{l.message}</span>
              </p>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
