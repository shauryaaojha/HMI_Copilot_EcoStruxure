/**
 * Share links as capabilities.
 *
 * A link is a random 32-byte token in a URL. The repository keeps only its
 * SHA-256, so the link works for whoever holds it and for nobody who merely
 * reads the database. A signed-in visitor who opens a link becomes a member
 * with its role; a signed-out visitor with a viewer link gets read access
 * through the `hmi_share` cookie, for that one project only. Commenting and
 * editing need a name on them, so those links ask the visitor to sign in.
 */
import { createHash, randomBytes } from "node:crypto";
import { repo, type Repo, type Role, type Share, type ShareRole } from "./repo";
import { ServerError } from "./errors";

/** The cookie a signed-out viewer link sets. */
export const SHARE_COOKIE = "hmi_share";
/** Tokens remembered in the cookie, so a visitor can hold links to a few projects. */
const COOKIE_TOKENS = 8;
export const DEFAULT_SHARE_DAYS = 14;
export const MAX_SHARE_DAYS = 90;

/** A fresh link token: 32 random bytes, URL-safe. */
export function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What the repository stores and looks a token up by. */
export function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A token is base64url of 32 bytes; anything else is not worth hashing. */
export function plausibleToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** The share tokens a request carries in its cookie, oldest first. */
export function shareTokens(request?: Request | null): string[] {
  const header = request?.headers.get("cookie");
  if (!header) return [];
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== SHARE_COOKIE) continue;
    return decodeURIComponent(rest.join("=")).split(".").filter(plausibleToken);
  }
  return [];
}

/**
 * The Set-Cookie value that adds one token to those already held. HttpOnly so
 * page scripts never see it; SameSite=Lax so it rides top-level navigation.
 */
export function shareCookie(request: Request, token: string): string {
  const tokens = [...shareTokens(request).filter(t => t !== token), token].slice(-COOKIE_TOKENS);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SHARE_COOKIE}=${tokens.join(".")}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_SHARE_DAYS * 24 * 60 * 60}${secure}`;
}

/** A link as the browser sees it: the hash is its id, and there is no token. */
export function shareInfo(share: Share) {
  const { _id, ...rest } = share;
  return { id: _id, ...rest };
}

/** Days until expiry from a request body: default 14, between 1 and 90. */
export function shareDays(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_SHARE_DAYS;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ServerError(400, "invalid", "Expiry is a number of days");
  return Math.min(MAX_SHARE_DAYS, Math.max(1, Math.round(value)));
}

/** Create a link and hand back the only copy of its token. */
export async function createShare(
  projectId: string,
  createdBy: string,
  options: { role: ShareRole; days?: unknown; allowExport?: unknown },
  storage: Repo = repo(),
) {
  const token = newShareToken();
  const allowExport = typeof options.allowExport === "boolean" ? options.allowExport : options.role !== "viewer";
  const share = await storage.shares.create({
    _id: hashShareToken(token),
    projectId,
    role: options.role,
    createdBy,
    days: shareDays(options.days),
    allowExport,
  });
  return { share, token, url: `/s/${token}` };
}

export type ShareInspection =
  | { status: "ok"; share: { projectId: string; role: ShareRole; expiresAt: number; allowExport: boolean } }
  | { status: "expired" | "revoked" | "missing" };

/** What the /s/<token> page needs to know before deciding what to show. */
export async function inspectShare(token: string, storage: Repo = repo()): Promise<ShareInspection> {
  if (!plausibleToken(token)) return { status: "missing" };
  const { state, share } = await storage.shares.check(hashShareToken(token));
  if (state !== "ok" || !share) return { status: state === "ok" ? "missing" : state };
  return { status: "ok", share: { projectId: share.projectId, role: share.role, expiresAt: share.expiresAt, allowExport: share.allowExport } };
}

/** A signed-in visitor opened a link: make them a member, never a lesser one. */
export async function joinShare(token: string, user: { id: string; name: string }, storage: Repo = repo()): Promise<{ projectId: string; role: Role }> {
  if (!plausibleToken(token)) throw new ServerError(404, "not-found", "This link does not exist");
  return storage.shares.join(hashShareToken(token), user.id);
}

/**
 * The live shares among a request's cookie tokens that point at one project.
 * Signed-out access is viewer-only by construction, but the role is checked
 * here too: a cookie must never grant more than reading.
 */
export async function cookieShares(projectId: string, tokens: string[], storage: Repo = repo()) {
  const found = [];
  for (const token of tokens) {
    const { state, share } = await storage.shares.check(hashShareToken(token));
    if (state !== "ok" || !share || share.projectId !== projectId) continue;
    if (share.role !== "viewer") continue;
    found.push(share);
  }
  return found;
}
