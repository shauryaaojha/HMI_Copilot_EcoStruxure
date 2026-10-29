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

/** The browser needs these two; both are public by design. */
export interface PublicRealtimeConfig {
  url: string;
  anonKey: string;
}

/**
 * The service-role key and the JWT secret are read here and never leave the
 * server. A browser gets a short-lived token minted from them, scoped to one
 * project, and never the secret itself.
 */
export interface ServerRealtimeConfig extends PublicRealtimeConfig {
  jwtSecret: string;
}

const trim = (value: string | undefined) => {
  const text = (value ?? "").trim();
  return text.length > 0 ? text : undefined;
};

export function publicConfig(): PublicRealtimeConfig | null {
  const url = trim(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = trim(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return url && anonKey ? { url, anonKey } : null;
}

/**
 * Server-side configuration, or null when Realtime is not set up.
 *
 * Returns null rather than throwing: a deployment with no Supabase project is
 * a supported state, not an error, and the caller falls back to SSE.
 */
export function serverConfig(): ServerRealtimeConfig | null {
  const base = publicConfig();
  const jwtSecret = trim(process.env.SUPABASE_JWT_SECRET);
  return base && jwtSecret ? { ...base, jwtSecret } : null;
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
