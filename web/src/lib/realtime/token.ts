/**
 * Short-lived Realtime tokens, minted on the server for one project.
 *
 * The browser never sees the JWT secret or the service-role key. It asks for a
 * token, the server decides whether this person may read this project - in
 * MongoDB, through the same `requireReader` every other route uses - and signs
 * a token that says so. The token expires in minutes, so revoking access is a
 * matter of not minting the next one.
 *
 * ## Why the authorization is a claim and not a table
 *
 * Supabase's documented pattern for private channels is an RLS policy on
 * `realtime.messages` that joins a table of memberships. We have no such
 * table: decisions 1 and 3 put Supabase on Realtime only and keep every row,
 * membership included, in MongoDB. So the membership check happens here, at
 * mint time, and its result travels in the token as a claim. The policy then
 * compares the topic being joined to that claim:
 *
 * ```sql
 * create policy "a token may only join the topic it names"
 * on realtime.messages for select to authenticated
 * using ( realtime.topic() = (auth.jwt() ->> 'project_topic') );
 *
 * create policy "a token may only broadcast on the topic it names"
 * on realtime.messages for insert to authenticated
 * with check ( realtime.topic() = (auth.jwt() ->> 'project_topic') );
 * ```
 *
 * A non-member never gets a token, so they never get a topic claim, so the
 * policy refuses the join. That is the property to test with a second account
 * once a Supabase project exists.
 *
 * `aud` and `role` are not decoration: Realtime reads them to assume a
 * database role before evaluating the policy, and a token without them is
 * refused before any policy runs.
 *
 * ## What this does not depend on
 *
 * Not the NextAuth mechanism. Decision A chooses how a person signs in;
 * `currentUser()` returns the same `{ id }` afterwards whichever way that was,
 * and the id is all this needs. Credentials, a magic link or anything else can
 * be chosen later without touching this file.
 */

import { SignJWT } from "jose";
import { serverConfig, topicFor } from "./config";

/** Long enough to join a channel and reconnect once; short enough to expire. */
export const TOKEN_TTL_SECONDS = 15 * 60;

export interface MintedToken {
  token: string;
  topic: string;
  /** Seconds from now, so the client can refresh before it lapses. */
  expiresIn: number;
  url: string;
  anonKey: string;
}

/**
 * Sign a token for one person on one project.
 *
 * The caller has already decided that this person may read this project;
 * nothing here re-checks it, and nothing here should be called before that
 * decision is made.
 */
export async function mintRealtimeToken(userId: string, projectId: string): Promise<MintedToken | null> {
  const config = serverConfig();
  if (!config) return null;

  const topic = topicFor(projectId);
  const secret = new TextEncoder().encode(config.jwtSecret);
  const token = await new SignJWT({
    // Realtime needs these two to assume a role before the policy runs.
    role: "authenticated",
    // The one topic this token may join, read back by the policy above.
    project_topic: topic,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(secret);

  return { token, topic, expiresIn: TOKEN_TTL_SECONDS, url: config.url, anonKey: config.anonKey };
}
