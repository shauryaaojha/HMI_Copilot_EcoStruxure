/**
 * S3-05: the token endpoint does not tie codes and refresh tokens to the client.
 *
 * OAuth 2.1 (draft-ietf-oauth-v2-1-13) section 4.1.3: "if the client is public, ensure that the code
 * was issued to client_id in the request". Section 4.3: "The authorization server MUST maintain
 * the binding between a refresh token and the client to whom it was issued."
 * lib/server/oauth.ts:543 checks client_id only `if (clientId && ...)`, so leaving it out
 * passes. refreshGrant (oauth.ts:558) never looks at client_id. Shown live on localhost too
 * (SCRATCH/s3/oauth-flow.sh steps 12 and 15).
 */
import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRepo } from "@/lib/server/repo";
import { approveAuthorization, exchangeToken, OauthError, registerClient, validateAuthorizeRequest } from "@/lib/server/oauth";

const ORIGIN = "https://hmi.example.com";
const req = () => new Request(`${ORIGIN}/api/oauth/token`, { method: "POST" });
let storage: MemoryRepo;

async function codeFor(clientId: string, verifier: string, scope = "mcp:read mcp:write offline_access") {
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const params = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    code_challenge: challenge, code_challenge_method: "S256", scope, resource: `${ORIGIN}/api/mcp`,
  });
  const approved = await validateAuthorizeRequest(params, new Request(`${ORIGIN}/oauth/authorize?${params}`), storage);
  const { redirect } = await approveAuthorization(approved, { id: "alice", name: "Alice", email: null }, storage);
  return new URL(redirect).searchParams.get("code")!;
}

async function failure(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null; } catch (e) { return e instanceof OauthError ? e.code : String(e); }
}

beforeEach(() => { storage = new MemoryRepo(); });

describe("S3-05 codes and refresh tokens are bound to their client", () => {
  it("a code exchange that leaves out client_id is refused", async () => {
    const a = await registerClient({ client_name: "A", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }, null, storage);
    const verifier = randomBytes(40).toString("base64url");
    const code = await codeFor(a.client_id as string, verifier);
    const form = new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier });
    expect(await failure(exchangeToken(form, req(), storage)), "a public client's code was exchanged with no client_id at all").not.toBeNull();
  });

  it("a refresh token presented with another client's id is refused", async () => {
    const a = await registerClient({ client_name: "A", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }, null, storage);
    const b = await registerClient({ client_name: "B", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }, null, storage);
    const verifier = randomBytes(40).toString("base64url");
    const code = await codeFor(a.client_id as string, verifier);
    const tokens = await exchangeToken(new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: a.client_id as string }), req(), storage);
    const refresh = new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token!, client_id: b.client_id as string });
    expect(await failure(exchangeToken(refresh, req(), storage)), "client B refreshed client A's refresh token and got new tokens").toBe("invalid_grant");
  });
});
