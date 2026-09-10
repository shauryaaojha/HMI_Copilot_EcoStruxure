"use client";

/**
 * The build timeline: what the pipeline is doing, in engineering language.
 * Reference screens 1, 2, 3, 5, 6. Phase 4 of docs/BUILD_PLAN.md.
 *
 * "1,248 tags parsed" and "24/28 bound" and never "Thinking...". Every detail
 * line under a step is computed from what that step actually produced, which
 * is why they are carried on the `step` event rather than written here.
 *
 * Clicking a step selects the objects it produced, so the timeline is a way
 * back into the screen rather than a read-only log.
 *
 * The header is h-10, matching the dock's collapsed size in WorkspaceShell, so
 * collapsing the pane leaves the title bar rather than an empty strip.
 */

import { useEffect, useRef, useState } from "react";
import { Check, Loader, Radio, X } from "lucide-react";
import { PIPELINE_STEPS, STEP_LABELS, type PipelineStep, type StepState } from "@/types/events";
import { useProject } from "@/store/project";
import { Badge, Toggle, cn } from "@/components/ui";

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
  const stepDetail = useProject((s) => s.stepDetail);
  const produced = useProject((s) => s.produced);
  const logs = useProject((s) => s.logs);
  const generating = useProject((s) => s.generating);
  const select = useProject((s) => s.select);

  const [autoScroll, setAutoScroll] = useState(true);
  const logPane = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && logPane.current) {
      logPane.current.scrollTop = logPane.current.scrollHeight;
    }
  }, [logs.length, autoScroll]);

  const done = PIPELINE_STEPS.filter((s) => steps[s] === "done").length;

  function showWhatItProduced(step: PipelineStep) {
    const ids = produced[step];
    if (ids && ids.length > 0) select(ids);
  }

  return (
    <section className="flex h-full w-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-line-subtle px-4">
        <Radio
          size={14}
          aria-hidden
          className={cn("shrink-0 text-brand-400", generating && "animate-pulse")}
        />
        <h2 className="shrink-0 text-sm font-semibold">Build Timeline</h2>
        <Badge tone={done === PIPELINE_STEPS.length ? "ok" : generating ? "brand" : "neutral"}>
          {generating
            ? "running"
            : `${done} of ${PIPELINE_STEPS.length} steps completed`}
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
        <ol className="flex min-w-0 flex-1 gap-2 overflow-x-auto p-3">
          {PIPELINE_STEPS.map((step, i) => {
            const state = steps[step] ?? "pending";
            const count = produced[step]?.length ?? 0;
            const clickable = count > 0;
            return (
              <li key={step}>
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => showWhatItProduced(step)}
                  title={
                    clickable
                      ? `Select the ${count} object${count === 1 ? "" : "s"} this step produced`
                      : undefined
                  }
                  className={cn(
                    "focus-ring flex min-w-36 flex-col items-start gap-1.5 rounded-md p-2 text-left transition",
                    clickable
                      ? "cursor-pointer hover:bg-surface-hover"
                      : "cursor-default",
                  )}
                >
                  <StepMark state={state} index={i} />
                  <span className="text-xs font-medium">{STEP_LABELS[step]}</span>
                  <span
                    className={cn(
                      "text-[11px]",
                      state === "done" ? "text-brand-400" : "text-text-muted",
                    )}
                  >
                    {stepDetail[step] ?? (state === "pending" ? "Pending" : state)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <div
          ref={logPane}
          className="w-[26rem] shrink-0 overflow-y-auto border-l border-line-subtle p-3 font-mono text-[11px]"
        >
          {logs.length === 0 ? (
            <p className="text-text-faint">
              Waiting for a generation run. Describe what you need on the left.
            </p>
          ) : (
            logs.map((l, i) => (
              <p key={i} className="flex gap-2 py-px">
                <span className="shrink-0 text-text-faint">{l.at}</span>
                <span className="min-w-0 text-text-secondary">{l.message}</span>
              </p>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
