/**
 * The authorization server for the claude.ai connector, and the personal
 * access tokens that stand in for it.
 *
 * Decision B: we are both the resource server and the authorization server.
 * There is no identity vendor in this stack to delegate to - email and
 * password is the only way into an account (decision A) - so the account that
 * signs in to the editor is the account Claude is granted access to, and
 * `currentUser()` is what the consent screen asks.
 *
 * Everything here is written against docs/CONNECTOR_SPEC_NOTES.md §3, which
 * is a record of what Claude's client actually does rather than what the
 * specifications permit. The two differ in ways that decide whether the flow
 * works at all: only the *first* `authorization_servers` entry is read, the
 * `resource` field must equal the URL the user typed in, PKCE S256 is not
 * optional, the token endpoint is form-encoded, and a refresh token has to
 * rotate.
 *
 * The division of labour is the same one `lib/mcp/caller.ts` sets out: this
 * module decides *who* a credential belongs to and what it was issued for.
 * What they may then do to a project is `lib/server/access.ts`, and no tool
 * is allowed its own opinion on either.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { repo, type Repo, type User } from "./repo";
import type { AuthCodeFields, ConnectorGrant, OauthClient, TokenInfo } from "./repo-connector";
import { ServerError } from "./errors";
import { MCP_PATH, mcpResource, publicOrigin } from "./origin";
import { clientIp, countAttempt } from "./rate-limit";

/* ---------------------------------------------------------------- secrets */

/**
 * A token, and the hash it is stored as.
 *
 * SHA-256, not bcrypt. A password is low entropy and typed by a human, which
 * is what a deliberately slow hash defends: it makes a dictionary expensive.
 * These secrets are 256 bits straight out of `randomBytes`, so there is no
 * dictionary and nothing for the slowness to buy - while bcrypt at the cost
 * `credentials.ts` uses would put a quarter of a second on *every* MCP call,
 * a self-inflicted latency bug paid on the hot path forever. A fast hash over
 * a high-entropy secret is the right trade here, and the wrong one one file
 * over.
 */
const secret = () => randomBytes(32).toString("base64url");
export const tokenHash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/**
 * A personal access token, with a prefix.
 *
 * The prefix is not decoration: it is what lets a secret scanner recognise one
 * of ours in a commit or a log, and what tells an engineer staring at a header
 * value which system it belongs to.
 */
export const PERSONAL_PREFIX = "hmi_pat_";
const mintPersonal = () => `${PERSONAL_PREFIX}${secret()}`;

/** Compared in constant time, since the comparison is against a stored secret. */
function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/* ----------------------------------------------------------------- scopes */

/**
 * What a token can carry. `offline_access` is in the list because advertising
 * it is how the authorization server tells Claude it may ask for a refresh
 * token (docs/CONNECTOR_SPEC_NOTES.md §3); without it Claude asks for an
 * access token alone and the connection dies in an hour.
 *
 * `mcp:read` and `mcp:write` are recorded on the token and carried on the
 * `Caller`, and deliberately not resolved into a role: a scope is the
 * credential's limit and a role is the project's answer, and collapsing the
 * two is how the web app and the connector would come to disagree.
 */
export const SCOPES = ["mcp:read", "mcp:write", "offline_access"] as const;
export const DEFAULT_SCOPES = [...SCOPES];

/** The scopes asked for, narrowed to the ones that exist. */
function askedScopes(requested: string | null | undefined): string[] {
  const asked = (requested ?? "").split(/\s+/).filter(Boolean);
  if (!asked.length) return [...DEFAULT_SCOPES];
  const known = asked.filter((s): s is (typeof SCOPES)[number] => (SCOPES as readonly string[]).includes(s));
  if (!known.length) throw new OauthError("invalid_scope", "None of the requested scopes exist on this server");
  return known;
}

/* ------------------------------------------------------------- lifetimes */

