"use client";

/**
 * Label + control, in the inspector's two-column arrangement (label left at a
 * fixed width, control right) or stacked for wider panes.
 *
 * The inspector generates these from the zod schemas in Phase 5, so the label
 * and the hint are data, not markup.
 */

import { useId, type ReactNode } from "react";
import { cn } from "./cn";

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** `row` is the inspector layout; `stack` is the intent pane's. */
  layout?: "row" | "stack";
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

export function Field({
  label,
  hint,
  error,
  layout = "row",
  htmlFor,
  className,
  children,
}: FieldProps) {
  const generated = useId();
  const id = htmlFor ?? generated;

  return (
    <div
      className={cn(
        layout === "row" ? "grid grid-cols-[5.5rem_1fr] items-center gap-3" : "space-y-1.5",
        className,
      )}
    >
      <label
        htmlFor={id}
        className={cn(
          "text-text-muted",
          layout === "row" ? "truncate text-xs" : "block text-sm font-medium",
        )}
      >
        {label}
      </label>
      <div className="min-w-0">
        {children}
        {error ? (
          <p className="mt-1 text-[11px] text-status-alarm">{error}</p>
        ) : (
          hint && <p className="mt-1 text-[11px] text-text-faint">{hint}</p>
        )}
      </div>
    </div>
  );
}
