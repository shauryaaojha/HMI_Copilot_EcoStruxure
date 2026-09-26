/**
 * Project -> .eote download.
 *
 * Must be the Node runtime, not Edge: sql.js is WebAssembly and needs a real
 * filesystem for its .wasm. There is no native module, so this still deploys
 * anywhere Node runs, serverless included.
 *
 * A project that was opened from a file (`source` set) is written back into
 * that file's own entries, so everything the reader did not model comes back
 * byte-identical. A project built from nothing starts from the skeleton.
 *
 * Phase 7 of docs/BUILD_PLAN.md - the moment the whole pitch rests on.
 */

import { panelOf, type PackageInput } from "@/lib/ote/packager";
import { backendFor, unsupportedParts, type FormatId } from "@/lib/backend";
import { readProject } from "@/lib/ote/reader";
import { IMPORT_DIR } from "@/lib/ote/imports";

export const runtime = "nodejs";

/** A filename the OS will accept, derived from the project name. */
function safeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : "project";
}

export async function POST(request: Request) {
  let input: PackageInput & { source?: string; format?: FormatId };
  try {
    input = (await request.json()) as typeof input;
  } catch {
    return Response.json({ error: "expected a JSON project" }, { status: 400 });
  }

  if (!input?.screens?.length) {
    return Response.json({ error: "a project needs at least one screen" }, { status: 400 });
  }

  // The format is asked for rather than assumed: the writer is one
  // implementation of a seam now, and a target that cannot hold what the screen
  // contains has to say so before it writes rather than after.
  let backend;
  try {
    backend = backendFor(input.format);
  } catch {
    return Response.json({ error: `unknown format "${input.format}"` }, { status: 400 });
  }
  if (backend.unavailable) {
    return Response.json({ error: backend.unavailable, format: backend.id }, { status: 501 });
  }
  const missing = unsupportedParts(input.screens, backend);
  if (missing.length > 0) {
    const kinds = [...new Set(missing.map((m) => m.type))];
    return Response.json(
      {
        error: `${backend.name} cannot write ${kinds.join(", ")}: ${missing.length} object${missing.length === 1 ? "" : "s"} would be lost.`,
        objects: missing.slice(0, 20),
      },
      { status: 409 },
    );
  }

  try {
    let bytes: Uint8Array;
    let panelLabel: string | null = null;

    if (input.source && /^[0-9a-f-]{36}$/i.test(input.source)) {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const original = await fs.readFile(path.join(process.cwd(), IMPORT_DIR, `${input.source}.eote`)).catch(() => null);
      if (!original) {
        return Response.json(
          { error: "The file this project was opened from is no longer on this machine. Open it again to export into it." },
          { status: 409 },
        );
      }
      const read = await readProject(new Uint8Array(original));
      bytes = await backend.write(input, read.preserved);
      panelLabel = `${read.target.model} ${read.target.width}x${read.target.height}`;
    } else {
      bytes = await backend.write(input);
      const panel = await panelOf();
      if (panel) panelLabel = `${panel.model} ${panel.width}x${panel.height}`;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName(input.name)}${backend.extension}"`,
      "Content-Length": String(bytes.length),
    };
    if (panelLabel) headers["X-OTE-Panel"] = panelLabel;
    return new Response(bytes as unknown as BodyInit, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "export failed";
    // A missing skeleton is a setup problem, not a bad request.
    const status = message.includes("setup:skeleton") ? 503 : 500;
    return Response.json({ error: message }, { status });
  }
}
