"use client";

/**
 * Small status chip. `tone` maps onto the same status colours the HMI uses, so a
 * warning in the validation list reads the same as a warning on a screen.
 */

import type { ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "brand" | "ok" | "warn" | "alarm" | "info";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-surface-active text-text-secondary",
  brand: "bg-brand-500/15 text-brand-400",
  ok: "bg-status-ok/15 text-status-ok",
  warn: "bg-status-warn/15 text-status-warn",
  alarm: "bg-status-alarm/15 text-status-alarm",
  info: "bg-status-info/15 text-status-info",
};

export interface BadgeProps {
  tone?: BadgeTone;
  /** Prefix the label with a filled dot, as the alarm rows do. */
  dot?: boolean;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = "neutral", dot, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
        TONE[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
