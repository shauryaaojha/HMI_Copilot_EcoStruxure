/**
 * What the connector's authorization server has to remember: the clients that
 * registered themselves, the consent a user gave one of them, the short-lived
 * authorization codes in flight, and the tokens - OAuth and personal - that
 * an MCP call presents.
 *
 * Four rules shape every row here.
 *
 * Nothing is stored in a form that can be replayed. A token and a code are
 * kept as a SHA-256 hash of the secret, so a copy of this database is not a
 * set of working credentials. SHA-256 and not bcrypt: these are 256 bits of
 * `randomBytes`, not passwords, so there is no dictionary for a slow hash to
 * frustrate - and bcrypt at the cost `credentials.ts` uses would add a
 * quarter of a second to *every* MCP call, which is a latency bug we would
 * have inflicted on ourselves for no security.
 *
 * A row's `_id` is never the hash, except for codes. A personal token has to
 * be listed in account settings with something to revoke it by, and if that
 * handle were the hash then the settings page would be handing the browser
 * the one value that lets it be used. So tokens carry a random public `_id`
 * and the hash in an indexed field beside it. A code needs no public handle -
 * it is looked up once, by the client redeeming it - so there the hash is the
 * `_id`, which is also what makes "delete it as you read it" a single atomic
 * operation.
 *
 * Redemption is destructive. A code and a refresh token are both single-use:
 * read and removed in one transaction, so two requests racing on the same
 * secret cannot both succeed and a stolen one is worth nothing once the
 * legitimate client has used it (RFC 6749 §10.5, and the rotation the spec
 * notes require of public clients - docs/CONNECTOR_SPEC_NOTES.md §3).
 *
 * Revocation is by grant, not only by token. One consent produces a chain of
 * access and refresh tokens over its lifetime, so "disconnect Claude" has to
 * mean the chain and not the last link. Removing the grant row removes every
 * token that carries its id, and validation looks the grant up again on each
 * call, so a revocation lands on the very next request rather than whenever
 * the current access token happened to expire.
 */
import { randomBytes } from "node:crypto";
import { ServerError } from "./errors";
import type { Data, Row } from "./storage";

/** How many expired rows one write also tidies away; see `attempts.hit` for the same bargain. */
const SWEEP = 50;

/**
 * A client that registered itself through RFC 7591. There is no secret:
 * Claude registers as a public client and proves itself with PKCE instead
 * (docs/CONNECTOR_SPEC_NOTES.md §3), so a column for one would only invite a
 * later reader to check it.
 */
export type OauthClient = Row & {
  clientId: string;
  clientName: string;
  /** Exactly what was registered. Matching is exact, bar the loopback port; see lib/server/oauth.ts. */
  redirectUris: string[];
  createdAt: number;
};

/** An authorization code in flight. The `_id` is the code's hash. */
export type AuthCodeFields = {
  clientId: string;
  userId: string;
  grantId: string;
  /** The one this code was issued against; the token request must repeat it. */
  redirectUri: string;
  /** The S256 challenge. PKCE is required, so this is never absent. */
  codeChallenge: string;
  scopes: string[];
  /** The `resource` the client named (RFC 8707), carried onto the token's audience. */
  resource?: string;
  expiresAt: number;
};
export type AuthCode = Row & AuthCodeFields;

/**
 * One consent, by one user, to one client. This is the row account settings
 * calls a connection, and the row whose removal revokes everything issued
 * under it.
 */
export type ConnectorGrantFields = {
  userId: string;
  clientId: string;
  clientName: string;
  /**
   * The host of the redirect URI the user saw and approved. Kept because the
   * consent screen is required to show it and settings should show the same
   * thing later - a connection the user cannot recognise is one they cannot
   * decide about.
   */
  redirectHost: string;
  scopes: string[];
  resource?: string;
  createdAt: number;
};
export type ConnectorGrant = Row & ConnectorGrantFields;

/**
 * A bearer credential, as the hash of the secret that was handed out once.
 *
 * `kind` is both the lifetime and the provenance: `personal` is a token the
 * engineer made in settings and pasted into a header, `access` and `refresh`
 * belong to a grant. `audience` is what the token was issued for, so a call
 * can be refused unless it arrived at the server named in it - the spec
 * forbids passing a token on to anywhere else (docs/CONNECTOR_SPEC_NOTES.md
 * §3).
 */
