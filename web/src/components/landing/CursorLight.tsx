"use client";

/**
 * A soft light following the pointer across the page.
 *
 * Fixed, behind everything, hidden below md - on a touch panel there is no
 * cursor to follow, and a light stuck in one corner reads as a smudge. The
 * gradient itself is `.cursor-light` in globals.css.
 */

import { useCursorLight } from "@/components/ui/interactions";

export function CursorLight() {
  const ref = useCursorLight<HTMLDivElement>();
  return <div ref={ref} aria-hidden className="cursor-light pointer-events-none fixed inset-0 hidden md:block" />;
}
