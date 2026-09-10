"use client";

/**
 * The build timeline: what the AI is doing, in engineering language.
 * Reference screens 1, 2, 3, 5, 6. Phase 4 of docs/BUILD_PLAN.md.
 *
 * "Parsed 247 tags -> detected 2 pumps -> bound FT_101_PV" and never "Thinking...".
 * Each step is clickable and highlights what it produced.
 */

import { PIPELINE_STEPS, STEP_LABELS } from "@/types/events";
import { useProject } from "@/store/project";

const DOT: Record<string, string> = {
  done: "bg-brand-500 text-white",
  running: "bg-brand-500/20 text-brand-400 border border-brand-400",
  failed: "bg-status-alarm text-white",
  pending: "bg-chrome-800 text-ink-700",
};

export function BuildTimeline() {
  const { steps, logs } = useProject();

  return (
    <section className="flex h-44 shrink-0 border-t border-chrome-800 bg-chrome-950">
      <div className="min-w-0 flex-1 overflow-x-auto p-4">
        <h2 className="mb-3 text-sm font-semibold">Build Timeline</h2>
        <ol className="flex gap-6">
          {PIPELINE_STEPS.map((step, i) => {
            const state = steps[step] ?? "pending";
            return (
              <li key={step} className="flex min-w-32 flex-col gap-1.5">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${DOT[state]}`}
                >
                  {i + 1}
                </span>
                <span className="text-xs font-medium">{STEP_LABELS[step]}</span>
                <span className="text-[11px] capitalize text-ink-500">{state}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="w-96 shrink-0 overflow-y-auto border-l border-chrome-800 p-3 font-mono text-[11px]">
        {logs.length === 0 ? (
          <p className="text-ink-700">Waiting for a generation run.</p>
        ) : (
          logs.map((l, i) => (
            <p key={i} className="flex gap-2">
              <span className="text-ink-700">{l.at}</span>
              <span className="text-ink-300">{l.message}</span>
            </p>
          ))
        )}
      </div>
    </section>
  );
}
