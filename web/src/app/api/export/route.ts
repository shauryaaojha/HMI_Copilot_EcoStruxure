/**
 * Project -> .eote download.
 *
 * Must be the Node runtime, not Edge: sql.js is WebAssembly and needs a real
 * filesystem for its .wasm. There is no native module, so this still deploys
 * anywhere Node runs, serverless included.
 *
 * Phase 7 of docs/BUILD_PLAN.md - the moment the whole pitch rests on.
 */

import { packageProject, panelOf, type PackageInput } from "@/lib/ote/packager";

export const runtime = "nodejs";

/** A filename the OS will accept, derived from the project name. */
function safeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : "project";
}

export async function POST(request: Request) {
  let input: PackageInput;
  try {
    input = (await request.json()) as PackageInput;
  } catch {
    return Response.json({ error: "expected a JSON project" }, { status: 400 });
  }

  if (!input?.screens?.length) {
    return Response.json({ error: "a project needs at least one screen" }, { status: 400 });
  }

  try {
    const bytes = await packageProject(input);

    // The panel the file is actually for, so the UI can show the truth rather
    // than a label typed into a component. Target.dat is the authority.
    const panel = await panelOf();
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName(input.name)}.eote"`,
      "Content-Length": String(bytes.length),
    };
    if (panel) {
      headers["X-OTE-Panel"] = `${panel.model} ${panel.width}x${panel.height}`;
    }
    return new Response(bytes as unknown as BodyInit, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "export failed";
    // A missing skeleton is a setup problem, not a bad request.
    const status = message.includes("setup:skeleton") ? 503 : 500;
    return Response.json({ error: message }, { status });
  }
}
