/**
 * RFC 8414 authorization server metadata, served at
 * /.well-known/oauth-authorization-server through the rewrite in
 * next.config.ts.
 *
 * `issuer` is the request's own origin, which is what a client checks against
 * the URL it fetched this from; a configured constant would fail that check
 * on every Vercel preview hostname.
 */
import { authorizationServerMetadata, oauthFailure, PUBLIC_DOCUMENT_HEADERS } from "@/lib/server/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try { return Response.json(authorizationServerMetadata(request), { headers: PUBLIC_DOCUMENT_HEADERS }); }
  catch (error) { return oauthFailure(error); }
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: PUBLIC_DOCUMENT_HEADERS });
}
