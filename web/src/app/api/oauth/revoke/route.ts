/**
 * Token revocation (RFC 7009), so a client that is being removed can hand its
 * tokens back rather than leaving them live until they expire.
 *
 * Advertised in the authorization server metadata, so it has to exist: a
 * `revocation_endpoint` that answered 404 would be worse than none at all.
 * An unknown token still answers 200, which the RFC requires and which also
 * keeps this from being a way to ask whether a guessed token is real.
 */
import { oauthFailure, parseTokenBody, PUBLIC_DOCUMENT_HEADERS, revokeToken } from "@/lib/server/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const form = await parseTokenBody(request);
    const presented = form.get("token");
    if (presented) await revokeToken(presented);
    return new Response(null, { status: 200, headers: PUBLIC_DOCUMENT_HEADERS });
  } catch (error) { return oauthFailure(error); }
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: PUBLIC_DOCUMENT_HEADERS });
}
