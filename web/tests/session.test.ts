/** Environment permutations without OAuth requests or database connections. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cloudEnabled, currentUser, providers } from "@/lib/server/session";
vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "github:42", name: "Engineer" } })) }));
beforeEach(() => { for (const key of ["VERCEL", "AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "AUTH_SECRET"]) vi.stubEnv(key, ""); });
afterEach(() => vi.unstubAllEnvs());
it("uses the implicit engineer only on a laptop", async () => { expect(cloudEnabled()).toBe(true); expect(await currentUser()).toEqual({ id: "local", name: "Local engineer" }); });
it("never creates a public shared local user", async () => { vi.stubEnv("VERCEL", "1"); expect(cloudEnabled()).toBe(false); expect(await currentUser()).toBeNull(); });
it("requires complete provider credentials and AUTH_SECRET", async () => {
  vi.stubEnv("AUTH_GITHUB_ID", "test-id"); expect(providers()).toEqual([]);
  vi.stubEnv("AUTH_GITHUB_SECRET", "test-only"); expect(cloudEnabled()).toBe(true);
  await expect(currentUser()).rejects.toMatchObject({ code: "configuration" });
  vi.stubEnv("AUTH_SECRET", "test-only"); expect((await currentUser())?.id).toBe("github:42");
  vi.stubEnv("AUTH_GOOGLE_ID", "test-id"); vi.stubEnv("AUTH_GOOGLE_SECRET", "test-only"); expect(providers()).toEqual(["github", "google"]);
});