/** An hour. Short enough that a stolen access token is a short problem, long enough that Claude is not refreshing mid-conversation. */
export const ACCESS_TTL_MS = 60 * 60 * 1000;
/** Thirty days, so a connector set up once keeps working without a second consent. */
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Two minutes. A code is redeemed by a machine, immediately; anything longer is only a window for a replay. */
export const CODE_TTL_MS = 2 * 60 * 1000;
/** Ninety days for a personal token, which a person has to remember to replace. */
export const PERSONAL_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------ rate limits */

/**
 * The token and authorize endpoints are counted by IP through the same fixed
 * window `lib/server/rate-limit.ts` already runs for sign-in, under a scope of
 * their own.
 *
 * The scope is separate because the counters stop different things: Anthropic
 * calls from a handful of addresses on behalf of everybody
 * (docs/CONNECTOR_SPEC_NOTES.md §3), so a connector refresh storm sharing
 * sign-in's bucket would lock an office out of signing in - and sign-in's 50
 * per quarter hour would itself be far too few for a cloud egress serving many
 * users. The limit is therefore higher and the bucket is its own.
 */
export const CONNECTOR_ATTEMPTS_PER_IP = 300;
const rateLimit = (request: Request | null | undefined, storage: Repo) =>
  countAttempt("connector", clientIp(request), CONNECTOR_ATTEMPTS_PER_IP, storage);

/* ------------------------------------------------------------- failures */

/**
 * An OAuth failure, which has a vocabulary of its own.
 *
 * The codes are the registered ones and nothing else, because a client only
 * recognises those: an invalid refresh token in particular must answer
 * `invalid_grant`, and a server that invented `invalid_request` or a code of
 * its own there would leave Claude unable to tell "sign in again" from "that
 * request was malformed" (docs/CONNECTOR_SPEC_NOTES.md §3).
 *
 * The description never quotes a code, a token or a verifier: a failed
 * exchange is exactly when a secret must not be written into something that
 * will be logged or displayed.
 */
export type OauthErrorCode =
  | "invalid_request" | "invalid_client" | "invalid_grant" | "unauthorized_client"
  | "unsupported_grant_type" | "unsupported_response_type" | "invalid_scope"
  | "invalid_target" | "access_denied" | "server_error" | "temporarily_unavailable";

export class OauthError extends Error {
  constructor(public code: OauthErrorCode, message: string, public status = 400) { super(message); }
}

/** The RFC 6749 §5.2 body, which is a different shape from this app's own errors. */
export function oauthFailure(error: unknown): Response {
  const headers = { "Cache-Control": "no-store", Pragma: "no-cache" };
  if (error instanceof OauthError) {
    return Response.json({ error: error.code, error_description: error.message }, { status: error.status, headers });
  }
  if (error instanceof ServerError) {
    // The rate limiter speaks this app's language, not OAuth's. No registered
    // token-endpoint code means "come back later", and answering
    // `invalid_request` would tell the client to fix a request that was fine,
    // so the honest pairing is the authorization-endpoint code with the status
    // that already carries the meaning.
    const retryAfter = error.detail.retryAfter;
    return Response.json(
      { error: error.status === 429 ? "temporarily_unavailable" : "invalid_request", error_description: error.message },
      { status: error.status, headers: { ...headers, ...(typeof retryAfter === "number" ? { "Retry-After": String(retryAfter) } : {}) } },
    );
  }
  return Response.json({ error: "server_error", error_description: "The authorization server failed" }, { status: 500, headers });
}

/* ------------------------------------------------------------- discovery */

/** Where each endpoint answers. Published, so a client never has to guess. */
export const AUTHORIZE_PATH = "/oauth/authorize";
export const TOKEN_PATH = "/api/oauth/token";
export const REGISTER_PATH = "/api/oauth/register";
export const REVOKE_PATH = "/api/oauth/revoke";

