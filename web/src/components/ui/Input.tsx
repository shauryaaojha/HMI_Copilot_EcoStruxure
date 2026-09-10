"use client";

/** Single-line and multi-line text entry. Reference screens 1, 2, 5, 6. */

import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "./cn";

const SHARED =
  "w-full rounded-md border border-line bg-surface-raised text-text-primary " +
  "placeholder:text-text-faint transition focus:border-brand-500 focus:outline-none " +
  "disabled:opacity-50";

export interface InputProps extends ComponentPropsWithRef<"input"> {
  /** Rendered inside the field on the trailing edge - a clear button, a unit. */
  adornment?: ReactNode;
  mono?: boolean;
}

export function Input({ adornment, mono, className, ...rest }: InputProps) {
  const field = (
    <input
      className={cn(SHARED, "h-8 px-2.5 text-sm", mono && "font-mono text-xs", className)}
      {...rest}
    />
  );

  if (!adornment) return field;

  return (
    <div className="relative flex items-center">
      {field}
      <span className="absolute right-1.5 flex items-center text-text-muted">
        {adornment}
      </span>
    </div>
  );
}

export interface TextareaProps extends ComponentPropsWithRef<"textarea"> {
  /** Shown bottom-right as "132/500" when a maxLength is set. */
  showCount?: boolean;
}

export function Textarea({
  showCount,
  className,
  value,
  maxLength,
  ...rest
}: TextareaProps) {
  const used = typeof value === "string" ? value.length : 0;

  return (
    <div className="relative">
      <textarea
        value={value}
        maxLength={maxLength}
        className={cn(SHARED, "resize-none p-3 text-sm leading-relaxed", className)}
        {...rest}
      />
      {showCount && maxLength !== undefined && (
        <span className="pointer-events-none absolute bottom-2 right-3 text-[11px] tabular-nums text-text-faint">
          {used}/{maxLength}
        </span>
      )}
    </div>
  );
}
