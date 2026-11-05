"use client";

/**
 * Label + control, in the inspector's two-column arrangement (label left at a
 * fixed width, control right) or stacked for wider panes.
 *
 * The inspector generates these from the zod schemas in Phase 5, so the label
 * and the hint are data, not markup.
 */

import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
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
  // The label names its control only if the control carries the id it points at.
  const only = Children.count(children) === 1 && isValidElement(children) ? (children as ReactElement<{ id?: string }>) : null;
  const control = only && !htmlFor && only.props.id === undefined ? cloneElement(only, { id }) : children;

  return (
    <div
      className={cn(
        layout === "row"
          ? "grid grid-cols-[minmax(0,4.5rem)_minmax(0,1fr)] items-center gap-2"
          : "space-y-1.5",
        className,
      )}
    >
      <label
        htmlFor={id}
        className={cn(
          "text-text-muted",
          layout === "row" ? "min-w-0 truncate text-xs" : "block text-sm font-medium",
        )}
      >
        {label}
      </label>
      <div className="min-w-0">
        {control}
        {error ? (
          <p className="mt-1 text-[11px] text-status-alarm">{error}</p>
        ) : (
          hint && <p className="mt-1 text-[11px] text-text-faint">{hint}</p>
        )}
      </div>
    </div>
  );
}
