"use client";

/**
 * The one button. Variants are taken off the reference renders: green primary
 * (Generate Screen, Export), outlined secondary (Preview Tags, Alarm History),
 * bare ghost for toolbar icons, red danger for destructive actions.
 *
 * Phase 0 of docs/BUILD_PLAN.md.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  // A lit top edge and a deeper bottom one, so the one green thing on a pane
  // reads as a control you press rather than a label you read.
  primary:
    "btn-primary text-text-onbrand hover:brightness-110 active:brightness-95",
  secondary:
    "border border-line bg-surface-raised text-text-secondary shadow-[var(--elev-1)] hover:border-line-strong hover:bg-surface-hover hover:text-text-primary",
  ghost: "text-text-muted hover:bg-surface-hover hover:text-text-primary",
  danger: "bg-status-alarm text-white shadow-[var(--elev-1)] hover:brightness-110 active:brightness-95",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-7 gap-1.5 px-2.5 text-xs",
  md: "h-9 gap-2 px-3.5 text-sm",
  lg: "h-11 gap-2 px-5 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Rendered before the label. Pass a lucide icon at size 16. */
  icon?: ReactNode;
  /** Square, label-free. `children` becomes the accessible name via aria-label. */
  iconOnly?: boolean;
  block?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconOnly = false,
  block = false,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "focus-ring press inline-flex shrink-0 items-center justify-center rounded-lg font-medium",
        "disabled:pointer-events-none disabled:opacity-40",
        VARIANT[variant],
        SIZE[size],
        iconOnly && "aspect-square px-0",
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {icon}
      {!iconOnly && children}
    </button>
  );
}