/**
 * RFC 9728 protected resource metadata.
 *
 * `resource` is built from the request rather than from configuration because
 * it "must equal the MCP server URL exactly as the user typed it into Claude,
 * path included", and this deployment answers on Vercel preview hostnames as
 * well as the production domain. `authorization_servers` has exactly one
 * entry, since Claude reads the first and does not fall back to any other -
 * a second entry would therefore be dead weight that looked like a fallback.
 */
export function protectedResourceMetadata(request: Request) {
  const origin = publicOrigin(request);
  return {
    resource: `${origin}${MCP_PATH}`,
    authorization_servers: [origin],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "HMI Copilot",
  };
}

/**
 * RFC 8414 authorization server metadata.
 *
 * `code_challenge_methods_supported` is `["S256"]` and nothing else: Claude
 * sends a challenge on every authorization request, so S256 is a requirement
 * here and `plain` would only advertise a downgrade. `token_endpoint_auth_
 * methods_supported` is `["none"]` because Claude registers as a public
 * client and has no secret to present.
 */
export function authorizationServerMetadata(request: Request) {
  const origin = publicOrigin(request);
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${AUTHORIZE_PATH}`,
    token_endpoint: `${origin}${TOKEN_PATH}`,
    registration_endpoint: `${origin}${REGISTER_PATH}`,
    revocation_endpoint: `${origin}${REVOKE_PATH}`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...SCOPES],
    service_documentation: "https://github.com/schneider/hmi-copilot",
  };
}

/* ----------------------------------------------------------- registration */

/** The registration this app will accept, and what it refuses to store. */
const MAX_REDIRECT_URIS = 10;

/**
 * Dynamic client registration (RFC 7591), as Claude performs it.
 *
 * Open registration, with no software statement and no initial access token:
 * Claude registers itself the first time an engineer adds the connector, and
 * there is nobody in the loop at that moment to issue one. What stops an
 * unwanted client from mattering is that registering buys nothing on its own -
 * every grant still needs a signed-in human to approve it on the consent
 * screen, so a stranger's `client_id` is an entry in a table and no more.
 */
export async function registerClient(
  body: Record<string, unknown>,
  request?: Request | null,
  storage: Repo = repo(),
): Promise<Record<string, unknown>> {
  await rateLimit(request, storage);
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (!uris.length) throw new OauthError("invalid_request", "redirect_uris is required");
  if (uris.length > MAX_REDIRECT_URIS) throw new OauthError("invalid_request", `Register at most ${MAX_REDIRECT_URIS} redirect URIs`);
  const redirectUris = uris.map(uri => {
    if (typeof uri !== "string") throw new OauthError("invalid_request", "Each redirect URI must be a string");
    let parsed: URL;
    try { parsed = new URL(uri); } catch { throw new OauthError("invalid_request", "Each redirect URI must be absolute"); }
    if (parsed.hash) throw new OauthError("invalid_request", "A redirect URI may not carry a fragment");
    // http is for the loopback and nowhere else: a cleartext redirect to a
    // real host would carry the authorization code across the network.
    if (parsed.protocol !== "https:" && !isLoopback(parsed)) {
      throw new OauthError("invalid_request", "A redirect URI must use https, or be a loopback address");
    }
    return parsed.toString();
  });
  const name = typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 100) : "An MCP client";
  const client = await storage.connector.registerClient({ clientName: name, redirectUris });
  return {
    client_id: client.clientId,
    client_id_issued_at: Math.floor(client.createdAt / 1000),
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    // Spelled out in the answer as well as assumed: Claude is a public client,
    // so there is no `client_secret` field here and its absence is the point,
    // not an omission a client should retry over.
    token_endpoint_auth_method: "none",
    scope: SCOPES.join(" "),
  };
}

/* -------------------------------------------------------- redirect URIs */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const isLoopback = (url: URL) => url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);

/**
 * Whether a requested redirect URI is one this client registered.
 *
 * Exact string match, with one exception the spec notes call for: a loopback
 * redirect matches on any port. Claude Code listens on an ephemeral port, so
 * the port it registered on a Monday is not the port it asks for on a Tuesday,
 * and an exact match would refuse the same client on its second run. Ignoring
 * the port is safe precisely because the host is the loopback - nothing
 * off the machine can be reached by varying it - and the port is the only
 * component relaxed (RFC 8252 §7.3).
 */
export function redirectAllowed(registered: string[], requested: string): boolean {
  let want: URL;
  try { want = new URL(requested); } catch { return false; }
  if (want.hash) return false;
  return registered.some(uri => {
    if (uri === requested) return true;
    let have: URL;
    try { have = new URL(uri); } catch { return false; }
    if (!isLoopback(have) || !isLoopback(want)) return false;
    return have.hostname === want.hostname && have.pathname === want.pathname && have.search === want.search;
  });
}

/* -------------------------------------------------- resource indicators */

/** Trailing slashes and letter case in the host are not a different server. */
const normalizeResource = (value: string) => value.replace(/\/+$/, "").toLowerCase();

/**
 * Whether a `resource` names this server (RFC 8707).
 *
 * Both the full MCP endpoint and the bare origin are accepted. They denote the
 * same deployment either way, and what this check exists to stop is a token
 * minted for somebody else's server being presented here - not a client that
 * wrote our own address one path segment shorter than we would have.
 */
export function resourceIsOurs(request: Request, value: string | null | undefined): boolean {
  if (!value) return true;
  const ours = normalizeResource(mcpResource(request));
  const asked = normalizeResource(value);
  return asked === ours || asked === normalizeResource(publicOrigin(request));
}

/* --------------------------------------------------------- authorization */

/** An authorization request that has survived validation, ready for a consent screen. */
export interface AuthorizeRequest {
  client: OauthClient;
  redirectUri: string;
  /** The host the user is about to send their code to, which the consent screen must name. */
  redirectHost: string;
  state?: string;
  codeChallenge: string;
  scopes: string[];
  resource?: string;
}

/**
 * A refusal that cannot be sent to the client, because the thing that failed
 * is what would have decided where to send it. An unknown `client_id` or an
 * unregistered `redirect_uri` has to be shown to the person in the browser:
 * redirecting an error to a URI we have not verified is how an authorization
 * server becomes an open redirector (RFC 6749 §4.1.2.1).
 */
export class AuthorizeRefusal extends Error {}

/**
 * Validate an authorization request.
 *
 * Throws `AuthorizeRefusal` for the two failures that must be rendered, and
 * `OauthError` for everything else - those can safely go back to the client
 * as `error` on its own redirect URI, which `authorizeErrorRedirect` builds.
 */
export async function validateAuthorizeRequest(
  params: URLSearchParams,
  request: Request,
  storage: Repo = repo(),
): Promise<AuthorizeRequest> {
  const clientId = params.get("client_id") ?? "";
  if (!clientId) throw new AuthorizeRefusal("This authorization request names no client.");
  const client = await storage.connector.client(clientId);
  if (!client) throw new AuthorizeRefusal("This client is not registered with HMI Copilot. Remove the connector and add it again.");

  const requested = params.get("redirect_uri");
  // Required rather than defaulted to the single registered URI: a client that
  // registered two and named neither has a bug, and guessing for it would send
  // a code somewhere it did not ask for.
  if (!requested) throw new AuthorizeRefusal("This authorization request names no redirect URI.");
  if (!redirectAllowed(client.redirectUris, requested)) {
    throw new AuthorizeRefusal("That redirect address is not one this client registered.");
  }

  if ((params.get("response_type") ?? "") !== "code") {
    throw new OauthError("unsupported_response_type", "Only the authorization code flow is supported");
  }

  // PKCE is a requirement, not a feature: Claude sends a challenge on every
  // request, so a missing one is a client we do not recognise or a downgrade
  // attempt, and there is no public client this flow is safe for without it.
  const codeChallenge = params.get("code_challenge") ?? "";
  const method = params.get("code_challenge_method") ?? "";
  if (!codeChallenge) throw new OauthError("invalid_request", "code_challenge is required: this server only accepts PKCE");
  if (method !== "S256") throw new OauthError("invalid_request", "code_challenge_method must be S256");
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(codeChallenge)) throw new OauthError("invalid_request", "code_challenge is not a base64url challenge");

  const resource = params.get("resource") ?? undefined;
  if (!resourceIsOurs(request, resource)) {
    throw new OauthError("invalid_target", "This server can only issue tokens for its own MCP endpoint");
  }

  const state = params.get("state") ?? undefined;
  return {
    client,
    redirectUri: requested,
    redirectHost: new URL(requested).host,
    state,
    codeChallenge,
    scopes: askedScopes(params.get("scope")),
    resource,
  };
}

/** Send a redirectable failure back to the client, state and all. */
export function authorizeErrorRedirect(redirectUri: string, error: OauthError | "access_denied", state?: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error === "access_denied" ? "access_denied" : error.code);
  if (error !== "access_denied") url.searchParams.set("error_description", error.message);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

/**
 * The user said yes. Record the consent, mint a code against it, and answer
 * with where the browser goes next.
 *
 * The grant is written here rather than at the token exchange because this is
 * the moment a human decided: a connection the engineer can see and revoke in
 * settings should exist from the instant they approved it, not from whenever
 * the client got round to redeeming its code.
 */
export async function approveAuthorization(
  approved: AuthorizeRequest,
  user: User,
  storage: Repo = repo(),
): Promise<{ redirect: string; grant: ConnectorGrant }> {
  const grant = await storage.connector.putGrant({
    userId: user.id,
    clientId: approved.client.clientId,
    clientName: approved.client.clientName,
    redirectHost: approved.redirectHost,
    scopes: approved.scopes,
    resource: approved.resource,
    createdAt: Date.now(),
  });
  const code = secret();
  const record: AuthCodeFields = {
    clientId: approved.client.clientId,
    userId: user.id,
    grantId: grant._id,
    redirectUri: approved.redirectUri,
    codeChallenge: approved.codeChallenge,
    scopes: approved.scopes,
    resource: approved.resource,
    expiresAt: Date.now() + CODE_TTL_MS,
  };
  await storage.connector.putCode(tokenHash(code), record);
  const url = new URL(approved.redirectUri);
  url.searchParams.set("code", code);
  if (approved.state) url.searchParams.set("state", approved.state);
  return { redirect: url.toString(), grant };
}

/* ---------------------------------------------------------------- tokens */

/** The RFC 6749 §5.1 response. `refresh_token` is present only when `offline_access` was granted. */
export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
  refresh_token?: string;
}

/** Verify a PKCE verifier against the challenge the authorization request carried. */
function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return sameSecret(createHash("sha256").update(verifier, "utf8").digest("base64url"), challenge);
}

/** Issue an access token, and a refresh token when the grant allows one. */
async function issuePair(
  grant: ConnectorGrant,
  scopes: string[],
  audience: string,
  storage: Repo,
): Promise<TokenResponse> {
  const now = Date.now();
  const access = secret();
  await storage.connector.issue({
    hash: tokenHash(access), kind: "access", userId: grant.userId, scopes,
    grantId: grant._id, audience, createdAt: now, expiresAt: now + ACCESS_TTL_MS,
  });
  const response: TokenResponse = {
    access_token: access,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    scope: scopes.join(" "),
  };
  if (scopes.includes("offline_access")) {
    const refresh = secret();
    await storage.connector.issue({
      hash: tokenHash(refresh), kind: "refresh", userId: grant.userId, scopes,
      grantId: grant._id, audience, createdAt: now, expiresAt: now + REFRESH_TTL_MS,
    });
    response.refresh_token = refresh;
  }
  return response;
}

/**
 * The token endpoint's whole decision, over an already-parsed form body.
 *
 * Form-encoded, never JSON, is the route's problem (`parseTokenBody`); what
 * this answers is the grant. Both grants end at the same place: a `grant` row
 * that still exists, and a pair of tokens bound to it and to this server.
 */
export async function exchangeToken(
  form: URLSearchParams,
  request: Request,
  storage: Repo = repo(),
): Promise<TokenResponse> {
  await rateLimit(request, storage);
  const grantType = form.get("grant_type") ?? "";
  if (grantType === "authorization_code") return await codeGrant(form, request, storage);
  if (grantType === "refresh_token") return await refreshGrant(form, request, storage);
  throw new OauthError("unsupported_grant_type", "Supported grants are authorization_code and refresh_token");
}

async function codeGrant(form: URLSearchParams, request: Request, storage: Repo): Promise<TokenResponse> {
  const presented = form.get("code") ?? "";
  const verifier = form.get("code_verifier") ?? "";
  if (!presented) throw new OauthError("invalid_request", "code is required");
  if (!verifier) throw new OauthError("invalid_request", "code_verifier is required: this server only accepts PKCE");
  // Claimed before anything is checked, so that a wrong verifier burns the
  // code rather than leaving it on the table for the next guess.
  const code = await storage.connector.claimCode(tokenHash(presented));
  if (!code) throw new OauthError("invalid_grant", "That authorization code is not valid");
  if (code.expiresAt <= Date.now()) throw new OauthError("invalid_grant", "That authorization code has expired");

  const clientId = form.get("client_id") ?? "";
  // A public client has no secret, so the only thing tying the exchange to the
  // client that started it is the client id and the PKCE verifier. Both.
  if (clientId && clientId !== code.clientId) throw new OauthError("invalid_grant", "That code was issued to another client");
  const redirectUri = form.get("redirect_uri") ?? "";
  if (redirectUri && redirectUri !== code.redirectUri) throw new OauthError("invalid_grant", "redirect_uri does not match the authorization request");
  if (!pkceMatches(verifier, code.codeChallenge)) throw new OauthError("invalid_grant", "The code verifier does not match the challenge");

  const asked = form.get("resource");
  if (!resourceIsOurs(request, asked)) throw new OauthError("invalid_target", "This server can only issue tokens for its own MCP endpoint");

  const grant = await storage.connector.grant(code.grantId);
  // Revoked between consent and exchange. Rare, and the honest answer is the
  // same one a revoked refresh token gets: start again.
  if (!grant) throw new OauthError("invalid_grant", "That authorization has been revoked");
  return await issuePair(grant, code.scopes, mcpResource(request), storage);
}

async function refreshGrant(form: URLSearchParams, request: Request, storage: Repo): Promise<TokenResponse> {
  const presented = form.get("refresh_token") ?? "";
  if (!presented) throw new OauthError("invalid_request", "refresh_token is required");
  const found = await storage.connector.byHash(tokenHash(presented));
  // Everything wrong with a refresh token is `invalid_grant` - unknown,
  // expired, already rotated, or the wrong kind of token presented here. The
  // client's only sane response to any of them is to start the flow again,
  // and a finer answer would only tell a guesser which of them it hit.
  if (!found || found.kind !== "refresh" || found.expiresAt <= Date.now() || !found.grantId) {
    throw new OauthError("invalid_grant", "That refresh token is not valid");
  }
  const grant = await storage.connector.grant(found.grantId);
  if (!grant) throw new OauthError("invalid_grant", "That authorization has been revoked");

  const asked = form.get("resource");
  if (!resourceIsOurs(request, asked)) throw new OauthError("invalid_target", "This server can only issue tokens for its own MCP endpoint");
  // A refresh may narrow what it carries but never widen it.
  const narrowed = form.get("scope");
  const scopes = narrowed ? askedScopes(narrowed).filter(s => found.scopes.includes(s)) : found.scopes;
  if (!scopes.length) throw new OauthError("invalid_scope", "A refresh cannot widen what the token already carried");

  const now = Date.now();
  const rotated = secret();
  // Rotation, in the one response that invalidates the old token: the spec
  // notes require it of public clients, and doing it in a single transaction
  // is what stops two concurrent refreshes both walking away with a token.
  const replaced = await storage.connector.rotate(tokenHash(presented), {
    hash: tokenHash(rotated), kind: "refresh", userId: grant.userId, scopes,
    grantId: grant._id, audience: mcpResource(request), createdAt: now, expiresAt: now + REFRESH_TTL_MS,
  });
  if (!replaced) throw new OauthError("invalid_grant", "That refresh token is not valid");

  const access = secret();
  await storage.connector.issue({
    hash: tokenHash(access), kind: "access", userId: grant.userId, scopes,
    grantId: grant._id, audience: mcpResource(request), createdAt: now, expiresAt: now + ACCESS_TTL_MS,
  });
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    scope: scopes.join(" "),
    refresh_token: rotated,
  };
}

/* ------------------------------------------------------ personal tokens */

/**
 * A personal access token, shown once.
 *
 * The fallback for everything that is not claude.ai: the MCP Inspector and
 * Claude Code can both send a fixed header, and Claude's own `static_headers`
 * is beta and limited to some organisations, so it cannot be the only way in
 * (docs/CONNECTOR_SPEC_NOTES.md §4). Only the hash is stored, which is why the
 * secret is returned here and nowhere else: there is no second chance to read
 * it, by design rather than by oversight.
 */
export async function createPersonalToken(
  user: User,
  name: unknown,
  storage: Repo = repo(),
): Promise<{ token: string; info: TokenInfo }> {
  const label = typeof name === "string" && name.trim() ? name.trim().slice(0, 60) : "Personal access token";
  const value = mintPersonal();
  const now = Date.now();
  const info = await storage.connector.issue({
    hash: tokenHash(value), kind: "personal", userId: user.id, scopes: [...DEFAULT_SCOPES],
    name: label, createdAt: now, expiresAt: now + PERSONAL_TTL_MS,
  });
  return { token: value, info };
}

/* -------------------------------------------------- presenting a token */

/**
 * The bearer credential on a request.
 *
 * `authorization: Bearer ...` first, then `x-api-key`, which is what the MCP
 * Inspector and a Claude Code header setting send. Never the query string: the
 * spec prohibits it, and a token in a URL is a token in access logs, proxy
 * logs and browser history (docs/CONNECTOR_SPEC_NOTES.md §4). There is
 * deliberately no fallback that reads one, so no later change can make the
 * query string work "just for testing".
 */
export function presentedToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (bearer) return bearer[1];
  const apiKey = request.headers.get("x-api-key")?.trim();
  return apiKey || null;
}

/** An identified credential: who it belongs to, how it was proved, what it carries. */
export interface VerifiedToken {
  userId: string;
  via: "oauth" | "token";
  scopes: string[];
}

/**
 * Verify a presented token, or answer `null` for "refuse this call".
 *
 * Four things have to hold, and the audience check is the one that is easy to
 * leave out: a token has to have been issued *for this server*. The spec
 * forbids token passthrough, so an access token minted elsewhere - or for
 * another deployment of this app - must not be accepted here just because it
 * is well formed and in our database shape.
 *
 * Revocation is checked on every call, by looking the grant up again rather
 * than trusting the token row to have been deleted. That is what makes
 * "disconnect" take effect on the very next request instead of whenever the
 * current access token would have expired.
 */
export async function verifyToken(
  presented: string,
  request: Request,
  storage: Repo = repo(),
): Promise<VerifiedToken | null> {
  const found = await storage.connector.byHash(tokenHash(presented));
  if (!found) return null;
  if (found.kind === "refresh") return null;
  if (found.expiresAt <= Date.now()) return null;
  if (found.audience && !resourceIsOurs(request, found.audience)) return null;
  if (found.kind === "access") {
    if (!found.grantId) return null;
    if (!(await storage.connector.grant(found.grantId))) return null;
    return { userId: found.userId, via: "oauth", scopes: found.scopes };
  }
  return { userId: found.userId, via: "token", scopes: found.scopes };
}
