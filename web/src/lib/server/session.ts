/**
 * The single identity boundary for API code. No OAuth configuration on a
 * laptop means one local engineer; on a public deployment it means anonymous
 * browser-only use. In particular, deployment must never inherit the laptop's
 * implicit identity. Auth.js is loaded only when providers are configured.
 */
import type { User } from "./repo";
import { ServerError } from "./errors";
/** Only complete provider configurations enable account sign-in. */
export function providers(): string[] {
  return ["github", "google"].filter(p => process.env[`AUTH_${p.toUpperCase()}_ID`]?.trim() && process.env[`AUTH_${p.toUpperCase()}_SECRET`]?.trim());
}
/** A laptop can persist locally; deployments require configured identities. */
export function cloudEnabled(): boolean { return providers().length > 0 || !process.env.VERCEL; }
/** Fail closed when provider sessions cannot be signed. */
export function checkAuthConfig() {
  if (providers().length && !process.env.AUTH_SECRET?.trim()) throw new ServerError(503, "configuration", "AUTH_SECRET is required when an authentication provider is enabled");
}
/** Keep the implicit laptop identity out of public deployments. */
export async function currentUser(): Promise<User | null> {
  if (!providers().length) return process.env.VERCEL ? null : { id: "local", name: "Local engineer" };
  checkAuthConfig();
  const session = await (await import("@/auth")).auth();
  return session?.user?.id ? { id: session.user.id, email: session.user.email, name: session.user.name ?? "Engineer", image: session.user.image } : null;
}
