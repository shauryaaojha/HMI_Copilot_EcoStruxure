/**
 * Where Supabase Realtime is configured, and whether it is on at all.
 *
 * Supabase is used for exactly one thing: live sync. No Postgres, no Storage,
 * no Auth (docs/PLAN_FULL_ARCHITECTURE.md §0). The project's data, including
 * membership, stays in MongoDB, which is why the channel authorization in
 * `token.ts` is a signed claim rather than a row in a Supabase table.
 *
 * Everything is behind a flag. With no keys set, `realtimeEnabled()` is false,
 * the collaboration session keeps using the server-sent-events transport it
 * has always used, and nothing in this folder runs. That is what lets the
 * suite pass on a machine that has never seen a Supabase project.
 */

/**
 * The browser needs these two; both are public by design.
 *
 * `anonKey` is the project's publishable key (`sb_publishable_...`), or the
 * legacy JWT `anon` key on a project that still uses it. Supabase retires the
 * legacy keys at the end of 2026, so the publishable key is read first.
 */
export interface PublicRealtimeConfig {
  url: string;
  anonKey: string;
}

/**
 * How the server signs a Realtime token.
 *
 * Supabase's JWT signing keys cannot be read back out of the dashboard, so a
 * server that mints its own tokens imports a private key of its own as a
 * signing key (docs/REALTIME_SETUP.md §3): `SUPABASE_JWT_PRIVATE_KEY`, an
 * ES256 private JWK whose `kid` Supabase verifies against. The legacy shared
 * `SUPABASE_JWT_SECRET` (HS256) still works on projects that have it, and is
 * only read when no private key is set.
 */
export type RealtimeSigning =
  | { alg: "ES256"; jwk: EcPrivateJwk }
  | { alg: "HS256"; secret: string };

/** The fields of an ES256 private JWK that signing needs. */
export interface EcPrivateJwk {
  kty: "EC";
  crv: "P-256";
  kid: string;
  x: string;
  y: string;
  d: string;
}

/**
 * The secret key and the signing key are read here and never leave the
 * server. A browser gets a short-lived token minted from them, scoped to one
 * project, and never the key itself.
 */
export interface ServerRealtimeConfig extends PublicRealtimeConfig {
  signing: RealtimeSigning;
}

const trim = (value: string | undefined) => {
  const text = (value ?? "").trim();
  return text.length > 0 ? text : undefined;
};

export function publicConfig(): PublicRealtimeConfig | null {
  // Both names spelled out in full: Next inlines a NEXT_PUBLIC_ variable into
  // the browser bundle only where it is read literally.
  const url = trim(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = trim(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ?? trim(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return url && anonKey ? { url, anonKey } : null;
}

/**
 * The private JWK from `SUPABASE_JWT_PRIVATE_KEY`, or null when it is absent
 * or is not an ES256 private key with a `kid`. A malformed value is treated as
 * absent rather than thrown, so a bad deployment variable turns Realtime off
 * (the session falls back to the event stream) instead of failing requests.
 */
export function privateJwk(raw = process.env.SUPABASE_JWT_PRIVATE_KEY): EcPrivateJwk | null {
  const text = trim(raw);
  if (!text) return null;
  try {
    const jwk = JSON.parse(text) as Partial<EcPrivateJwk>;
    const ok = jwk.kty === "EC" && jwk.crv === "P-256" && [jwk.kid, jwk.x, jwk.y, jwk.d].every((v) => typeof v === "string" && v.length > 0);
    return ok ? (jwk as EcPrivateJwk) : null;
  } catch {
    return null;
  }
}

/** The configured way to sign, preferring the imported private key. */
export function signingConfig(): RealtimeSigning | null {
  const jwk = privateJwk();
  if (jwk) return { alg: "ES256", jwk };
  const secret = trim(process.env.SUPABASE_JWT_SECRET);
  return secret ? { alg: "HS256", secret } : null;
}

/**
 * The server's API key for publishing: the secret key (`sb_secret_...`), or
 * the legacy `service_role` key on a project that still uses it.
 */
export function secretApiKey(): string | null {
  return trim(process.env.SUPABASE_SECRET_KEY) ?? trim(process.env.SUPABASE_SERVICE_ROLE_KEY) ?? null;
}

/**
 * Server-side configuration, or null when Realtime is not set up.
 *
 * Returns null rather than throwing: a deployment with no Supabase project is
 * a supported state, not an error, and the caller falls back to SSE.
 */
export function serverConfig(): ServerRealtimeConfig | null {
  const base = publicConfig();
  const signing = signingConfig();
  return base && signing ? { ...base, signing } : null;
}

/** True when a browser should try Realtime instead of the event stream. */
export function realtimeEnabled(): boolean {
  return publicConfig() !== null;
}

/**
 * The channel a project talks on.
 *
 * One topic per project, named so that a policy can compare it to the claim
 * in the token without parsing anything. The `project:` prefix keeps the
 * namespace open for a second kind of topic later.
 */
export const topicFor = (projectId: string): string => `project:${projectId}`;

/**
 * What a revision broadcast carries, and all it carries.
 *
 * Not the ops. Supabase's Free plan caps one message at 256 KB and a batch of
 * ops can exceed that, so a broadcast is a notification that something landed
 * and the client fetches the changes themselves over HTTP
 * (docs/PLAN_FULL_ARCHITECTURE.md §2.3). It is also why a client never
 * resolves a conflict from a broadcast: the Mongo transaction already decided
 * who won, and this is only the hint to go and look.
 */
export interface RevisionNotice {
  projectId: string;
  rev: number;
  author: string | null;
}

export const REVISION_EVENT = "revision";

/**
 * A proposal was made or decided: a hint to fetch the list, for the same size
 * reason as a revision. An agent step goes whole: it is one line of text, and
 * only the run's own requester shows it (docs/audit/BUGS.md S4-22).
 */
export const PROPOSAL_EVENT = "proposal";
export const AGENT_EVENT = "agent";
export interface AgentNotice {
  holder: string;
  screenId: string;
  at: number;
  kind: string;
  message: string;
  released: boolean;
}
