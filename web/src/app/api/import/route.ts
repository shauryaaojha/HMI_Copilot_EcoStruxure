/**
 * Open an existing .eote.
 *
 * The bytes are kept on disk under .imports/<id>.eote, because the export of
 * an opened project starts from the file it came from, not from the skeleton
 * (docs/PLAN_PHASE1.md). The browser gets the modelled project plus a count
 * of what was carried rather than modelled, so the UI can say so.
 *
 * Node runtime: sql.js reads the databases.
 */

import { readProject } from "@/lib/ote/reader";
import { IMPORT_DIR } from "@/lib/ote/imports";

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
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const id = crypto.randomUUID();
    const dir = path.join(process.cwd(), IMPORT_DIR);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${id}.eote`), bytes);

    return Response.json({
      source: id,
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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "could not read the file";
    return Response.json({ error: message }, { status: 422 });
  }
}
