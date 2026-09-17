"use client";

/**
 * The applier moved to lib/ai/applier.ts so it can run on a scratch store
 * (docs/LLD.md F7). This path stays so existing imports keep working.
 */
export { applyOps, dryRun, commit, type OpOutcome } from "@/lib/ai/applier";
