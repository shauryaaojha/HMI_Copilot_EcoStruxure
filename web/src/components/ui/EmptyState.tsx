/**
 * What a panel says when it has nothing in it.
 *
 * A bare sentence in grey is the commonest way a tool wastes a moment where the
 * engineer is already looking. An empty panel is the one time you have their
 * attention with nothing competing for it, so it should answer the question
 * they are about to ask: what goes here, and what do I do to put something in
 * it.
 *
 * Deliberately quiet - an icon at 10% opacity, one line, and the two or three
 * things that actually work. No illustration, no call to action in brand
 * green: this sits beside a canvas an operator's plant depends on.
 */

import type { LucideIcon } from "lucide-react";
import { cn } from "./cn";

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body?: string;
  /** Things that work right now, as "do this" → "and this happens". */
  hints?: { key: string; label: string }[];
  className?: string;
  children?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, body, hints, className, children }: EmptyStateProps) {
  return (
    <div className={cn("flex h-full flex-col items-center justify-center px-6 py-10 text-center", className)}>
      <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-line-subtle bg-surface-raised/50 text-text-faint">
        <Icon size={18} aria-hidden />
      </span>
      <p className="mt-3.5 text-sm font-medium text-text-secondary">{title}</p>
      {body && <p className="mt-1.5 max-w-[26ch] text-xs leading-relaxed text-text-muted">{body}</p>}

      {hints && hints.length > 0 && (
        <dl className="mt-4 w-full max-w-[22rem] space-y-1.5">
          {hints.map(({ key, label }) => (
            <div key={key} className="flex items-baseline gap-2.5 text-left">
              <dt className="shrink-0">
                <kbd className="rounded border border-line-subtle bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                  {key}
                </kbd>
              </dt>
              <dd className="min-w-0 text-[11px] leading-relaxed text-text-faint">{label}</dd>
            </div>
          ))}
        </dl>
      )}

      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
