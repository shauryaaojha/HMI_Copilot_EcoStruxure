/**
 * Read another project's screens, to lift some of them into this one.
 *
 * Unlike /api/import this keeps nothing: the bytes are read, modelled and
 * forgotten, because the screens are going to live in a project that already
 * has a source of its own (or none). What the reader could not model on those
 * screens is counted per screen so the picker can say what will not come.
 *
 * Node runtime: sql.js reads the databases. docs/PLAN_PHASE2.md item 2.
 */

import { readProject } from "@/lib/ote/reader";

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
    return Response.json({ error: "that is not a .eote file" }, { status: 400 });
  }

  try {
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
      })),
      warnings: read.warnings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "could not read the file";
    return Response.json({ error: message }, { status: 422 });
  }
}
