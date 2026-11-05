import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepo } from "@/lib/server/repo";
import { changePassword, signUp, verifyPassword } from "@/lib/server/credentials";
import { newSessionId } from "@/lib/server/sessions";

const state = vi.hoisted(() => ({ storage: null as unknown as MemoryRepo, user: null as null | { id: string; email: string; name: string } }));
vi.mock("@/lib/server/repo", async original => ({ ...await original<typeof import("@/lib/server/repo")>(), repo: () => state.storage }));
vi.mock("@/lib/server/session", async original => ({ ...await original<typeof import("@/lib/server/session")>(), currentUser: async () => state.user }));
import { POST } from "@/app/api/account/password/route";

const oldPassword = "correct horse battery";
const newPassword = "different horse battery";
const request = (currentPassword: string, password = newPassword) => new Request("http://localhost/api/account/password", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword: password }),
});

beforeEach(() => { state.storage = new MemoryRepo(); state.user = null; vi.stubEnv("AUTH_SECRET", "test-only"); });
afterEach(() => vi.unstubAllEnvs());

describe("change password", { timeout: 30_000 }, () => {
  it("requires the current password and applies the existing password rules", async () => {
    const user = await signUp({ email: "a@example.com", password: oldPassword }, null, state.storage);
    await expect(changePassword(user, "wrong password", newPassword, null, state.storage)).rejects.toMatchObject({ status: 403 });
    await expect(changePassword(user, "wrong password", "short", null, state.storage)).rejects.toMatchObject({ status: 403 });
    await expect(changePassword(user, oldPassword, "short", null, state.storage)).rejects.toMatchObject({ code: "weak-password" });
    expect((await verifyPassword(user.email, oldPassword, null, state.storage))?.id).toBe(user.id);
  });

  it("ends old sessions, grants and personal tokens when changed through HTTP", async () => {
    state.user = await signUp({ email: "a@example.com", password: oldPassword }, null, state.storage) as typeof state.user;
    const sid = newSessionId();
    const client = await state.storage.connector.registerClient({ clientName: "Test", redirectUris: ["http://localhost/callback"] });
    const grant = await state.storage.connector.putGrant({ userId: state.user!.id, clientId: client.clientId, clientName: "Test", redirectHost: "localhost", scopes: ["mcp:read"], createdAt: Date.now() });
    await state.storage.connector.issue({ hash: "access-hash", kind: "access", userId: state.user!.id, grantId: grant._id, scopes: ["mcp:read"], createdAt: Date.now(), expiresAt: Date.now() + 1000 });
    await state.storage.connector.issue({ hash: "personal-hash", kind: "personal", userId: state.user!.id, scopes: ["mcp:read"], createdAt: Date.now(), expiresAt: Date.now() + 1000 });
    expect((await POST(request(oldPassword))).status).toBe(204);
    expect(await state.storage.users.sessionValid(state.user!.id, 0, sid)).toBe(false);
    expect(await state.storage.connector.grants(state.user!.id)).toEqual([]);
    expect(await state.storage.connector.byHash("access-hash")).toBeNull();
    expect(await state.storage.connector.byHash("personal-hash")).toBeNull();
    expect(await verifyPassword(state.user!.email, oldPassword, null, state.storage)).toBeNull();
    expect((await verifyPassword(state.user!.email, newPassword, null, state.storage))?.id).toBe(state.user!.id);
  });
});
