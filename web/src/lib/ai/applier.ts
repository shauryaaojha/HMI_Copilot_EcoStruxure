/**
 * Moved to `@/core/ops`.
 *
 * `applyOps` is the single write path and lives in the write-path module now
 * (docs/PLAN_FULL_ARCHITECTURE.md §2.1). This file re-exports it so the
 * importers that predate the move keep working; there is one implementation,
 * not two. New code should import from `@/core/ops`.
 */

export * from "@/core/ops/apply";
