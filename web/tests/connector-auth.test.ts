/**
 * How Claude signs in to the connector: our own OAuth authorization server,
 * and the personal access token that stands in for it.
 *
 * Driven through the route handlers rather than the library underneath, because
 * the things that break this flow are HTTP shapes rather than logic. A token
 * endpoint that only parsed JSON would answer 415 and the whole connection
 * would fail with a message that says nothing about why
 * (docs/CONNECTOR_SPEC_NOTES.md §3), and no unit test of the grant would have
 * noticed. So the exchange here is form-encoded, the consent decision is a
 * form POST with an Origin, and the discovery documents are read off the
 * response.
 *
 * What is held hardest is the set of refusals. A missing credential, a revoked
 * one, one belonging to another user, a code redeemed without its verifier, a
 * refresh token that has already been rotated - every one of them has to be a
 * no, and the last is the one a server gets wrong by returning the new token
 * without invalidating the old.
 *
 * No model is called, and no hash leaves any route.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { MemoryRepo, type Snapshot, type User } from "@/lib/server/repo";
import { sample } from "./fixtures/collab";

const state = vi.hoisted(() => ({ repo: null as unknown as MemoryRepo, user: null as User | null }));
vi.mock("@/lib/server/repo", async original => ({ ...await original<typeof import("@/lib/server/repo")>(), repo: () => state.repo }));
vi.mock("@/lib/server/session", () => ({ currentUser: async () => state.user }));

import { GET as protectedResource } from "@/app/api/oauth/protected-resource/route";
import { GET as authorizationServer } from "@/app/api/oauth/authorization-server/route";
import { POST as register } from "@/app/api/oauth/register/route";
import { POST as authorize } from "@/app/api/oauth/authorize/route";
import { POST as token } from "@/app/api/oauth/token/route";
import { POST as mintToken } from "@/app/api/account/tokens/route";
import { GET as listConnections } from "@/app/api/account/connections/route";
import { DELETE as revokeConnection } from "@/app/api/account/connections/[id]/route";
import { DELETE as revokePersonal } from "@/app/api/account/tokens/[id]/route";
import { POST as mcpPost } from "@/app/api/mcp/route";
import { validateAuthorizeRequest, OauthError } from "@/lib/server/oauth";

const HOST = "hmi.example.com";
const ORIGIN = `https://${HOST}`;
const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
/** What Claude Code registers: a loopback with whatever port it got that run. */
const LOOPBACK = "http://127.0.0.1/callback";
const ALICE = "project-alice";
const ZOE = "project-zoe";

let seq = 0;

/* ------------------------------------------------------------- the client */

const jsonPost = (path: string, body: unknown) =>
  new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) });

/** A form POST, which is what both the consent screen and the token endpoint take. */
const formPost = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields).toString(),
  });

const get = (path: string) => new Request(`${ORIGIN}${path}`, { headers: { host: HOST } });

async function registerClient(redirectUris = [CLAUDE_CALLBACK]): Promise<string> {
  const response = await register(jsonPost("/api/oauth/register", { client_name: "Claude", redirect_uris: redirectUris }));
  expect(response.status).toBe(201);
  const body = await response.json();
  return body.client_id as string;
}

/** A PKCE pair, generated the way a client does. */
function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier, "utf8").digest("base64url") };
}

const authorizeParams = (clientId: string, challenge: string, extra: Record<string, string> = {}) => ({
  response_type: "code",
  client_id: clientId,
  redirect_uri: CLAUDE_CALLBACK,
  code_challenge: challenge,
  code_challenge_method: "S256",
  scope: "mcp:read mcp:write offline_access",
  state: "state-value",
  resource: `${ORIGIN}/api/mcp`,
  ...extra,
});

/** Approve a request on the consent screen and read the code out of the redirect. */
async function approve(fields: Record<string, string>): Promise<Response> {
  return await authorize(formPost("/api/oauth/authorize", { ...fields, decision: "allow" }, { origin: ORIGIN }));
}

function codeFrom(response: Response): string {
  expect(response.status).toBe(303);
  const location = new URL(response.headers.get("location")!);
  const code = location.searchParams.get("code");
  expect(code, `no code in ${location.origin}${location.pathname}`).toBeTruthy();
  return code!;
}

/** The whole dance, as Claude performs it, down to a usable pair of tokens. */
async function connect(): Promise<{ access: string; refresh: string; clientId: string }> {
  const clientId = await registerClient();
  const { verifier, challenge } = pkce();
  const code = codeFrom(await approve(authorizeParams(clientId, challenge)));
  const response = await token(formPost("/api/oauth/token", {
    grant_type: "authorization_code", code, code_verifier: verifier,
    client_id: clientId, redirect_uri: CLAUDE_CALLBACK, resource: `${ORIGIN}/api/mcp`,
  }));
  expect(response.status).toBe(200);
  const body = await response.json();
  return { access: body.access_token as string, refresh: body.refresh_token as string, clientId };
}

