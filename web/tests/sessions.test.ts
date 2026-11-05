import { describe, expect, it } from "vitest";
import { MemoryRepo } from "@/lib/server/repo";
import { newSessionId, revokeSession, sessionId, SESSION_MAX_AGE, validSession } from "@/lib/server/sessions";

describe("account sessions", () => {
  it("keeps old version-zero cookies and rejects a revoked copied session", async () => {
    const storage = new MemoryRepo();
    const user = await storage.users.create({ email: "a@example.com", emailKey: "a@example.com", name: "A", passwordHash: "hash" });
    const legacy = sessionId({ sub: user.id, jti: "same-cookie" });
    expect(sessionId({ sub: user.id, jti: "same-cookie" })).toBe(legacy);
    expect(await validSession(user.id, 0, legacy, storage)).toBe(true);
    await revokeSession(user.id, legacy, Date.now() + SESSION_MAX_AGE * 1000, storage);
    expect(await validSession(user.id, 0, legacy, storage)).toBe(false);
    expect(await validSession(user.id, 0, newSessionId(), storage)).toBe(true);
  });

  it("rejects older versions and missing users", async () => {
    const storage = new MemoryRepo();
    const user = await storage.users.create({ email: "b@example.com", emailKey: "b@example.com", name: "B", passwordHash: "hash" });
    const sid = newSessionId();
    expect(await validSession(user.id, 0, sid, storage)).toBe(true);
    await storage.users.bumpSessionVersion(user.id);
    expect(await storage.users.sessionValid(user.id, 0, sid)).toBe(false);
    expect(await validSession("user:deleted", 0, newSessionId(), storage)).toBe(false);
  });
});
