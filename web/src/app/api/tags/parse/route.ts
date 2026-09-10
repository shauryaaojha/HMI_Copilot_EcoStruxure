/**
 * PLC tag export -> normalised variables.
 *
 * Accepts OTE variable exports (.csv / .txt, UTF-8 without BOM), Machine Expert
 * symbol files and generic tag lists, normalising to the IEC types OTE supports.
 * Phase 3 of docs/BUILD_PLAN.md.
 */

export const runtime = "nodejs";

export async function POST(_request: Request) {
  // TODO Phase 3: SheetJS parse -> Variable[], with the naming rules from
  // lib/validation/rules.ts applied and auto-corrections reported, not silent.
  return Response.json({ error: "not implemented - Phase 3" }, { status: 501 });
}
