/**
 * Open an existing .eote, or a .vxdz the reader can model.
 *
 * The bytes are kept by lib/ote/imports.ts - MongoDB when one is configured,
 * the filesystem otherwise - because the export of an opened project starts
 * from the file it came from, not from the skeleton (docs/PLAN_PHASE1.md).
 * The browser gets the modelled project plus a count of what was carried
 * rather than modelled, so the UI can say so.
 *
 * Every refusal is an IngestError with a code and a hint (lib/ingest): the
 * file is sniffed and its ZIP directory checked before anything is inflated,
 * so a crafted archive, a Vijeo Designer file or an older .vxdz is refused by
 * name rather than part way through a parse.
 *
 * Opening a project also scans it into the knowledge base (lib/knowledge),
 * which keeps its structure - never its bytes - for retrieval. A scan that
 * fails never fails the open.
 *
 * Node runtime: sql.js reads the databases.
 */

import { readProject } from "@/lib/ote/reader";
import { importStore, putImport } from "@/lib/ote/imports";
import { IngestError, fileNameFrom, ingestResponse } from "@/lib/ingest/errors";
import { readBody } from "@/lib/ingest/body";
import { refuse, sniff } from "@/lib/ingest/sniff";
import { learnFromProject } from "@/lib/knowledge/learn";
import { inventoryVdz } from "@/lib/vijeo/vdz";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const fileName = fileNameFrom(request, "project.eote");
  try {
    const bytes = await readBody(request);
    const kind = await sniff(bytes, fileName);
    const refused = refuse(kind, fileName);
    if (refused) {
      // An older .vxdz or a Vijeo backup cannot be opened, but it can still
      // teach: scan it, and tell the engineer what it holds.
      const learned =
        kind.kind === "ote-project" || (kind.kind === "vijeo-designer" && kind.variant === "vdz")
          ? await learnFromProject(bytes, fileName).catch(() => null)
          : null;
      if (kind.kind === "vijeo-designer" && kind.variant === "vdz") {
        const inv = await inventoryVdz(bytes).catch(() => null);
        if (inv) {
          return Response.json(
            {
              ...refused.toJSON(),
              error:
                `${refused.message} It holds ${inv.panels.length} panel${inv.panels.length === 1 ? "" : "s"} referencing ` +
                `${inv.variables.length} variable${inv.variables.length === 1 ? "" : "s"}` +
                (learned ? "; its structure has been added to the knowledge base." : "."),
              inventory: { panels: inv.panels.length, targets: inv.targets, variablesReferenced: inv.variables.length },
              ...(learned ? { knowledge: learned } : {}),
            },
            { status: refused.status },
          );
        }
      }
      throw refused;
    }
    if (kind.kind !== "ote-project") {
      throw new IngestError(
        "unsupported-format",
        kind.kind === "compound-object"
          ? `${fileName} is a compound object (.co), not a project.`
          : kind.kind === "spreadsheet" || kind.kind === "text-table" || kind.kind === "control-expert-xml"
            ? `${fileName} is a tag list, not a project.`
            : `${fileName} is not an Operator Terminal Expert project.`,
        kind.kind === "spreadsheet" || kind.kind === "text-table" || kind.kind === "control-expert-xml"
          ? "Start a new project and import it as tags."
          : "Open a .eote, or a .vxdz saved by version 3.4.1 or later.",
      );
    }

    const read = await readProject(bytes, fileName);
    const id = await putImport(bytes, fileName);
    const learned = await learnFromProject(bytes, fileName).catch(() => null);

    return Response.json({
      source: id,
      /** Where the opened file is kept, so the UI can say how long it lasts. */
      store: importStore(),
      name: read.name,
      target: read.target,
      screens: read.screens,
      foreign: read.foreign,
      variables: read.variables,
      alarms: read.alarms,
      bindings: read.wires.map((w) => ({
        tag: w.tag,
        targetId: w.part.UniqueId,
        targetName: w.part.Name,
        property: w.property,
        ...(w.converter ? { converter: w.converter } : {}),
      })),
      carried: read.carried,
      warnings: read.warnings,
      /** So the UI can say what it opened, and that an export is an .eote. */
      layout: kind.layout,
      product: kind.product,
      ...(learned ? { knowledge: { id: learned.id, isNew: learned.isNew } } : {}),
    });
  } catch (error) {
    return ingestResponse(error, "could not open the project");
  }
}
