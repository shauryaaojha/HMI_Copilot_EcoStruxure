/**
 * The single identity boundary for API code. No sign-in configured on a laptop
 * means one local engineer; on a public deployment it means anonymous
 * browser-only use. In particular, deployment must never inherit the laptop's
 * implicit identity. Auth.js is loaded only when sign-in is configured.
 */
import type { User } from "./repo";
import { ServerError } from "./errors";
/**
 * Email and password is the only way into an account (decision A in
 * docs/PLAN_FULL_ARCHITECTURE.md), so there is no client id or redirect URI to
 * configure - what remains is the secret the session cookie is signed with.
 * `AUTH_SECRET` is therefore the switch: with it, this installation can hold
 * accounts; without it, Auth.js could not verify a cookie it had just written.
 * The list shape stays because the browser asks /api/me which ways in exist
 * before offering any of them.
 */
export function providers(): string[] {
  return process.env.AUTH_SECRET?.trim() ? ["credentials"] : [];
}
/** A laptop can persist locally; deployments require configured identities. */
export function cloudEnabled(): boolean { return providers().length > 0 || !process.env.VERCEL; }
/** Fail closed when sessions cannot be signed, rather than making an account nothing can use. */
export function checkAuthConfig() {
  if (!process.env.AUTH_SECRET?.trim()) throw new ServerError(503, "configuration", "AUTH_SECRET is required before accounts can be used");
}
/** Keep the implicit laptop identity out of public deployments. */
export async function currentUser(): Promise<User | null> {
  if (!providers().length) return process.env.VERCEL ? null : { id: "local", name: "Local engineer" };
  checkAuthConfig();
  const session = await (await import("@/auth")).auth();
  return session?.user?.id ? { id: session.user.id, email: session.user.email, name: session.user.name ?? "Engineer", image: session.user.image } : null;
}
