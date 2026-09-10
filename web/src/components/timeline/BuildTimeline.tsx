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
 * The step strip is where the run is; the log beside it is what it said. They
 * were split across two panes while the left pane was a prompt box, and came
 * back together when that pane became the conversation - a turn's own summary
 * belongs in the thread, the pipeline's line-by-line output belongs here.
 *
 * The header is h-10, matching the dock's collapsed size in WorkspaceShell, so
 * collapsing the pane leaves the title bar rather than an empty strip.
 */

import { Check, Loader, Radio, X } from "lucide-react";
import { PIPELINE_STEPS, STEP_LABELS, type PipelineStep, type StepState } from "@/types/events";
import { useProject } from "@/store/project";
import { Badge, cn } from "@/components/ui";
import { RunOutput } from "@/components/generation/RunOutput";

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
  const generating = useProject((s) => s.generating);
  const select = useProject((s) => s.select);

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
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Wraps rather than scrolls. Eight steps at min-w-36 need 1232px and
            the strip gets about 1048px on a 1440px laptop, so the old
            overflow-x-auto hid "Build export files" entirely - a progress
            display that reads "0 of 8" while showing seven. */}
        <ol className="grid min-w-0 flex-1 grid-cols-4 content-start gap-2 overflow-y-auto p-3">
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
                    // The four-column grid on the <ol> sizes these, which is
                    // why there is no width here: a flex row wrapping on an
                    // arbitrary calc() width put six on the first line and two
                    // on the second, and grid tracks subtract the gaps for you.
                    "focus-ring flex w-full min-w-0 flex-col items-start gap-1 rounded-md p-2 text-left transition",
                    clickable
                      ? "cursor-pointer hover:bg-surface-hover"
                      : "cursor-default",
                  )}
                >
                  {/* The mark beside the label rather than above it. Stacked,
                      a card was 85px and two rows did not fit the dock's 156px
                      of strip - which is what made wrapping hide step 8 down
                      instead of across. Inline, a card is around 58px. */}
                  <span className="flex w-full items-center gap-1.5">
                    <StepMark state={state} index={i} />
                    <span className="min-w-0 flex-1 text-xs font-medium leading-tight">
                      {STEP_LABELS[step]}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "w-full pl-[1.875rem] text-[11px] leading-tight",
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

        {/* The narrative, beside the strip rather than under it: at this dock
            height a stacked log would show two lines. Hidden on narrow panes,
            where the strip alone is the more useful half. */}
        <div className="hidden min-h-0 w-80 shrink-0 flex-col border-l border-line-subtle xl:flex">
          <h3 className="shrink-0 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-text-faint">
            Output
          </h3>
          <RunOutput />
        </div>
      </div>
    </section>
  );
}
