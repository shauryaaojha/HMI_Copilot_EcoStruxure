/**
 * RFC 9728 protected resource metadata, served at
 * /.well-known/oauth-protected-resource through the rewrite in
 * next.config.ts - which is also what makes the path-suffixed form the RFC
 * derives (`/.well-known/oauth-protected-resource/api/mcp`) answer the same
 * document, so a client following either convention finds it.
 *
 * This is the document the 401 on /api/mcp points at, and the first thing
 * Claude reads. Everything in it comes from the request's own host, because
 * `resource` has to equal the URL the user typed in and this app answers on
 * more than one (docs/CONNECTOR_SPEC_NOTES.md §3).
 */
import { oauthFailure, protectedResourceMetadata, PUBLIC_DOCUMENT_HEADERS } from "@/lib/server/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try { return Response.json(protectedResourceMetadata(request), { headers: PUBLIC_DOCUMENT_HEADERS }); }
  catch (error) { return oauthFailure(error); }
}

/** A browser-based client preflights the fetch before it reads the document. */
export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: PUBLIC_DOCUMENT_HEADERS });
}
