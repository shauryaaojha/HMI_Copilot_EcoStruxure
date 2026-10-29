/**
 * Moved to `@/core/ops`.
 *
 * The op language lives in the write-path module now, beside the only thing
 * that applies it (docs/PLAN_FULL_ARCHITECTURE.md §2.1). This file re-exports
 * it so the importers that predate the move keep working; there is one
 * implementation, not two. New code should import from `@/core/ops`.
 */

export * from "@/core/ops/ops";
