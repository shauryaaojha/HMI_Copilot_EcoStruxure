/**
 * S2-05 (docs/audit/BUGS.md), moved from web/scripts/audit/ with the fix.
 * S2-05: the per-email sign-in counter (src/lib/server/credentials.ts:119-120,
 * lib/server/rate-limit.ts:98-105) counts every attempt on an address from
 * anybody, and is checked before the password. Ten wrong guesses from a
 * stranger's address therefore lock the real owner out for 15 minutes, with
 * the right password, from their own address - and 11 requests every 15
 * minutes keep them out indefinitely.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRepo } from "@/lib/server/repo";
import { signUp, verifyPassword } from "@/lib/server/credentials";

const EMAIL = "victim@hmicopilot.test";
const PASSWORD = "the-right-password-1";
const from = (ip: string) => new Request("http://localhost/api/auth/callback/credentials", { headers: { "x-forwarded-for": ip } });

beforeEach(() => vi.stubEnv("AUTH_SECRET", "test-only-secret"));
afterEach(() => vi.unstubAllEnvs());

it("lets the owner in with the right password after a stranger's ten wrong guesses", async () => {
  const r = new MemoryRepo();
  await signUp({ email: EMAIL, password: PASSWORD }, from("198.51.100.7"), r);
  for (let i = 0; i < 10; i++) expect(await verifyPassword(EMAIL, `wrong-guess-${i}`, from("203.0.113.66"), r)).toBeNull();
  const owner = await verifyPassword(EMAIL, PASSWORD, from("198.51.100.7"), r).catch((e: { status?: number; message?: string }) => `refused ${e.status}: ${e.message}`);
  expect(typeof owner === "string" ? owner : "signed in", "the owner was locked out by someone else's guesses").toBe("signed in");
}, 60_000);
