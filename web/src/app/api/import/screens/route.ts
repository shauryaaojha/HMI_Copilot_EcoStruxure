/**
 * Read another project's screens, to lift some of them into this one.
 *
 * Unlike /api/import this keeps nothing: the bytes are read, modelled and
 * forgotten, because the screens are going to live in a project that already
 * has a source of its own (or none). What the reader could not model on those
 * screens is counted per screen so the picker can say what will not come.
 *
 * Refusals come from lib/ingest, the same as /api/import: the archive is
 * checked before it is inflated, and a file that is not a typed-layout project
 * is refused by name.
 *
 * Node runtime: sql.js reads the databases. docs/PLAN_PHASE2.md item 2.
 */

import { readProject } from "@/lib/ote/reader";
import { IngestError, fileNameFrom, ingestResponse } from "@/lib/ingest/errors";
import { readBody } from "@/lib/ingest/body";
import { refuse, sniff } from "@/lib/ingest/sniff";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const fileName = fileNameFrom(request, "project.eote");
  try {
    const bytes = await readBody(request);
    const kind = await sniff(bytes, fileName);
    const refused = refuse(kind, fileName);
    if (refused) throw refused;
    if (kind.kind !== "ote-project") {
      throw new IngestError("unsupported-format", `${fileName} is not an Operator Terminal Expert project, so it has no screens to take.`);
    }

    const read = await readProject(bytes, fileName);
    return Response.json({
      name: read.name,
      target: read.target,
      screens: read.screens,
      foreign: read.foreign,
      variables: read.variables,
      bindings: read.wires.map((w) => ({
        tag: w.tag,
        targetId: w.part.UniqueId,
        targetName: w.part.Name,
        property: w.property,
        ...(w.converter ? { converter: w.converter } : {}),
      })),
      warnings: read.warnings,
    });
  } catch (error) {
    return ingestResponse(error, "could not read the project");
  }
}
