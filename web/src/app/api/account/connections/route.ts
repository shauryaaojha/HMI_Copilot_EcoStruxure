/**
 * What is currently allowed to reach this account through the connector:
 * the clients an engineer has consented to, and the personal access tokens
 * they minted themselves.
 *
 * Two lists on one request because they are one question - "what can get in?"
 * - and because the page that asks has to show both or it is not an answer.
 * No hash and no token value appears here; `TokenInfo` cannot carry one, and
 * the fields are listed out rather than spread so that adding a column to the
 * stored row never silently adds it to this response.
 */
import { repo } from "@/lib/server/repo";
import { errorResponse, userRequired } from "@/lib/server/http";
import { scopeLabel } from "@/lib/server/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await userRequired();
    const [grants, tokens] = await Promise.all([
      repo().connector.grants(user.id),
      repo().connector.personal(user.id),
    ]);
    return Response.json(
      {
        connections: grants.map(g => ({
          id: g._id,
          clientName: g.clientName,
          redirectHost: g.redirectHost,
          scopes: g.scopes,
          permissions: g.scopes.map(scopeLabel),
          createdAt: g.createdAt,
        })),
        tokens: tokens.map(t => ({ id: t.id, name: t.name ?? "Personal access token", scopes: t.scopes, createdAt: t.createdAt, expiresAt: t.expiresAt })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) { return errorResponse(error); }
}
