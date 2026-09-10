"use client";

/**
 * A titled region with an optional collapse chevron - the numbered sections in
 * the intent pane ("1. Describe what you need"), the inspector's property
 * groups, and the build timeline dock all use it.
 *
 * Collapse is uncontrolled by default and controllable when a parent needs to
 * persist the state.
 */

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "./cn";

export interface PanelProps {
  title?: ReactNode;
  /** Rendered left of the title - an icon or a step number. */
  leading?: ReactNode;
  /** Rendered at the trailing edge of the header - actions, counts, toggles. */
  actions?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Supply with `onOpenChange` to control collapse from outside. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Drops the padding on the body, for tables and lists that want the edges. */
  flush?: boolean;
  bordered?: boolean;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}

export function Panel({
  title,
  leading,
  actions,
  collapsible = false,
  defaultOpen = true,
  open,
  onOpenChange,
  flush = false,
  bordered = false,
  className,
  bodyClassName,
  children,
}: PanelProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const isOpen = open ?? uncontrolled;

  function toggle() {
    const next = !isOpen;
    if (open === undefined) setUncontrolled(next);
    onOpenChange?.(next);
  }

  const header = title !== undefined && (
    <div className="flex h-10 shrink-0 items-center gap-2 px-3">
      {leading}
      {collapsible ? (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          className="focus-ring -mx-1 flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 text-left"
        >
          <span className="truncate text-sm font-semibold text-text-primary">
            {title}
          </span>
          <ChevronDown
            size={14}
            aria-hidden
            className={cn(
              "shrink-0 text-text-muted transition-transform",
              !isOpen && "-rotate-90",
            )}
          />
        </button>
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
          {title}
        </span>
      )}
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );

  return (
    <section
      className={cn(
        "flex min-h-0 flex-col",
        bordered && "rounded-panel border border-line-subtle bg-surface-panel",
        className,
      )}
    >
      {header}
      {isOpen && (
        <div className={cn("min-h-0", !flush && "px-3 pb-3", bodyClassName)}>
          {children}
        </div>
      )}
    </section>
  );
}
