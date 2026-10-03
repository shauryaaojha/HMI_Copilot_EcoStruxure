/**
 * Open an existing .eote, or a .vxdz the reader can model.
 *
 * The bytes are kept by lib/ote/imports.ts - MongoDB when one is configured,
 * the filesystem otherwise - because the export of an opened project starts
 * from the file it came from, not from the skeleton (docs/PLAN_PHASE1.md).
 * The browser gets the modelled project plus a count of what was carried
 * rather than modelled, so the UI can say so.
 *
 * Node runtime: sql.js reads the databases.
 */

import { layoutOf, readProject } from "@/lib/ote/reader";
import { importStore, putImport } from "@/lib/ote/imports";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const fileName = decodeURIComponent(request.headers.get("x-file-name") ?? "project.eote");
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await request.arrayBuffer());
  } catch {
    return Response.json({ error: "expected the .eote bytes as the body" }, { status: 400 });
  }
  if (bytes.length < 22) {
    return Response.json({ error: "that is not a project file" }, { status: 400 });
  }

  // Refuse the older layout by name rather than part way through. Without this
  // a .vxdz at 3.1 to 3.3 fails on "no such table: Variables", which is true
  // and tells the engineer nothing. docs/VXDZ_FINDINGS.md §7.2.
  let layout: Awaited<ReturnType<typeof layoutOf>>;
  try {
    layout = await layoutOf(bytes);
  } catch {
    return Response.json({ error: "that file is not a project archive" }, { status: 400 });
  }
  if (layout === "struct") {
    return Response.json(
      {
        error:
          `${fileName} is an older project layout, which this tool cannot open yet. ` +
          "It keeps its screens as Contents\\panelN.dat rather than one folder per screen, " +
          "and its objects and databases are shaped differently throughout. " +
          "Projects saved by EcoStruxure Operator Terminal Expert 4.4, and .vxdz files at " +
          "application version 3.4.1 or later, open normally.",
        layout,
      },
      { status: 422 },
    );
  }

  try {
    const read = await readProject(bytes, fileName);
    const id = await putImport(bytes, fileName);

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
      layout,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "could not read the file";
    return Response.json({ error: message }, { status: 422 });
  }
}
