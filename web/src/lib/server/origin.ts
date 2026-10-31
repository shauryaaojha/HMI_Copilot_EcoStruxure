/**
 * The URL this deployment answers on, as the caller sees it.
 *
 * Three things have to agree on one answer and would otherwise each guess:
 * the `resource_metadata` pointer on the MCP 401, the `resource` field of the
 * protected-resource document - which "must equal the MCP server URL exactly
 * as the user typed it into Claude, path included"
 * (docs/CONNECTOR_SPEC_NOTES.md §3) - and the `issuer` the authorization
 * server metadata publishes, which a client checks against the URL it fetched
 * the document from. A configured constant would be wrong on two of the three
 * hostnames this app answers on (Vercel previews and the production domain),
 * so the request itself is the only honest source.
 */

/**
 * The public origin of this request, through Vercel's proxy.
 *
 * `request.url` is rewritten to the function's own address behind a proxy, so
 * the forwarded headers are what the user actually typed; the URL is the
 * fallback for a direct call and for tests.
 */
export function publicOrigin(request: Request): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return new URL(request.url).origin;
  const proto = request.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Where the MCP server lives. One route (`src/app/api/mcp/route.ts`), so this
 * is the path a user types into Claude and therefore the audience every token
 * issued here is bound to.
 */
export const MCP_PATH = "/api/mcp";

/** The resource identifier (RFC 8707) tokens for this server are issued for. */
export const mcpResource = (request: Request) => `${publicOrigin(request)}${MCP_PATH}`;
