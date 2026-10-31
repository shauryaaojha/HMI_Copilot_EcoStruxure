/**
 * The token endpoint. Form-encoded, not JSON: a JSON-only parser answers 415
 * and the whole flow fails (docs/CONNECTOR_SPEC_NOTES.md §3), which is the
 * single most expensive mistake available on this path because the error a
 * client reports says nothing about the cause.
 *
 * Both grants live in lib/server/oauth.ts, including the rotation a refresh
 * owes a public client. What this file owns is the body, the error shape -
 * RFC 6749 `{error, error_description}`, not this app's `{error, code}` - and
 * the no-store headers a response carrying a token must have.
 */
import { exchangeToken, oauthFailure, parseTokenBody, PUBLIC_DOCUMENT_HEADERS } from "@/lib/server/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const form = await parseTokenBody(request);
    const tokens = await exchangeToken(form, request);
    return Response.json(tokens, { headers: { ...PUBLIC_DOCUMENT_HEADERS, Pragma: "no-cache" } });
  } catch (error) { return oauthFailure(error); }
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: PUBLIC_DOCUMENT_HEADERS });
}
