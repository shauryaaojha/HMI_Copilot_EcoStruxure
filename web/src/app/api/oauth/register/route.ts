/**
 * Dynamic client registration (RFC 7591). `application/json`, which is the
 * one content type Claude sends here - the opposite of the token endpoint one
 * directory over, and the reason the two parse their bodies differently
 * (docs/CONNECTOR_SPEC_NOTES.md §3).
 *
 * The rules - what a redirect URI may look like, how many, that there is no
 * client secret - are lib/server/oauth.ts; this is the HTTP shape of them,
 * the same division as /api/signup and lib/server/credentials.ts.
 */
import { oauthFailure, OauthError, PUBLIC_DOCUMENT_HEADERS, registerClient } from "@/lib/server/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    let body: unknown;
    try { body = await request.json(); }
    catch { throw new OauthError("invalid_request", "Expected a JSON registration request"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new OauthError("invalid_request", "Expected a JSON object");
    const registered = await registerClient(body as Record<string, unknown>, request);
    return Response.json(registered, { status: 201, headers: PUBLIC_DOCUMENT_HEADERS });
  } catch (error) { return oauthFailure(error); }
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: PUBLIC_DOCUMENT_HEADERS });
}
