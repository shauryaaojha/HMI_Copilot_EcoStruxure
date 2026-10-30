/**
 * The parts of the Realtime acceptance check that can be reasoned about
 * without a Supabase project.
 *
 * `scripts/realtime-check.mts` is the script Shaurya runs once the project
 * exists: it proves that a member's token joins and hears a revision, that a
 * token minted for another project is refused on this one's topic, and that an
 * expired token is refused (docs/REALTIME_SETUP.md). None of that can run
 * here, because all three answers come from a real project.
 *
 * What can run here is everything around the three checks: which variables
 * must be set before the script has any chance of working, how a join's
 * outcome is decided from the statuses Realtime reports, how a result reads,
 * and what the process exits with. Those live in this file so they are tested
 * rather than discovered at 2 a.m. on the one machine that has the keys.
 */

import { SignJWT } from "jose";
import { topicFor } from "./config";

/** Every variable `scripts/realtime-check.mts` needs before it can start. */
export const CHECK_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_JWT_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

/** The names that are absent or blank, in the order they are documented. */
export function missingEnv(env: Record<string, string | undefined> = process.env): string[] {
  return CHECK_ENV.filter((name) => ((env[name] ?? "").trim().length === 0));
}

/**
 * What to print instead of a stack trace when the environment is incomplete.
 *
 * The script is run by hand, probably once, by someone who has just finished
 * setting up a Supabase project - so the message names what is missing and
 * where it comes from, and never asks the reader to interpret a thrown error.
 */
export function envComplaint(missing: string[]): string {
  return [
    `realtime:check needs ${missing.length} more environment variable${missing.length === 1 ? "" : "s"}:`,
    ...missing.map((name) => `  - ${name}`),
    "",
    "They are the same four the app uses. Put them in web/.env.local or export",
    "them in this shell; docs/REALTIME_SETUP.md says where each one is found in",
    "the Supabase dashboard.",
  ].join("\n");
}

/** One of the three things the script proves, and how it went. */
export interface CheckResult {
  name: string;
  ok: boolean;
  /** What happened, in a few words: the reason on a failure, the proof on a pass. */
  detail: string;
}

/** One printed line per check, so the whole run is three lines and a verdict. */
export function line(result: CheckResult): string {
  return `${result.ok ? "ok  " : "FAIL"}  ${result.name}: ${result.detail}`;
}

/** 0 only when all three passed; a missing check is a failure, not a pass. */
export function exitCode(results: CheckResult[], expected = 3): number {
  return results.length === expected && results.every((r) => r.ok) ? 0 : 1;
}

/** What a channel join can turn into. A timeout is its own answer: see `joinOutcome`. */
export type JoinOutcome = "joined" | "refused" | "timeout";

/** The little of a `RealtimeChannel` that deciding a join needs. */
export interface Joinable {
  subscribe(callback: (status: string) => void): unknown;
}

/**
 * Join a channel and answer with what Realtime made of it.
 *
 * A refusal arrives as `CHANNEL_ERROR` - that is what the policy refusing a
 * topic looks like from the client - and `TIMED_OUT` or `CLOSED` are counted
 * with it, because none of the three is a join. The timeout is separate on
 * purpose: "nothing came back" is a different finding from "it was refused",
 * and the check that expects a refusal should not be allowed to pass because
 * the network was slow.
 */
export function joinOutcome(channel: Joinable, timeoutMs: number, timers = globalThis): Promise<JoinOutcome> {
  return new Promise<JoinOutcome>((resolve) => {
    let settled = false;
    const done = (outcome: JoinOutcome) => {
      if (settled) return;
      settled = true;
      timers.clearTimeout(timer);
      resolve(outcome);
    };
    const timer = timers.setTimeout(() => done("timeout"), timeoutMs);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") done("joined");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") done("refused");
    });
  });
}

/**
 * A token that is correct in every way except that it has already expired.
 *
 * The third check needs one, and `mintRealtimeToken` cannot make it: it always
 * signs a live token, which is the only thing the app should ever be able to
 * do. Everything else matches a minted token claim for claim, so a refusal can
 * only be about the expiry.
 */
export async function expiredToken(secret: string, userId: string, projectId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: "authenticated", project_topic: topicFor(projectId) })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setAudience("authenticated")
    .setIssuedAt(now - 7200)
    .setExpirationTime(now - 3600)
    .sign(new TextEncoder().encode(secret));
}