export type ConnectorTokenFields = {
  hash: string;
  kind: "access" | "refresh" | "personal";
  userId: string;
  scopes: string[];
  grantId?: string;
  audience?: string;
  /** What the engineer called a personal token, so they can tell two apart. */
  name?: string;
  createdAt: number;
  expiresAt: number;
};
export type ConnectorToken = Row & ConnectorTokenFields;

/**
 * A token as anything outside the repository may see it: no hash, ever.
 *
 * Spelled out rather than derived with `Omit`, because `Row` carries an index
 * signature and `Omit` over one collapses every named field back into it -
 * which would have made `hash` a legal property of this type again, in the one
 * type whose whole purpose is that it cannot be.
 */
export type TokenInfo = {
  id: string;
  kind: ConnectorToken["kind"];
  userId: string;
  scopes: string[];
  grantId?: string;
  audience?: string;
  name?: string;
  createdAt: number;
  expiresAt: number;
};

/** What `issue` is given; the id and the row shape are the repository's business. */
export type NewToken = ConnectorTokenFields;

export interface ConnectorRepo {
  registerClient(client: { clientName: string; redirectUris: string[] }): Promise<OauthClient>;
  client(clientId: string): Promise<OauthClient | null>;
  /** Store a code against its hash. Expired codes are swept on the way past. */
  putCode(hash: string, code: AuthCodeFields): Promise<void>;
  /** Redeem a code: returned and removed together, so it works exactly once. */
  claimCode(hash: string): Promise<AuthCodeFields | null>;
  putGrant(grant: ConnectorGrantFields): Promise<ConnectorGrant>;
  grant(id: string): Promise<ConnectorGrant | null>;
  /** The connections account settings lists, newest first. */
  grants(userId: string): Promise<ConnectorGrant[]>;
  issue(token: NewToken): Promise<TokenInfo>;
  /** The whole row, hash included: only `lib/server/oauth.ts` has a use for it. */
  byHash(hash: string): Promise<ConnectorToken | null>;
  /**
   * Replace one token with another in a single transaction - the rotation the
   * refresh grant owes a public client. `null` when the old hash was not
   * there, which the token endpoint must answer as `invalid_grant`.
   */
  rotate(oldHash: string, next: NewToken): Promise<TokenInfo | null>;
  /** The personal tokens account settings lists, newest first. */
  personal(userId: string): Promise<TokenInfo[]>;
  /** Revoke one token by its public id. False when it is not this user's. */
  revokeToken(userId: string, id: string): Promise<boolean>;
  /** Revoke a connection and everything issued under it. */
  revokeGrant(userId: string, grantId: string): Promise<boolean>;
}

/** Client ids are public and appear in URLs, so they are opaque and URL-safe. */
export const newClientId = () => `client_${randomBytes(16).toString("hex")}`;
const newGrantId = () => `grant_${randomBytes(12).toString("hex")}`;
const newTokenId = () => `tok_${randomBytes(12).toString("hex")}`;

/** Drop the hash in the one place every read passes through, as `profile` does for users. */
function info(row: ConnectorToken): TokenInfo {
  return {
    id: row._id, kind: row.kind, userId: row.userId, scopes: row.scopes, grantId: row.grantId,
    audience: row.audience, name: row.name, createdAt: row.createdAt, expiresAt: row.expiresAt,
  };
}

/** Remove a bounded number of rows whose time has passed. */
async function sweep(d: Data, table: string, now: number): Promise<void> {
  for (const stale of await d.list<Row>(table, { expiresAt: { $lte: now } }, { projection: { _id: 1 }, limit: SWEEP })) {
    await d.remove(table, stale._id);
  }
}

/**
 * The collection, built over whatever `BaseRepo` is storing into, so the
 * laptop store and the test store behave exactly as a deployment does.
 */
