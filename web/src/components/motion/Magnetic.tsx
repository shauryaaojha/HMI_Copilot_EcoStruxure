"use client";

/**
 * A block that leans toward the cursor, for a server-rendered page that cannot
 * attach pointer handlers itself. The handlers and the rules live in
 * motion/useMagnetic.ts.
 */

import type { ReactNode } from "react";
import { cn } from "@/components/ui";
import { magnetic } from "./useMagnetic";

export function Magnetic({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div {...magnetic} className={cn("magnetic", className)}>
      {children}
    </div>
  );
}