/* ---------------------------------------------------------- the MCP call */

/** One JSON-RPC call to the connector, carrying whatever credential is given. */
async function rpc(method: string, params?: unknown, headers: Record<string, string> = {}) {
  const response = await mcpPost(new Request(`${ORIGIN}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", host: HOST, ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, ...(params ? { params } : {}) }),
  }));
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

const bearer = (value: string) => ({ authorization: `Bearer ${value}` });

/** A tool call through the connector, with its text and whether it refused. */
async function call(name: string, args: Record<string, unknown>, headers: Record<string, string>) {
  const { response, body } = await rpc("tools/call", { name, arguments: args }, headers);
  expect(response.status).toBe(200);
  const result = body.result as { content: { type: string; text?: string }[]; isError?: boolean };
  return { text: result.content.filter(c => c.type === "text").map(c => c.text).join("\n"), refused: result.isError === true };
}

beforeEach(async () => {
  // The laptop escape hatch off, so nothing here passes for the wrong reason.
  vi.stubEnv("MCP_DEV_USER_ID", "");
  vi.stubEnv("AI_PROVIDER", "none");
  state.repo = new MemoryRepo();
  await state.repo.users.upsert({ id: "alice", name: "Alice", email: "alice@example.com" });
  await state.repo.users.upsert({ id: "zoe", name: "Zoe", email: "zoe@example.com" });
  await state.repo.projects.create("alice", { ...sample(ALICE), name: "Pump Station" });
  await state.repo.projects.create("zoe", { ...sample(ZOE), name: "Someone else's" } as Snapshot);
  state.user = { id: "alice", name: "Alice", email: "alice@example.com" };
});
afterEach(() => vi.unstubAllEnvs());

/* ------------------------------------------------------------- discovery */

describe("the discovery documents", () => {
  it("names this host as the resource, and one authorization server", async () => {
    const body = await (await protectedResource(get("/.well-known/oauth-protected-resource"))).json();
    // Must equal the MCP server URL as the user typed it, path included.
    expect(body.resource).toBe(`${ORIGIN}/api/mcp`);
    // Claude reads the first entry and does not fall back to any other, so
    // there is exactly one and it is ours.
    expect(body.authorization_servers[0]).toBe(ORIGIN);
    expect(body.authorization_servers).toHaveLength(1);
    expect(body.scopes_supported).toContain("offline_access");
  });

  it("builds the resource from the host the request arrived on, not a constant", async () => {
    const response = await protectedResource(new Request("http://127.0.0.1:3000/.well-known/oauth-protected-resource", {
      headers: { "x-forwarded-host": "preview.vercel.app", "x-forwarded-proto": "https" },
    }));
    const body = await response.json();
    expect(body.resource).toBe("https://preview.vercel.app/api/mcp");
    expect(body.authorization_servers[0]).toBe("https://preview.vercel.app");
  });

  it("advertises S256 and nothing weaker, and offline_access so Claude asks for a refresh", async () => {
    const body = await (await authorizationServer(get("/.well-known/oauth-authorization-server"))).json();
    expect(body.code_challenge_methods_supported).toEqual(["S256"]);
    expect(body.issuer).toBe(ORIGIN);
    expect(body.scopes_supported).toContain("offline_access");
    expect(body.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    // A public client has no secret to present.
    expect(body.token_endpoint_auth_methods_supported).toEqual(["none"]);
    for (const endpoint of ["authorization_endpoint", "token_endpoint", "registration_endpoint"]) {
      expect(body[endpoint]).toContain(ORIGIN);
    }
  });
});

/* ---------------------------------------------------------- registration */

describe("registration and redirect URIs", () => {
  it("registers a public client, with no secret anywhere in the answer", async () => {
    const response = await register(jsonPost("/api/oauth/register", { client_name: "Claude", redirect_uris: [CLAUDE_CALLBACK] }));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.client_id).toMatch(/^client_[0-9a-f]{32}$/);
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(JSON.stringify(body)).not.toContain("client_secret");
  });

  it("refuses a registration with no redirect URI, and a cleartext one off the loopback", async () => {
    expect((await register(jsonPost("/api/oauth/register", { client_name: "Claude" }))).status).toBe(400);
    const cleartext = await register(jsonPost("/api/oauth/register", { redirect_uris: ["http://evil.example.com/cb"] }));
    expect(cleartext.status).toBe(400);
    expect((await cleartext.json()).error).toBe("invalid_request");
  });

  it("matches a loopback redirect on any port, because Claude Code's is ephemeral", async () => {
    const clientId = await registerClient([LOOPBACK]);
    const { challenge } = pkce();
    const onAnotherPort = { ...authorizeParams(clientId, challenge), redirect_uri: "http://127.0.0.1:54321/callback" };
    const location = new URL((await approve(onAnotherPort)).headers.get("location")!);
    expect(location.port).toBe("54321");
    expect(location.searchParams.get("code")).toBeTruthy();
  });

  it("refuses a redirect URI off the loopback that is not the registered one", async () => {
    const clientId = await registerClient([CLAUDE_CALLBACK]);
    const { challenge } = pkce();
    const elsewhere = { ...authorizeParams(clientId, challenge), redirect_uri: "https://claude.ai.evil.example.com/cb" };
    const response = await approve(elsewhere);
    // Refused on our own page rather than redirected: the URI that failed is
    // the one that would have decided where an error went.
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    // And a different path on the right host is still a different URI.
    const wrongPath = { ...authorizeParams(clientId, challenge), redirect_uri: "https://claude.ai/api/mcp/elsewhere" };
    expect((await approve(wrongPath)).status).toBe(400);
  });
});

/* ----------------------------------------------------------------- PKCE */

describe("PKCE", () => {
  it("refuses an authorization request with no code_challenge", async () => {
    const clientId = await registerClient();
    const params = new URLSearchParams(authorizeParams(clientId, "ignored"));
    params.delete("code_challenge");
    await expect(validateAuthorizeRequest(params, get("/oauth/authorize"), state.repo))
      .rejects.toMatchObject({ code: "invalid_request" });
    // And through the form, where a client that stripped the field would land.
    const posted = await authorize(formPost("/api/oauth/authorize", { ...Object.fromEntries(params), decision: "allow" }, { origin: ORIGIN }));
    expect(posted.status).toBe(303);
    const back = new URL(posted.headers.get("location")!);
    expect(back.searchParams.get("error")).toBe("invalid_request");
    expect(back.searchParams.get("code")).toBeNull();
  });

  it("refuses a code_challenge_method weaker than S256", async () => {
    const clientId = await registerClient();
    const { challenge } = pkce();
    const params = new URLSearchParams(authorizeParams(clientId, challenge, { code_challenge_method: "plain" }));
    await expect(validateAuthorizeRequest(params, get("/oauth/authorize"), state.repo))
      .rejects.toBeInstanceOf(OauthError);
  });

  it("refuses a token exchange whose verifier does not match the challenge", async () => {
    const clientId = await registerClient();
    const { challenge } = pkce();
    const code = codeFrom(await approve(authorizeParams(clientId, challenge)));
    const wrong = randomBytes(32).toString("base64url");
    const response = await token(formPost("/api/oauth/token", {
      grant_type: "authorization_code", code, code_verifier: wrong, client_id: clientId, redirect_uri: CLAUDE_CALLBACK,
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid_grant");
  });

  it("refuses a code exchanged twice, even with the right verifier", async () => {
    const clientId = await registerClient();
    const { verifier, challenge } = pkce();
    const code = codeFrom(await approve(authorizeParams(clientId, challenge)));
    const exchange = () => token(formPost("/api/oauth/token", {
      grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: CLAUDE_CALLBACK,
    }));
    expect((await exchange()).status).toBe(200);
    const again = await exchange();
    expect(again.status).toBe(400);
    expect((await again.json()).error).toBe("invalid_grant");
  });
});

/* ------------------------------------------------------- the token endpoint */

describe("the token endpoint", () => {
  it("takes a form-encoded body, which is the one shape Claude sends", async () => {
    const clientId = await registerClient();
    const { verifier, challenge } = pkce();
    const code = codeFrom(await approve(authorizeParams(clientId, challenge)));
    const response = await token(formPost("/api/oauth/token", {
      grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: CLAUDE_CALLBACK,
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const body = await response.json();
    expect(body.token_type).toBe("Bearer");
    expect(body.expires_in).toBeGreaterThan(0);
    expect(body.scope).toContain("offline_access");
    expect(body.refresh_token).toBeTruthy();
  });

  it("answers invalid_grant to an invalid refresh token, and never a code of its own", async () => {
    const response = await token(formPost("/api/oauth/token", {
      grant_type: "refresh_token", refresh_token: "hmi_not_a_real_token", client_id: "client_whatever",
    }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_grant");
    // Not invalid_request, and not something invented: Claude can only act on
    // the registered codes (docs/CONNECTOR_SPEC_NOTES.md §3).
    expect(body.error).not.toBe("invalid_request");
  });

  it("refuses a grant type it does not support", async () => {
    const response = await token(formPost("/api/oauth/token", { grant_type: "password", username: "alice", password: "x" }));
    expect((await response.json()).error).toBe("unsupported_grant_type");
  });

  it("refuses a resource that is not this server", async () => {
    const clientId = await registerClient();
    const { verifier, challenge } = pkce();
    const code = codeFrom(await approve(authorizeParams(clientId, challenge)));
    const response = await token(formPost("/api/oauth/token", {
      grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId,
      redirect_uri: CLAUDE_CALLBACK, resource: "https://someone-elses-mcp.example.com/api/mcp",
    }));
    expect((await response.json()).error).toBe("invalid_target");
  });
});

/* ---------------------------------------------------------------- refresh */

describe("refreshing", () => {
  it("rotates the refresh token, and the old one stops working at once", async () => {
    const { refresh, clientId } = await connect();
    const first = await token(formPost("/api/oauth/token", { grant_type: "refresh_token", refresh_token: refresh, client_id: clientId }));
    expect(first.status).toBe(200);
    const rotated = await first.json();
    expect(rotated.refresh_token).toBeTruthy();
    expect(rotated.refresh_token).not.toBe(refresh);

    // The same response that handed over the new one invalidated the old.
    const replayed = await token(formPost("/api/oauth/token", { grant_type: "refresh_token", refresh_token: refresh, client_id: clientId }));
    expect(replayed.status).toBe(400);
    expect((await replayed.json()).error).toBe("invalid_grant");

    // The new one works, and its access token reaches the connector.
    const again = await token(formPost("/api/oauth/token", { grant_type: "refresh_token", refresh_token: rotated.refresh_token, client_id: clientId }));
    expect(again.status).toBe(200);
    expect((await rpc("tools/list", undefined, bearer((await again.json()).access_token))).response.status).toBe(200);
  });

  it("will not let a refresh token be presented as an access token", async () => {
    const { refresh } = await connect();
    // Signed in in this browser, which is exactly when a credential that fails
    // must not be topped up from the session behind it.
    expect((await rpc("tools/list", undefined, bearer(refresh))).response.status).toBe(401);
  });
});

/* ------------------------------------------------------ reaching the MCP */

describe("presenting a credential to the connector", () => {
  it("refuses a call with no token at all", async () => {
    state.user = null;
    const { response } = await rpc("tools/list");
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("/.well-known/oauth-protected-resource");
  });

  it("refuses an unknown token, and one that is merely well shaped", async () => {
    state.user = null;
    expect((await rpc("tools/list", undefined, bearer("hmi_pat_" + randomBytes(32).toString("base64url")))).response.status).toBe(401);
    expect((await rpc("tools/list", undefined, { "x-api-key": "anything" })).response.status).toBe(401);
  });

  it("never reads a token from the query string", async () => {
    const { access } = await connect();
    state.user = null;
    const response = await mcpPost(new Request(`${ORIGIN}/api/mcp?access_token=${access}`, {
      method: "POST",
      headers: { "content-type": "application/json", host: HOST },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }));
    // The spec prohibits it, and a URL reaches logs, proxies and history.
    expect(response.status).toBe(401);
  });

  it("accepts an OAuth access token and an x-api-key personal token", async () => {
    const { access } = await connect();
    const personal = await (await mintToken(jsonPost("/api/account/tokens", { name: "Laptop inspector" }))).json();
    state.user = null;
    expect((await rpc("tools/list", undefined, bearer(access))).response.status).toBe(200);
    expect((await rpc("tools/list", undefined, { "x-api-key": personal.token })).response.status).toBe(200);
    expect((await call("list_projects", {}, bearer(access))).text).toContain("Pump Station");
  });

  it("refuses an access token minted for another server", async () => {
    const { access } = await connect();
    state.user = null;
    // The same token, presented to a different deployment of this app. Token
    // passthrough is forbidden, so the audience has to be checked.
    const response = await mcpPost(new Request("https://elsewhere.example.com/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", host: "elsewhere.example.com", ...bearer(access) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }));
    expect(response.status).toBe(401);
  });

  it("gives a token for one user no sight of another user's project", async () => {
    const { access } = await connect();
    state.user = null;
    const listed = await call("list_projects", {}, bearer(access));
    expect(listed.text).toContain(ALICE);
    expect(listed.text).not.toContain(ZOE);
    expect(listed.text).not.toContain("Someone else's");
    const refused = await call("get_screens", { projectId: ZOE }, bearer(access));
    expect(refused.refused).toBe(true);
    expect(refused.text).toContain("permission");
  });
});

/* ------------------------------------------------------------ revocation */

describe("revoking", () => {
  it("stops a connection's access token on the very next call", async () => {
    const { access } = await connect();
    expect((await rpc("tools/list", undefined, bearer(access))).response.status).toBe(200);

    const connections = await (await listConnections()).json();
    expect(connections.connections).toHaveLength(1);
    expect(connections.connections[0].clientName).toBe("Claude");
    // The host the code is sent to, which is what the consent screen showed.
    expect(connections.connections[0].redirectHost).toBe("claude.ai");

    const id = connections.connections[0].id as string;
    const revoked = await revokeConnection(new Request(`${ORIGIN}/api/account/connections/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });
    expect(revoked.status).toBe(204);
    state.user = null;
    expect((await rpc("tools/list", undefined, bearer(access))).response.status).toBe(401);
  });

  it("stops a revoked personal token on the very next call", async () => {
    const minted = await (await mintToken(jsonPost("/api/account/tokens", { name: "Laptop inspector" }))).json();
    expect((await rpc("tools/list", undefined, bearer(minted.token))).response.status).toBe(200);
    const revoked = await revokePersonal(
      new Request(`${ORIGIN}/api/account/tokens/${minted.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: minted.id as string }) },
    );
    expect(revoked.status).toBe(204);
    state.user = null;
    expect((await rpc("tools/list", undefined, bearer(minted.token))).response.status).toBe(401);
  });

  it("will not let one user revoke another user's token", async () => {
    const minted = await (await mintToken(jsonPost("/api/account/tokens", { name: "Alice's" }))).json();
    state.user = { id: "zoe", name: "Zoe" };
    const attempt = await revokePersonal(
      new Request(`${ORIGIN}/api/account/tokens/${minted.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: minted.id as string }) },
    );
    expect(attempt.status).toBe(404);
    state.user = { id: "alice", name: "Alice" };
    expect((await rpc("tools/list", undefined, bearer(minted.token))).response.status).toBe(200);
  });

  it("refuses to approve a consent form that did not come from our own page", async () => {
    const clientId = await registerClient();
    const { challenge } = pkce();
    const forged = await authorize(formPost("/api/oauth/authorize", { ...authorizeParams(clientId, challenge), decision: "allow" }, { origin: "https://evil.example.com" }));
    expect(forged.status).toBe(403);
    // And with no Origin at all, which is the one request that gets no benefit
    // of the doubt, because what it grants is the engineer's own projects.
    const silent = await authorize(formPost("/api/oauth/authorize", { ...authorizeParams(clientId, challenge), decision: "allow" }));
    expect(silent.status).toBe(403);
  });

  it("sends a denial back to the client as access_denied, with no code", async () => {
    const clientId = await registerClient();
    const { challenge } = pkce();
    const denied = await authorize(formPost("/api/oauth/authorize", { ...authorizeParams(clientId, challenge), decision: "deny" }, { origin: ORIGIN }));
    const location = new URL(denied.headers.get("location")!);
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe("state-value");
    expect(location.searchParams.get("code")).toBeNull();
  });
});

