/**
 * The two HTTP-level answers the connector spec pins down: who may post here
 * from a browser, and what an unauthenticated call gets back.
 *
 * Origin. Claude calls from Anthropic's cloud, server to server, with no
 * `Origin` header at all (docs/CONNECTOR_SPEC_NOTES.md §3). A browser page is
 * the only thing that sends one, and the only browser page that legitimately
 * does is the MCP Inspector on a developer's loopback. `lib/server/http.ts`
 * refuses every cross-origin write outright, which is right for the editor's
 * own routes and wrong here: the Inspector runs on another port. So the rule
 * is a different one - absent, our own, or loopback off a deployment - rather
 * than a reuse that would have had to be loosened for everybody.
 *
 * 401. The pointer to the resource metadata is what makes Claude start the
 * OAuth flow, and it only reads it on a 401: "Claude ignores
 * `WWW-Authenticate` on a `200`" (§3). The `resource` field has to match the
 * URL the user typed into Claude, path included, and this app answers on more
 * than one hostname, so the base is taken from the request rather than from a
 * configured constant.
 */
import { ServerError } from "@/lib/server/errors";
import { publicOrigin } from "@/lib/server/origin";
import { RESOURCE_METADATA_PATH } from "./caller";

// The origin moved to lib/server/origin.ts once the authorization server
// needed the same answer for its `issuer`; re-exported because this is where
// the transport's callers already look for it.
export { publicOrigin };

/** A browser origin on the loopback, which is where the MCP Inspector lives. */
const loopback = (origin: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);

/**
 * Refuse a browser page that has no business posting here. An extra origin can
 * be named in `MCP_ALLOWED_ORIGINS` (comma separated) for a hosted inspector.
 */
export function checkOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (origin === publicOrigin(request)) return;
  if (loopback(origin) && !process.env.VERCEL) return;
  const allowed = (process.env.MCP_ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  if (allowed.includes(origin)) return;
  throw new ServerError(403, "origin", "This origin may not call the MCP server");
}

/**
 * The 401 that starts the OAuth flow. The metadata document itself is stream
 * S5's; the pointer has to be right from the first call, because a connector
 * that answers 401 without it leaves Claude with nowhere to go.
 */
export function unauthorized(request: Request): Response {
  const metadata = `${publicOrigin(request)}${RESOURCE_METADATA_PATH}`;
  return Response.json(
    { error: "Sign in to use the HMI Copilot connector", code: "unauthorized" },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="${metadata}"`,
        "Cache-Control": "no-store",
      },
    },
  );
}
