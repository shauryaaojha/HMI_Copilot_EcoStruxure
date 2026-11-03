/**
 * Email and password: the only way into an account (decision A in
 * docs/PLAN_FULL_ARCHITECTURE.md). There is no third-party sign-in and no
 * mail vendor, so everything an account needs is in this repository's own
 * database.
 *
 * Two functions are the whole surface, and server code outside Auth.js is
 * meant to call them directly: `signUp` makes an account, `verifyPassword`
 * answers whether an address and a password belong together. Auth.js is one
 * caller of `verifyPassword`, not the owner of it - the connector's own
 * authorization server needs the same answer without a browser form.
 *
 * On telling people apart: sign-in gives one answer for an address that has no
 * account and for the wrong password, and takes the same time over both, so it
 * cannot be used to ask who is registered here. Sign-up cannot hide the same
 * thing - refusing a taken address is the refusal - so it is rate-limited by
 * address and by IP like sign-in is, and its message never states that the
 * address is registered: it says the address cannot be used, and points at
 * signing in. Hiding it properly needs a confirmation email, and a mail vendor
 * is exactly what decision 1 keeps out.
 */
import { compare, hash } from "bcryptjs";
import { randomBytes } from "node:crypto";
import { repo, type Repo, type User } from "./repo";
import { ServerError } from "./errors";
import { checkAuthConfig } from "./session";
import { ATTEMPTS_PER_EMAIL, ATTEMPTS_PER_IP, clearAttempts, clientIp, countAttempt } from "./rate-limit";

/**
 * bcrypt's cost, as a power of two. Twelve is around a quarter of a second on
 * the hardware a Vercel function gets, which an engineer signing in does not
 * notice and a guessing run very much does. It is stored in the hash, so
 * raising it later leaves existing accounts working.
 */
const COST = 12;
/** Ten is long enough that the rate limits above do the rest of the work. */
export const MIN_PASSWORD = 10;
/**
 * bcrypt hashes the first 72 bytes and silently ignores the rest, so a longer
 * password would be weaker than it looks. Refusing is honest; truncating is
 * the bug that has been found in other people's login forms.
 */
export const MAX_PASSWORD_BYTES = 72;

/**
 * One address, one account. The domain is case-insensitive by the standard and
 * the local part is not, but no mail provider anyone here uses treats `A@` and
 * `a@` as two mailboxes, and a sign-in that depends on which capitals were
 * typed is a support call. So the whole address folds to lower case.
 */
export function normalizeEmail(value: unknown): { email: string; emailKey: string } {
  const email = typeof value === "string" ? value.trim() : "";
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email) || email.length > 254) {
    throw new ServerError(400, "invalid", "Enter an email address");
  }
  return { email, emailKey: email.toLowerCase() };
}

/** The password rules, applied before anything is hashed or stored. */
function checkPassword(value: unknown): string {
  const password = typeof value === "string" ? value : "";
  if (password.length < MIN_PASSWORD) throw new ServerError(400, "weak-password", `Use at least ${MIN_PASSWORD} characters`);
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) throw new ServerError(400, "weak-password", `Use at most ${MAX_PASSWORD_BYTES} bytes`);
  return password;
}

/** A display name is for other members to read; the address is the identity. */
function displayName(value: unknown, email: string): string {
  const name = typeof value === "string" ? value.trim().slice(0, 100) : "";
  return name || email.split("@")[0];
}

/**
 * A hash nobody's password produces, used to spend the same time on an address
 * with no account as on one with the wrong password. Minted once per process
 * from random bytes rather than written down here, so there is no constant in
 * the repository that looks like a credential.
 */
let absent: string | undefined;
async function spendTheSameTime(password: string): Promise<void> {
  absent ??= await hash(randomBytes(16).toString("hex"), COST);
  await compare(password, absent);
}

/** Make an account. Returns the new user's profile; the hash never leaves here. */
export async function signUp(
  input: { email?: unknown; password?: unknown; name?: unknown },
  request?: Request | null,
  storage: Repo = repo(),
): Promise<User> {
  // An account that cannot be signed into is worse than no account, so refuse
  // before writing one rather than after.
  checkAuthConfig();
  const { email, emailKey } = normalizeEmail(input.email);
  const password = checkPassword(input.password);
  await countAttempt("ip", clientIp(request), ATTEMPTS_PER_IP, storage);
  await countAttempt("email", emailKey, ATTEMPTS_PER_EMAIL, storage);
  const user = await storage.users.create({ email, emailKey, passwordHash: await hash(password, COST), name: displayName(input.name, email) });
  await clearAttempts("email", emailKey, storage);
  return user;
}

/**
 * Whether this address and password belong together, counted against both
 * limits first. `null` is every kind of no - unknown address, wrong password -
 * and a refusal to say which. A full window throws 429 instead, which is the
 * one thing a caller is told, and it says nothing about the account.
 */
export async function verifyPassword(
  email: unknown,
  password: unknown,
  request?: Request | null,
  storage: Repo = repo(),
): Promise<User | null> {
  checkAuthConfig();
  let emailKey: string;
  try { emailKey = normalizeEmail(email).emailKey; }
  catch { emailKey = typeof email === "string" ? email.trim().toLowerCase().slice(0, 254) : ""; }
  await countAttempt("ip", clientIp(request), ATTEMPTS_PER_IP, storage);
  await countAttempt("email", emailKey, ATTEMPTS_PER_EMAIL, storage);
  const found = emailKey ? await storage.users.credential(emailKey) : null;
  if (!found) { await spendTheSameTime(typeof password === "string" ? password : ""); return null; }
  if (!(typeof password === "string" && await compare(password, found.passwordHash))) return null;
  // A password that worked is proof the address belongs to whoever typed it,
  // so their earlier mistakes should not count against the next sign-in.
  await clearAttempts("email", emailKey, storage);
  return found.user;
}
