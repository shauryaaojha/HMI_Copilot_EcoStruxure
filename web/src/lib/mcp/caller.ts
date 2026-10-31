/**
 * Who is calling the MCP server.
 *
 * This is deliberately an interface and one resolver, not a sprinkling of
 * `auth()` calls through the tools. A connector call can arrive carrying an
 * OAuth access token (claude.ai), a personal access token (the MCP Inspector,
 * Claude Code), or - on a laptop - nothing but the browser session that is
 * already signed in. All three answer the same question: which user id is
 * this, so that `lib/server/access.ts` can say what they may do. Adding a
 * fourth way to prove identity must not touch a single tool.
 *
 * So the division of labour is: `resolveCaller` decides *who*; `access.ts`
 * decides *what they may do*. No tool is allowed its own opinion on
 * permissions, because the web app and the connector disagreeing about a role
 * is exactly the failure the single write path was built to prevent
 * (docs/PLAN_FULL_ARCHITECTURE.md §2.1).
 *
 * The credential half is `lib/server/oauth.ts`: our own authorization server,
 * which issues the OAuth tokens claude.ai presents and the personal access
 * tokens everything else uses. This file is the join, and nothing but this
 * file had to change to add them.
 */
import { presentedToken, verifyToken } from "@/lib/server/oauth";
import { repo, type User } from "@/lib/server/repo";
import { currentUser } from "@/lib/server/session";

/**
 * One identified caller of the MCP server.
 *
 * `userId` is the only field the role checks use; the rest is for the audit
 * trail, which records a name beside every proposal and decision, and for a
 * future scope check. A token narrower than the user's own access carries its
 * scopes here rather than being resolved into a role, because a role is the
 * project's answer and a scope is the credential's.
 */
export interface Caller {
  /** The user id every check in `lib/server/access.ts` is made against. */
  userId: string;
  /** Shown beside the Copilot's work in the proposal queue and sign-off log. */
  name: string;
  email?: string | null;
  /** How identity was proved, for the audit line on a write. */
  via: "session" | "oauth" | "token" | "dev-env";
  /**
   * Scopes the credential carried, when it carried any. Empty or absent means
   * "no narrowing": the caller may do whatever their project role allows.
   */
  scopes?: string[];
}

/** The caller as the role matrix takes them. */
export const callerUser = (caller: Caller): User => ({
  id: caller.userId,
  name: caller.name,
  email: caller.email ?? null,
});

/** Where Claude is told to look for the resource metadata (RFC 9728). */
export const RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

/**
 * The bearer-credential seam.
 *
 * An OAuth access token or a personal access token arrives in `authorization`
 * or `x-api-key`; never in the query string, which the spec prohibits and
 * which would put a token in logs, proxies and browser history
 * (docs/CONNECTOR_SPEC_NOTES.md §4). What makes a token good is
 * `verifyToken`: it must exist, not have expired, still have a live grant
 * behind it, and have been issued for *this* server - token passthrough is
 * forbidden, so a well-formed token minted somewhere else is no better than
 * none.
 *
 * Anything that does not verify resolves to nobody, and the route answers 401
 * with the pointer that starts the OAuth dance. Inventing a user from an
 * unverified header would be the one failure mode worse than refusing a
 * legitimate caller.
 */
export async function callerFromCredential(request: Request): Promise<Caller | null> {
  const presented = presentedToken(request);
  if (!presented) return null;
  const verified = await verifyToken(presented, request);
  if (!verified) return null;
  // The profile is for the audit line beside a proposal, so a missing one is
  // not a reason to refuse a verified token: the user id is what every access
  // check is made against, and it came from the token, not from the lookup.
  const user = await repo().users.get(verified.userId);
  return {
    userId: verified.userId,
    name: user?.name ?? "Connector",
    email: user?.email ?? null,
    via: verified.via,
    scopes: verified.scopes,
  };
}

/**
 * The laptop escape hatch for the MCP Inspector.
 *
 * The Inspector has no account on this app, and standing up the whole OAuth
 * server before the first tool can be tried would invert the order of work.
 * `MCP_DEV_USER_ID` names a user id to act as. It is refused outright on a
 * deployment: `session.ts` already makes the point that the laptop's implicit
 * identity must never be inherited by a public deployment, and a connector
 * that could be made to act as any user by setting one environment variable
 * would be a far worse version of the same mistake.
 */
function devCaller(): Caller | null {
  const id = process.env.MCP_DEV_USER_ID?.trim();
  if (!id) return null;
  if (process.env.VERCEL || process.env.NODE_ENV === "production") return null;
  return { userId: id, name: process.env.MCP_DEV_USER_NAME?.trim() || "MCP Inspector", via: "dev-env" };
}

/**
 * The request's caller, or `null` for "answer 401".
 *
 * Order matters: an explicit credential wins over an ambient browser session,
 * so a signed-in engineer testing someone else's token sees that token's
 * access and not their own.
 */
export async function resolveCaller(request: Request): Promise<Caller | null> {
  const credential = await callerFromCredential(request);
  if (credential) return credential;
  const user = await currentUser();
  if (user) return { userId: user.id, name: user.name, email: user.email ?? null, via: "session" };
  return devCaller();
}
