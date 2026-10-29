"use client";

/**
 * The applier lives in `@/core/ops`, so it can run on a scratch store
 * (docs/LLD.md F7) and so there is one write path for chat, the inspector and
 * the MCP server alike. This path stays so existing imports keep working.
 */
export { applyOps, dryRun, commit, type OpOutcome } from "@/core/ops";
