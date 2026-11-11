"use client";

/**
 * Small status chip. `tone` maps onto the same status colours the HMI uses, so a
 * warning in the validation list reads the same as a warning on a screen.
 */

import type { ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "brand" | "ok" | "warn" | "alarm" | "info";

const TONE: Record<BadgeTone, string> = {
  neutral: "border-line bg-surface-raised text-text-secondary",
  brand: "border-brand-500/30 bg-brand-500/10 text-brand-400",
  ok: "border-status-ok/30 bg-status-ok/10 text-status-ok",
  warn: "border-status-warn/30 bg-status-warn/10 text-status-warn",
  alarm: "border-status-alarm/30 bg-status-alarm/10 text-status-alarm",
  info: "border-status-info/30 bg-status-info/10 text-status-info",
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
        "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-px text-[11px] font-medium leading-4",
        TONE[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
