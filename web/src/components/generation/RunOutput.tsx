"use client";

/**
 * What the run produced, in the order it produced it.
 *
 * This is the "output" half of the intent pane: you describe what you need at
 * the top, and the answer arrives underneath, in the same column. It used to
 * sit beside the step strip in the bottom dock, which put the question and its
 * answer at opposite ends of the screen.
 *
 * Every line is computed from what actually happened - "Parsed 7 tags",
 * "Bound 6 display properties" - never "Thinking...". That register is the
 * product.
 *
 * Phase 4 of docs/BUILD_PLAN.md.
 */

import { useEffect, useRef } from "react";
import { useProject } from "@/store/project";
import { cn } from "@/components/ui";

export function RunOutput({ className }: { className?: string }) {
  const logs = useProject((s) => s.logs);
  const generating = useProject((s) => s.generating);
  const pane = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  /**
   * Follow the tail, but stop following the moment the engineer scrolls up -
   * yanking them back to the bottom mid-read is the classic log-pane sin.
   */
  useEffect(() => {
    const el = pane.current;
    if (!el || !pinned.current) return;
    el.scrollTop = el.scrollHeight;
  }, [logs.length, generating]);

  function onScroll() {
    const el = pane.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }

  return (
    <div
      ref={pane}
      onScroll={onScroll}
      className={cn("min-h-0 flex-1 overflow-y-auto px-3 pb-3", className)}
      aria-live="polite"
      aria-label="Generation output"
    >
      {logs.length === 0 ? (
        <p className="pt-1 text-xs leading-relaxed text-text-faint">
          Nothing has run yet. Describe what you need above and the steps will
          appear here as they finish.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {logs.map((l, i) => (
            <li key={i} className="flex gap-2 font-mono text-[11px] leading-relaxed">
              <span className="shrink-0 tabular-nums text-text-faint">{l.at}</span>
              <span className="min-w-0 break-words text-text-secondary">{l.message}</span>
            </li>
          ))}
          {generating && (
            <li className="flex gap-2 font-mono text-[11px] text-text-faint">
              <span className="shrink-0 tabular-nums">…</span>
              <span className="animate-pulse">working</span>
            </li>
          )}
        </ol>
      )}
    </div>
  );
}