/* ------------------------------------------------------- nothing leaks */

describe("no route hands back a hash", () => {
  it("keeps every stored hash out of every response, and the secret out of all but one", async () => {
    const { access, refresh } = await connect();
    const minted = await (await mintToken(jsonPost("/api/account/tokens", { name: "Laptop inspector" }))).json();
    const hashes = [access, refresh, minted.token as string].map(value => createHash("sha256").update(value, "utf8").digest("hex"));

    const bodies = [
      await (await listConnections()).text(),
      await (await protectedResource(get("/.well-known/oauth-protected-resource"))).text(),
      await (await authorizationServer(get("/.well-known/oauth-authorization-server"))).text(),
      JSON.stringify((await rpc("tools/list", undefined, bearer(access))).body),
    ];
    for (const body of bodies) {
      for (const hash of hashes) expect(body).not.toContain(hash);
      // The listing names tokens by a public id, never by the secret itself.
      for (const secret of [access, refresh, minted.token as string]) expect(body).not.toContain(secret);
    }

    // The one response that carries a secret is the mint, and it carries no hash.
    const again = await (await mintToken(jsonPost("/api/account/tokens", { name: "Second" }))).text();
    expect(again).not.toContain(createHash("sha256").update(JSON.parse(again).token, "utf8").digest("hex"));
    expect(JSON.parse(again).token).toMatch(/^hmi_pat_/);
  });
});