export function connectorRepo(tx: <T>(fn: (data: Data) => Promise<T>) => Promise<T>, now: () => number): ConnectorRepo {
  return {
    registerClient: client => tx(async d => {
      const id = newClientId();
      const row: OauthClient = { _id: id, clientId: id, clientName: client.clientName, redirectUris: client.redirectUris, createdAt: now() };
      await d.put("oauthClients", row);
      return row;
    }),
    client: clientId => tx(d => d.get<OauthClient>("oauthClients", clientId)),
    putCode: (hash, code) => tx(async d => {
      await sweep(d, "oauthCodes", now());
      await d.put("oauthCodes", { ...code, _id: hash });
    }),
    claimCode: hash => tx(async d => {
      const row = await d.get<AuthCode>("oauthCodes", hash);
      if (!row) return null;
      // Removed whether or not it turns out to be valid: a code that has been
      // offered once must never be worth offering again, and deciding that
      // here rather than in the caller means no error path can forget to.
      await d.remove("oauthCodes", hash);
      const { clientId, userId, grantId, redirectUri, codeChallenge, scopes, resource, expiresAt } = row;
      return { clientId, userId, grantId, redirectUri, codeChallenge, scopes, resource, expiresAt };
    }),
    putGrant: grant => tx(async d => {
      // Consenting again supersedes the last consent rather than sitting
      // beside it: two rows called "Claude" in account settings would leave
      // the engineer guessing which one to revoke, and the older chain of
      // tokens is exactly what re-authorising meant to replace.
      for (const old of await d.list<Row>("connectorGrants", { userId: grant.userId, clientId: grant.clientId }, { projection: { _id: 1 } })) {
        await d.remove("connectorGrants", old._id);
        for (const token of await d.list<Row>("connectorTokens", { grantId: old._id }, { projection: { _id: 1 } })) {
          await d.remove("connectorTokens", token._id);
        }
      }
      const row: ConnectorGrant = { ...grant, _id: newGrantId() };
      await d.put("connectorGrants", row);
      return row;
    }),
    grant: id => tx(d => d.get<ConnectorGrant>("connectorGrants", id)),
    grants: userId => tx(async d => d.list<ConnectorGrant>("connectorGrants", { userId }, { sort: { createdAt: -1 } })),
    issue: token => tx(async d => {
      await sweep(d, "connectorTokens", now());
      const row: ConnectorToken = { ...token, _id: newTokenId() };
      await d.put("connectorTokens", row);
      return info(row);
    }),
    byHash: hash => tx(async d => (await d.list<ConnectorToken>("connectorTokens", { hash }, { limit: 1 }))[0] ?? null),
    rotate: (oldHash, next) => tx(async d => {
      const [old] = await d.list<ConnectorToken>("connectorTokens", { hash: oldHash }, { limit: 1 });
      if (!old) return null;
      // One transaction, so two refreshes racing on the same token cannot both
      // come away with a new one: the loser finds the row already gone.
      await d.remove("connectorTokens", old._id);
      const row: ConnectorToken = { ...next, _id: newTokenId() };
      await d.put("connectorTokens", row);
      return info(row);
    }),
    personal: userId => tx(async d =>
      (await d.list<ConnectorToken>("connectorTokens", { userId, kind: "personal" }, { sort: { createdAt: -1 } })).map(info)),
    revokeToken: (userId, id) => tx(async d => {
      const row = await d.get<ConnectorToken>("connectorTokens", id);
      // A revoke that quietly succeeded on someone else's token would be the
      // worst kind of bug to find, so ownership is checked, not assumed.
      if (!row || row.userId !== userId) return false;
      await d.remove("connectorTokens", id);
      return true;
    }),
    revokeGrant: (userId, grantId) => tx(async d => {
      const row = await d.get<ConnectorGrant>("connectorGrants", grantId);
      if (!row || row.userId !== userId) return false;
      await d.remove("connectorGrants", grantId);
      for (const token of await d.list<Row>("connectorTokens", { grantId }, { projection: { _id: 1 } })) {
        await d.remove("connectorTokens", token._id);
      }
      return true;
    }),
  };
}

/** What a caller is told when it asks to revoke something that is not theirs. */
export const notRevocable = () => new ServerError(404, "not-found", "That connection or token no longer exists");
