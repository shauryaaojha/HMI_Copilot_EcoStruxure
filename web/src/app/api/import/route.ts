/**
 * Open an existing .eote or .vxdz. The older .vxdz layout is converted.
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
import { readStructProject } from "@/lib/ote/struct";

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

  // Which layout decides which reader: the older one (3.1 to 3.3) has no
  // Variables table and would otherwise fail on that, which tells nobody anything.
  let layout: Awaited<ReturnType<typeof layoutOf>>;
  try {
    layout = await layoutOf(bytes);
  } catch {
    return Response.json({ error: "that file is not a project archive" }, { status: 400 });
  }
  if (layout === "struct") {
    // The older layout (3.1 - 3.3) is converted rather than opened in place:
    // lib/ote/struct.ts. Its bytes are not kept, because the export does not
    // write back into a layout this tool does not write; it builds a new 4.4
    // project from what was converted, and the warnings say so.
    try {
      const read = await readStructProject(bytes, fileName);
      return Response.json({
        source: null,
        store: null,
        converted: true,
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
        })),
        carried: read.carried,
        warnings: read.warnings,
        layout,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "could not read the file";
      return Response.json({ error: `${fileName} is in the older project layout and could not be converted: ${message}`, layout }, { status: 422 });
    }
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
