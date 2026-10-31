/**
 * How often a caller may try something that costs more than a page view: sign
 * in, make an account, or start a generation job.
 *
 * The counters live in the repository, with everything else that has to
 * survive: a deployed instance is a serverless function, so a counter in a
 * module variable is both private to one instance and forgotten the moment
 * that instance is recycled - which is no limit at all against someone who
 * keeps asking. The repository already gives us a transaction per increment,
 * which is what makes a count under concurrency mean anything.
 *
 * Two keys for signing in, counted separately, because they stop two
 * different things:
 *
 *   - per email, 10 attempts per 15 minutes. An engineer who has forgotten
 *     which password they used tries three or four; ten is well clear of that
 *     and far below the thousands a guessing run needs.
 *   - per IP, 50 attempts per 15 minutes. Higher on purpose: a plant office
 *     leaves one address for everybody, and a limit that locked out a whole
 *     site would be worse than the attack. It still caps one host spraying a
 *     common password across many addresses, which the per-email limit cannot
 *     see.
 *
 * Two more keys, for the same reason stated in money rather than in guessing.
 * A `generate` job is a paid model call followed by a whole-application layout
 * (lib/mcp/generate.ts), and a connector can ask for one in a loop without a
 * person noticing:
 *
 *   - per user, 10 jobs per 15 minutes. An engineer correcting a brief and
 *     asking again does that three or four times; ten leaves room and still
 *     caps one account's spend.
 *   - per project, 20 jobs per 15 minutes. Higher than one user's share, and
 *     deliberately lower than several users' - the project is what the bill is
 *     against, so four engineers on one application share a ceiling rather
 *     than each bringing their own.
 *
 * The window is fixed rather than sliding, so one small document per key is
 * the whole mechanism. The cost of that choice is a burst across a window
 * boundary - up to twice the limit in a moment - which is irrelevant at these
 * numbers and is why the limits are set by what a person does, not by what a
 * script can squeeze through.
 */
import { createHash } from "node:crypto";
import { repo, type Repo } from "./repo";
import { ServerError } from "./errors";

export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const ATTEMPTS_PER_EMAIL = 10;
export const ATTEMPTS_PER_IP = 50;
export const GENERATES_PER_USER = 10;
export const GENERATES_PER_PROJECT = 20;

/**
 * What a counter counts. The scope is part of the key, so two policies cannot
 * collide on one value - a user id and a project id are both opaque strings.
 */
export type LimitScope = "email" | "ip" | "generate-user" | "generate-project";

/**
 * The address a request came from. Vercel sets `x-forwarded-for`, and the
 * client's own address is its first entry; the rest are proxies. Nothing here
 * trusts the header for authority, only for grouping attempts, so a forged
 * value divides an attacker's own allowance rather than anyone else's.
 */
export function clientIp(request?: Request | null): string {
  const header = request?.headers.get("x-forwarded-for") ?? request?.headers.get("x-real-ip") ?? "";
  return header.split(",")[0].trim() || "unknown";
}

/**
 * The counter's key. Hashed because this table would otherwise accumulate the
 * email addresses of people who merely mistyped one - including addresses that
 * have no account here - and a counter needs no more than to tell two callers
 * apart.
 */
function attemptKey(scope: LimitScope, value: string): string {
  return `${scope}:${createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32)}`;
}

/**
 * Count one attempt and refuse when the window is already full. Throws 429
 * with the seconds until the window resets, so a caller can say when to come
 * back without being told anything about the account it asked for.
 */
export async function countAttempt(scope: LimitScope, value: string, max: number, storage: Repo = repo()): Promise<void> {
  const key = attemptKey(scope, value);
  const { count, resetAt } = await storage.attempts.hit(key, ATTEMPT_WINDOW_MS);
  if (count > max) {
    const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
    throw new ServerError(429, "too-many-attempts", "Too many attempts. Try again later.", { retryAfter });
  }
}

/** Forget an email's failures once it has been used successfully. */
export async function clearAttempts(scope: LimitScope, value: string, storage: Repo = repo()): Promise<void> {
  await storage.attempts.clear(attemptKey(scope, value));
}
