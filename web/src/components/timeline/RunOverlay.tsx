"use client";

/**
 * The build timeline, over the canvas instead of under it.
 *
 * It was a docked bottom pane, which is the wrong place for it twice over. The
 * canvas is what the engineer is looking at during a run, so the one thing they
 * want to watch was in their peripheral vision - and the rest of the time, when
 * nothing is running, it was a permanently open pane showing eight grey
 * "Pending" cards taking height from the screen it describes.
 *
 * So it appears when a run starts, floats over the canvas near the work, and
 * collapses to a single line when the run finishes. What it says is unchanged:
 * "1,248 tags parsed", "24 of 28 bound", counted from what each step actually
 * produced, never "Thinking...". Clicking a finished step still selects the
 * objects it made, which is what stops it being a read-only log.
 */

import { useEffect, useState } from "react";
import { Check, ChevronDown, Loader, Radio, X } from "lucide-react";
import {
  PIPELINE_STEPS,
  STEP_LABELS,
  type PipelineStep,
  type StepState,
} from "@/types/events";
import { useProject } from "@/store/project";
import { RunOutput } from "@/components/generation/RunOutput";
import { cn } from "@/components/ui";

/** How long the finished summary stays before it stops asking for attention. */
const SETTLE_MS = 2200;

function StepDot({ state }: { state: StepState }) {
  return (
    <span
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold",
        state === "done" && "border-brand-500 bg-brand-500 text-white",
        state === "running" && "border-brand-400 bg-brand-500/20 text-brand-400",
        state === "failed" && "border-status-alarm bg-status-alarm text-white",
        state === "pending" && "border-line bg-surface-raised text-text-faint",
      )}
    >
      {state === "done" && <Check size={9} strokeWidth={3.5} aria-hidden />}
      {state === "failed" && <X size={9} strokeWidth={3.5} aria-hidden />}
      {state === "running" && (
        <Loader size={9} className="animate-spin" aria-hidden />
      )}
    </span>
  );
}

export function RunOverlay() {
  const steps = useProject((s) => s.steps);
  const stepDetail = useProject((s) => s.stepDetail);
  const produced = useProject((s) => s.produced);
  const generating = useProject((s) => s.generating);
  const logs = useProject((s) => s.logs);
  const select = useProject((s) => s.select);

  const [open, setOpen] = useState(true);
  const [settled, setSettled] = useState(false);

  const done = PIPELINE_STEPS.filter((s) => steps[s] === "done").length;
  const started = done > 0 || generating;
  const complete = done === PIPELINE_STEPS.length && !generating;

  // A run reopens it; finishing lets it settle into the one-line summary.
  useEffect(() => {
    if (generating) {
      setOpen(true);
      setSettled(false);
    }
  }, [generating]);

  useEffect(() => {
    if (!complete) return;
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [complete]);

  // Nothing has run in this project: there is no timeline to show.
  if (!started) return null;

  const last = logs.at(-1)?.message;

  /** Collapsed: one line, out of the way, still a way back in. */
  if (!open || settled) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setSettled(false);
        }}
        className="animate-rise focus-ring pointer-events-auto flex max-w-[min(28rem,calc(100%-2rem))] items-center gap-2 rounded-full border border-line bg-surface-float/95 py-1.5 pl-2.5 pr-3 text-xs backdrop-blur transition hover:border-line-strong"
        style={{ boxShadow: "var(--elev-2)" }}
      >
        <Radio
          size={12}
          aria-hidden
          className={cn("shrink-0 text-brand-400", generating && "animate-breathe")}
        />
        <span className="text-figure shrink-0 font-medium text-text-secondary">
          {done}/{PIPELINE_STEPS.length}
        </span>
        <span className="min-w-0 truncate text-text-muted">
          {generating ? "building…" : (last ?? "build complete")}
        </span>
      </button>
    );
  }

  return (
    <section
      aria-label="Build timeline"
      className="animate-rise pointer-events-auto w-[min(30rem,calc(100%-2rem))] overflow-hidden rounded-xl border border-line bg-surface-float/95 backdrop-blur"
      style={{ boxShadow: "var(--elev-3)" }}
    >
      <header className="flex items-center gap-2 border-b border-line-subtle px-3 py-2">
        <Radio
          size={13}
          aria-hidden
          className={cn("shrink-0 text-brand-400", generating && "animate-breathe")}
        />
        <h2 className="text-xs font-semibold text-text-primary">Build timeline</h2>
        <span
          className={cn(
            "text-figure rounded px-1.5 py-0.5 text-[10px] font-medium",
            complete
              ? "bg-brand-500/15 text-brand-400"
              : "bg-surface-hover text-text-muted",
          )}
        >
          {done} of {PIPELINE_STEPS.length}
        </span>

        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Collapse the build timeline"
          title="Collapse"
          className="focus-ring ml-auto rounded p-1 text-text-faint transition hover:bg-surface-hover hover:text-text-secondary"
        >
          <ChevronDown size={14} aria-hidden />
        </button>
      </header>

      <ol className="max-h-[40vh] overflow-y-auto p-2">
        {PIPELINE_STEPS.map((step) => {
          const state = steps[step] ?? "pending";
          const count = produced[step]?.length ?? 0;
          const clickable = count > 0;
          return (
            <li key={step}>
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && select(produced[step]!)}
                title={
                  clickable
                    ? `Select the ${count} object${count === 1 ? "" : "s"} this step produced`
                    : undefined
                }
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition",
                  clickable ? "hover:bg-surface-hover" : "cursor-default",
                  state === "pending" && "opacity-45",
                )}
              >
                <StepDot state={state} />
                <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
                  {STEP_LABELS[step]}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-[11px]",
                    state === "failed"
                      ? "text-status-alarm"
                      : state === "done"
                        ? "text-brand-400"
                        : "text-text-faint",
                  )}
                >
                  {stepDetail[step] ?? (state === "pending" ? "" : state)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* The narrative, under the step strip. It followed the run in the old
          bottom dock and is the half that says what happened rather than where
          the run is, so it comes along rather than being dropped. */}
      {logs.length > 0 && (
        <div className="flex h-24 flex-col border-t border-line-subtle">
          <RunOutput className="px-3 py-2" />
        </div>
      )}
    </section>
  );
}
