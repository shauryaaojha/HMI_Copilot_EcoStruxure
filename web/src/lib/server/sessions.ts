import { createHash, randomBytes } from "node:crypto";
import { repo, type Repo } from "./repo";

export const SESSION_MAX_AGE = 8 * 60 * 60;
const CACHE_MS = 30_000;
const checked = new Map<string, number>();

/** Old cookies have no sid. Their Auth.js jti (or stable token fields) identifies the same copied cookie. */
export function sessionId(token: { sid?: unknown; jti?: unknown; sub?: unknown; iat?: unknown; exp?: unknown }): string {
  if (typeof token.sid === "string" && token.sid) return token.sid;
  const legacy = typeof token.jti === "string" ? token.jti : JSON.stringify([token.sub, token.iat, token.exp]);
  return `legacy:${createHash("sha256").update(legacy).digest("hex")}`;
}

export const newSessionId = () => randomBytes(24).toString("hex");

export async function validSession(id: string, version: number, sid: string, storage: Repo = repo()): Promise<boolean> {
  const key = `${id}:${version}:${sid}`;
  const now = Date.now();
  // A revocation on another instance may take up to 30 seconds to appear here.
  if ((checked.get(key) ?? 0) > now) return true;
  const valid = await storage.users.sessionValid(id, version, sid);
  if (valid) checked.set(key, now + CACHE_MS);
  return valid;
}

export async function revokeSession(id: string, sid: string, expiresAt: number, storage: Repo = repo()): Promise<void> {
  await storage.users.revokeSession(id, sid, expiresAt);
  clearAccountSessions(id);
}

export function clearAccountSessions(id: string): void {
  for (const key of checked.keys()) if (key.startsWith(`${id}:`)) checked.delete(key);
}
