"use client";

/**
 * Underlined tabs, as on the canvas (Design / Binding Map / Script / …) and the
 * inspector (Properties / Tags / Library).
 *
 * Controlled only - the active tab usually belongs to a store or a route, and a
 * component that owns its own selection cannot participate in either.
 */

import type { ReactNode } from "react";
import { cn } from "./cn";

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  icon?: ReactNode;
  /** Rendered as a trailing count chip, e.g. Tags (1). */
  count?: number;
  disabled?: boolean;
}

export interface TabsProps<T extends string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** `line` underlines the active tab; `pill` fills it. */
  variant?: "line" | "pill";
  /**
   * `sm` for a rail too narrow for the full-size row. The inspector needs it:
   * Properties, Layers, Library and Tags want 353px and the pane gives 271,
   * which clipped the Tags tab off its right edge entirely.
   */
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  variant = "line",
  size = "md",
  className,
  "aria-label": ariaLabel,
}: TabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      // Scrolls rather than clips, so a long label or a fifth tab degrades
      // into something reachable instead of something invisible.
      // A wheel mouse sends only deltaY, and this row scrolls sideways.
      onWheel={(e) => {
        if (e.deltaY !== 0 && e.deltaX === 0) e.currentTarget.scrollLeft += e.deltaY;
      }}
      className={cn(
        "no-scrollbar flex min-w-0 items-stretch overflow-x-auto",
        size === "sm" ? "gap-0.5" : "gap-1",
        // A pill row is a segmented control: the tabs sit in a sunk track and the active one is a raised chip.
        variant === "pill" && "rounded-lg border border-line-subtle bg-surface-raised p-0.5",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={active}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            className={cn(
              "focus-ring inline-flex shrink-0 items-center whitespace-nowrap transition",
              size === "sm" ? "gap-1 text-xs" : "gap-1.5 text-sm",
              "disabled:pointer-events-none disabled:opacity-40",
              variant === "line"
                ? cn(
                    // The active tab is said by a short green bar under it and full-strength text,
                    // not by green text: green is for the one thing to press.
                    "tab-line relative py-2",
                    size === "sm" ? "px-1.5" : "px-3",
                    active
                      ? "is-active font-medium text-text-primary"
                      : "text-text-muted hover:text-text-secondary",
                  )
                : cn(
                    "rounded-md",
                    size === "sm" ? "px-2 py-1" : "px-3 py-1",
                    active
                      ? "bg-surface-panel font-medium text-text-primary shadow-[var(--elev-1)]"
                      : "text-text-muted hover:text-text-secondary",
                  ),
            )}
          >
            {item.icon}
            {item.label}
            {item.count !== undefined && (
              <span className="tabular-nums text-text-faint">({item.count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
