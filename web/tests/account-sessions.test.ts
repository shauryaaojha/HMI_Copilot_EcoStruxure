import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepo } from "@/lib/server/repo";

const state = vi.hoisted(() => ({ storage: null as unknown as MemoryRepo, user: null as null | { id: string; email: string; name: string } }));
vi.mock("@/lib/server/repo", async original => ({ ...await original<typeof import("@/lib/server/repo")>(), repo: () => state.storage }));
vi.mock("@/lib/server/session", async original => ({ ...await original<typeof import("@/lib/server/session")>(), currentUser: async () => state.user }));
import { DELETE } from "@/app/api/account/sessions/route";
import { newSessionId, validSession } from "@/lib/server/sessions";

beforeEach(() => { state.storage = new MemoryRepo(); state.user = null; });

describe("sign out everywhere", () => {
  it("requires an account", async () => { expect((await DELETE(new Request("https://app.test/api/account/sessions", { method: "DELETE" }))).status).toBe(401); });
  it("invalidates every existing session for that account", async () => {
    state.user = await state.storage.users.create({ email: "a@example.com", emailKey: "a@example.com", name: "A", passwordHash: "hash" }) as typeof state.user;
    const first = newSessionId(), second = newSessionId();
    expect(await validSession(state.user!.id, 0, first, state.storage)).toBe(true);
    expect(await validSession(state.user!.id, 0, second, state.storage)).toBe(true);
    expect((await DELETE(new Request("https://app.test/api/account/sessions", { method: "DELETE" }))).status).toBe(204);
    expect(await validSession(state.user!.id, 0, first, state.storage)).toBe(false);
    expect(await validSession(state.user!.id, 0, second, state.storage)).toBe(false);
    expect(await validSession(state.user!.id, 1, newSessionId(), state.storage)).toBe(true);
  });
});
