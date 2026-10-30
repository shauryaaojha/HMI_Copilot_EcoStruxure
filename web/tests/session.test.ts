/** Environment permutations without OAuth requests or database connections. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cloudEnabled, currentUser, providers } from "@/lib/server/session";
const SIGNED_IN = "user:0123456789abcdef01234567";
vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: SIGNED_IN, name: "Engineer" } })) }));
beforeEach(() => { for (const key of ["VERCEL", "AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "AUTH_SECRET"]) vi.stubEnv(key, ""); });
afterEach(() => vi.unstubAllEnvs());
it("uses the implicit engineer only on a laptop", async () => { expect(cloudEnabled()).toBe(true); expect(await currentUser()).toEqual({ id: "local", name: "Local engineer" }); });
it("never creates a public shared local user", async () => { vi.stubEnv("VERCEL", "1"); expect(cloudEnabled()).toBe(false); expect(await currentUser()).toBeNull(); });
/**
 * This case used to assert the GitHub and Google permutations. Those providers
 * are gone (decision A), so it asserts what replaced them: AUTH_SECRET is the
 * whole configuration, and leftover OAuth variables mean nothing.
 */
it("takes AUTH_SECRET as the only sign-in configuration", async () => {
  vi.stubEnv("AUTH_GITHUB_ID", "test-id"); vi.stubEnv("AUTH_GOOGLE_ID", "test-id"); expect(providers()).toEqual([]);
  vi.stubEnv("AUTH_SECRET", "test-only"); expect(providers()).toEqual(["credentials"]);
  expect(cloudEnabled()).toBe(true); expect((await currentUser())?.id).toBe(SIGNED_IN);
  // A deployment with accounts configured has them, and still no local user.
  vi.stubEnv("VERCEL", "1"); expect(cloudEnabled()).toBe(true); expect((await currentUser())?.id).toBe(SIGNED_IN);
});
