/**
 * GET /api/export/link?t=<signed token>: the .eote behind a link that
 * `export_project` handed to Claude. See lib/server/export-link.ts.
 */
import { errorResponse } from "@/lib/server/errors";
import { exportBytes, readExportLink } from "@/lib/server/export-link";
import { repo } from "@/lib/server/repo";
import { ServerError } from "@/lib/server/errors";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  try {
    const token = new URL(request.url).searchParams.get("t") ?? "";
    const claims = readExportLink(token);
    const user = await repo().users.get(claims.u);
    if (!user) throw new ServerError(403, "forbidden", "The account this link was made for no longer exists");
    const { bytes, fileName } = await exportBytes(user, claims.p, claims.r);
    return new Response(bytes as BodyInit, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
