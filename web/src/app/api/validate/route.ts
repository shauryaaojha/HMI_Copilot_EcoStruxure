/**
 * Design-time validation. Phase 6 of docs/BUILD_PLAN.md.
 *
 * Naming conventions, binding integrity, completeness, standards conformance -
 * each finding clickable back to the object that caused it.
 */

export const runtime = "nodejs";

export async function POST(_request: Request) {
  // TODO Phase 6: run lib/validation/rules.ts over the project tree.
  return Response.json({ error: "not implemented - Phase 6" }, { status: 501 });
}
