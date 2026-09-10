/**
 * Project -> .eote download.
 *
 * Must be the Node runtime, not Edge: sql.js is WebAssembly and needs a real
 * filesystem for its .wasm. There is no native module, so this still deploys
 * anywhere Node runs, serverless included.
 *
 * Phase 7 of docs/BUILD_PLAN.md - the moment the whole pitch rests on.
 */

import { packageProject, type PackageInput } from "@/lib/ote/packager";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const input = (await request.json()) as PackageInput;

  try {
    const bytes = await packageProject(input);
    return new Response(bytes as BodyInit, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${input.name}.eote"`,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "export failed" },
      { status: 501 },
    );
  }
}
