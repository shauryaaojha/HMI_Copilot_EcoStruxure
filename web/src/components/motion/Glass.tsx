"use client";

/**
 * A pane of liquid glass: the page behind it blurred and saturated, a lit top
 * edge, and a soft highlight that follows the pointer across the pane.
 *
 * `orbs` puts slow green blobs inside the pane, clipped to its corners, because glass over a flat
 * ground has nothing to bend and reads as a grey box. The look itself is
 * `.glass` and `.glass-orbs` in globals.css; reduced motion stops the blobs.
 */

import { useRef, type ReactNode, type PointerEvent } from "react";
import { cn } from "@/components/ui";

export function Glass({ className, children, orbs = false }: { className?: string; children: ReactNode; orbs?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  function move(e: PointerEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--gx", `${e.clientX - r.left}px`);
    el.style.setProperty("--gy", `${e.clientY - r.top}px`);
  }
  return (
    <div ref={ref} onPointerMove={move} className={cn("glass", className)}>
      {orbs && (
        <div aria-hidden className="glass-orbs">
          <span />
          <span />
          <span />
        </div>
      )}
      {children}
    </div>
  );
}
