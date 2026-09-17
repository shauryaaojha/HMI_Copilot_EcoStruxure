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

import { packageProject, panelOf, type PackageInput } from "@/lib/ote/packager";
import { readProject } from "@/lib/ote/reader";
import { IMPORT_DIR } from "@/lib/ote/imports";

export const runtime = "nodejs";

/** A filename the OS will accept, derived from the project name. */
function safeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : "project";
}

export async function POST(request: Request) {
  let input: PackageInput & { source?: string };
  try {
    input = (await request.json()) as typeof input;
  } catch {
    return Response.json({ error: "expected a JSON project" }, { status: 400 });
  }

  if (!input?.screens?.length) {
    return Response.json({ error: "a project needs at least one screen" }, { status: 400 });
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
      bytes = await packageProject(input, undefined, read.preserved);
      panelLabel = `${read.target.model} ${read.target.width}x${read.target.height}`;
    } else {
      bytes = await packageProject(input);
      const panel = await panelOf();
      if (panel) panelLabel = `${panel.model} ${panel.width}x${panel.height}`;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName(input.name)}.eote"`,
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
