/**
 * The MCP server: one endpoint, Streamable HTTP, for claude.ai's custom
 * connector and for the MCP Inspector. Phase 4, M1 and M2.
 *
 * The route itself does three things and then gets out of the way: refuse a
 * browser origin that has no business here, turn the request into a `Caller`
 * or a 401, and hand the body to the transport. Everything else - which tools
 * exist, what role each needs - is in `lib/mcp`.
 *
 * The 401 carries the `resource_metadata` pointer. It has to be a 401 and not
 * a 200 with a hint, because Claude ignores `WWW-Authenticate` on a 200
 * (docs/CONNECTOR_SPEC_NOTES.md §3); stream S5 serves the document it points
 * at, and the pointer is correct before that lands.
 *
 * GET and DELETE answer 405, after the same checks. The server is stateless
 * and built per request (see `lib/mcp/server.ts`): there is no session to end,
 * and nothing can arrive on a standalone stream, so handing a GET to the
 * transport would hold an SSE connection open for the function's whole life
 * with nothing to send down it. Both still go through the caller check first,
 * because a client that probes the endpoint to discover how to authenticate
 * has to find the 401 whichever verb it probes with.
 */
import { errorResponse } from "@/lib/server/errors";
import { resolveCaller } from "@/lib/mcp/caller";
import { checkOrigin, insufficientScope, unauthorized } from "@/lib/mcp/http";
import { missingScope, TOOLS } from "@/lib/mcp/tools";
import { handleMcpRequest } from "@/lib/mcp/server";
import { readBody } from "@/lib/ingest/body";

export const runtime = "nodejs";
/**
 * Claude allows 240 s per tool call (docs/CONNECTOR_SPEC_NOTES.md §2), which
 * is the ceiling to stay under rather than a budget to spend: 120 s matches
 * what the model-calling routes here already ask for, and nothing in M1 or M2
 * runs for seconds. Anything that could outlive a function - stream S6's
 * `generate` - is a job with an id for exactly that reason.
 */
export const maxDuration = 120;

export async function POST(request: Request): Promise<Response> {
  try {
    checkOrigin(request);
    const caller = await resolveCaller(request);
    if (!caller) return unauthorized(request);
    // A scope failure is an HTTP challenge so an OAuth client can ask the
    // engineer for the missing grant. The tool handler still checks it too.
    const declared = Number(request.headers.get("content-length"));
    if (!Number.isFinite(declared) || declared <= 1024 * 1024) {
      const body = await readBody(request.clone(), 1024 * 1024).then(bytes => JSON.parse(new TextDecoder().decode(bytes))).catch(() => null);
      if (body?.method === "tools/call") {
        const spec = TOOLS.find(tool => tool.name === body.params?.name);
        const scope = spec && missingScope(spec, caller);
        if (scope) return insufficientScope(request, scope);
      }
    }
    return await handleMcpRequest(request, caller);
  } catch (error) {
    return errorResponse(error);
  }
}

async function notAllowed(request: Request): Promise<Response> {
  try {
    checkOrigin(request);
    if (!await resolveCaller(request)) return unauthorized(request);
    return Response.json(
      { error: "The MCP server takes POST only", code: "method" },
      { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export const GET = notAllowed;
export const DELETE = notAllowed;
