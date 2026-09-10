"use client";

/**
 * A native select wearing the chrome's clothes. Native rather than a custom
 * listbox because keyboard and screen-reader behaviour comes free, and the
 * renders show nothing a native control cannot do.
 */

import type { ComponentPropsWithRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "./cn";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<ComponentPropsWithRef<"select">, "size"> {
  options: SelectOption[];
  size?: "sm" | "md";
}

export function Select({ options, size = "md", className, ...rest }: SelectProps) {
  return (
    <div className="relative inline-flex w-full items-center">
      <select
        className={cn(
          "focus-ring w-full appearance-none rounded-md border border-line bg-surface-raised",
          "pr-7 text-text-primary transition focus:border-brand-500 focus:outline-none",
          "disabled:opacity-50",
          size === "sm" ? "h-7 pl-2 text-xs" : "h-8 pl-2.5 text-sm",
          className,
        )}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        aria-hidden
        className="pointer-events-none absolute right-2 text-text-muted"
      />
    </div>
  );
}
