import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseRepo } from "@/lib/server/repo";
import { MemoryStorage } from "@/lib/server/storage";
import { createPasswordReset, resetPassword, signUp, verifyPassword } from "@/lib/server/credentials";

afterEach(() => vi.unstubAllEnvs());

describe("operator password reset", { timeout: 30_000 }, () => {
  it("fails clearly for an unknown address and stores only a hash", async () => {
    vi.stubEnv("AUTH_SECRET", "test-only");
    const memory = new MemoryStorage(), storage = new BaseRepo(memory);
    await expect(createPasswordReset("missing@example.com", storage)).rejects.toMatchObject({ status: 404 });
    await signUp({ email: "a@example.com", password: "correct horse battery" }, null, storage);
    const token = await createPasswordReset("a@example.com", storage);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(memory.rows("passwordResets")).toHaveLength(1);
    expect(JSON.stringify(memory.rows("passwordResets"))).not.toContain(token);
  });

  it("works once, replaces the password, revokes connector access and old sessions", async () => {
    vi.stubEnv("AUTH_SECRET", "test-only");
    const memory = new MemoryStorage(), storage = new BaseRepo(memory);
    const user = await signUp({ email: "a@example.com", password: "correct horse battery" }, null, storage);
    await storage.connector.issue({ hash: "personal-hash", kind: "personal", userId: user.id, scopes: ["mcp:read"], createdAt: Date.now(), expiresAt: Date.now() + 1000 });
    const token = await createPasswordReset(user.email, storage);
    expect(await resetPassword(token, "different horse battery", storage)).toBe(user.id);
    expect(await storage.users.sessionValid(user.id, 0, "sid")).toBe(false);
    expect(await storage.connector.byHash("personal-hash")).toBeNull();
    expect(await verifyPassword(user.email, "correct horse battery", null, storage)).toBeNull();
    expect((await verifyPassword(user.email, "different horse battery", null, storage))?.id).toBe(user.id);
    await expect(resetPassword(token, "another horse battery", storage)).rejects.toMatchObject({ code: "invalid-reset" });
  });

  it("expires after 30 minutes", async () => {
    vi.stubEnv("AUTH_SECRET", "test-only");
    let now = Date.now();
    const storage = new BaseRepo(new MemoryStorage(), () => now);
    const user = await signUp({ email: "a@example.com", password: "correct horse battery" }, null, storage);
    const token = await createPasswordReset(user.email, storage);
    now = Date.now() + 30 * 60 * 1000 + 1;
    await expect(resetPassword(token, "different horse battery", storage)).rejects.toMatchObject({ code: "invalid-reset" });
  });
});
