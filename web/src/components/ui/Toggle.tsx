"use client";

/**
 * The green switch from the renders - Auto-run, Auto-scroll, Visible, Show Unit.
 * A checkbox underneath, so it is keyboard and screen-reader native.
 */

import { cn } from "./cn";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  /** Hides the label visually but keeps it as the accessible name. */
  labelHidden?: boolean;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
}

export function Toggle({
  checked,
  onChange,
  label,
  labelHidden = false,
  disabled = false,
  size = "md",
  className,
}: ToggleProps) {
  const track = size === "sm" ? "h-4 w-7" : "h-5 w-9";
  const knob = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  const travel = size === "sm" ? "translate-x-3" : "translate-x-4";

  return (
    <label
      className={cn(
        "inline-flex items-center gap-2",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className,
      )}
    >
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        aria-label={labelHidden ? label : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className={cn(
          "relative shrink-0 rounded-full transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-brand-400",
          track,
          checked ? "bg-brand-500" : "bg-surface-active",
        )}
      >
        <span
          className={cn(
            "absolute left-0.5 top-1/2 -translate-y-1/2 rounded-full bg-white shadow transition-transform",
            knob,
            checked && travel,
          )}
        />
      </span>
      {label && !labelHidden && (
        <span className="text-sm text-text-secondary">{label}</span>
      )}
    </label>
  );
}
