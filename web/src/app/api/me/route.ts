/** Identity and feature discovery; no database is opened in anonymous mode. */
import { currentUser, cloudEnabled, providers } from "@/lib/server/session";
import { errorResponse } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return Response.json({ user: await currentUser(), cloud: cloudEnabled(), providers: providers() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}
