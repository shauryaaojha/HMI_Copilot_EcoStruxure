/**
 * Plan a migration from a Vijeo Designer backup (lib/vijeo/migrate.ts).
 *
 *   POST multipart/form-data
 *     vdz        the project backup (File > Backup project)        required
 *     variables  the Vijeo variable export (.csv), for real types   optional
 *     width, height  the OTE panel the screens are designed for     optional
 *
 * Answers with the tags, their structure, one screen program per Vijeo base
 * panel, and a report of everything that did not carry. Nothing is generated
 * here: the client hands the programs to /api/generate, so the build runs on
 * the timeline the engineer already knows, and can be reviewed before export.
 *
 * Node runtime: the compound file and the tag export are read server-side.
 */

import { IngestError, ingestResponse } from "@/lib/ingest/errors";
import { sniff } from "@/lib/ingest/sniff";
import { DEFAULT_LIMITS } from "@/lib/ingest/zip";
import { inventoryVdz } from "@/lib/vijeo/vdz";
import { planMigration } from "@/lib/vijeo/migrate";
import { parseTagsFile } from "@/lib/tags/parse";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const form = await request.formData().catch(() => null);
    const vdz = form?.get("vdz");
    if (!(vdz instanceof File)) throw new IngestError("empty", "No Vijeo Designer backup (.vdz) was sent.", "Make one in Vijeo Designer with File > Backup project.");
    if (vdz.size > DEFAULT_LIMITS.maxBytes) throw new IngestError("too-large", `${vdz.name} is over the ${DEFAULT_LIMITS.maxBytes / 1048576} MB limit.`);
    const bytes = new Uint8Array(await vdz.arrayBuffer());
    const kind = await sniff(bytes, vdz.name);
    if (kind.kind !== "vijeo-designer" || kind.variant !== "vdz") {
      throw new IngestError("unsupported-format", `${vdz.name} is not a Vijeo Designer backup.`, "A backup is a .vdz made with File > Backup project.");
    }
    const inventory = await inventoryVdz(bytes);

    const csv = form?.get("variables");
    let exported: Parameters<typeof planMigration>[2];
    if (csv instanceof File && csv.size > 0) {
      const parsed = await parseTagsFile(new Uint8Array(await csv.arrayBuffer()), csv.name);
      exported = { variables: parsed.variables, structure: parsed.structure, corrections: parsed.corrections };
    }
    const width = Number(form?.get("width")) || 1024;
    const height = Number(form?.get("height")) || 768;
    const plan = planMigration(inventory, { width, height }, exported);
    return Response.json({
      ...plan,
      source: { container: inventory.container, panels: inventory.panels.length, targets: inventory.targets, withVariableExport: !!exported },
    });
  } catch (error) {
    return ingestResponse(error, "could not plan the migration");
  }
}
