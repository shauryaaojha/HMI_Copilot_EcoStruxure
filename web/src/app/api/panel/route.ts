/**
 * The panel the skeleton is actually for.
 *
 * Target.dat inside the extracted skeleton fixes the model and resolution of
 * every project this installation can produce - the app cannot choose one. The
 * UI asks for it so the label it shows is the file's, not a string typed into a
 * component.
 *
 * Phase 7 of docs/BUILD_PLAN.md.
 */

import { panelOf } from "@/lib/ote/packager";

export const runtime = "nodejs";

/**
 * Read at request time: the skeleton is on the running machine's disk, not the
 * build machine's, and a prerendered answer would bake in whatever the builder
 * happened to have.
 */
export const dynamic = "force-dynamic";


export async function GET() {
  const panel = await panelOf().catch(() => null);

  if (!panel) {
    // No skeleton is a setup state, not an error: the UI keeps its declared
    // target and says the panel is unconfirmed.
    return Response.json(
      { panel: null, reason: "No skeleton extracted. Run `npm run setup:skeleton`." },
      { status: 200 },
    );
  }

  return Response.json({ panel });
}
