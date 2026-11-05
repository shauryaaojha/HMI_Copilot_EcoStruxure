import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BaseRepo } from "@/lib/server/repo";
import { MemoryStorage } from "@/lib/server/storage";
import { signUp } from "@/lib/server/credentials";
import { sample } from "./fixtures/collab";

const state = vi.hoisted(() => ({ storage: null as unknown as BaseRepo, user: null as null | { id: string; email: string; name: string } }));
vi.mock("@/lib/server/repo", async original => ({ ...await original<typeof import("@/lib/server/repo")>(), repo: () => state.storage }));
vi.mock("@/lib/server/session", async original => ({ ...await original<typeof import("@/lib/server/session")>(), currentUser: async () => state.user }));
import { DELETE } from "@/app/api/account/route";

const password = "correct horse battery";
const request = (pass = password) => new Request("http://localhost/api/account", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pass }) });
let memory: MemoryStorage;
beforeEach(() => { memory = new MemoryStorage(); state.storage = new BaseRepo(memory); state.user = null; vi.stubEnv("AUTH_SECRET", "test-only"); });
afterEach(() => vi.unstubAllEnvs());

describe("delete account", { timeout: 30_000 }, () => {
  it("requires a password and names owned projects with other members", async () => {
    state.user = await signUp({ email: "a@example.com", password }, null, state.storage) as typeof state.user;
    const project = await state.storage.projects.create(state.user!.id, sample());
    await state.storage.members.put(project._id, "user:other", "editor");
    expect((await DELETE(request("wrong password"))).status).toBe(403);
    const response = await DELETE(request());
    expect(response.status).toBe(409);
    expect((await response.json()).projects).toContain(project.name);
    expect(await state.storage.users.get(state.user!.id)).not.toBeNull();
  });

  it("deletes sole-member projects, memberships, uploads, sources and credentials", async () => {
    state.user = await signUp({ email: "a@example.com", password }, null, state.storage) as typeof state.user;
    const id = state.user!.id;
    const own = await state.storage.projects.create(id, sample());
    const other = await state.storage.projects.create("user:other", { ...sample(), id: "other-project" });
    await state.storage.members.put(other._id, id, "editor");
    const upload = await state.storage.uploads.create("file.eote", 3, id);
    await state.storage.uploads.part(upload._id, 0, new Uint8Array([1, 2, 3]), id);
    const source = await state.storage.sources.put(new Uint8Array([4, 5]), "source.eote", id);
    await state.storage.connector.issue({ hash: "secret-hash", kind: "personal", userId: id, scopes: ["mcp:read"], createdAt: Date.now(), expiresAt: Date.now() + 1000 });
    const response = await DELETE(request());
    expect(response.status).toBe(200);
    expect((await response.json()).retainedSources).toEqual([]);
    expect(await state.storage.users.get(id)).toBeNull();
    expect(await state.storage.projects.get(own._id)).toBeNull();
    expect(await state.storage.members.get(other._id, id)).toBeNull();
    expect(await state.storage.uploads.get(upload._id)).toBeNull();
    expect(await state.storage.sources.get(source)).toBeNull();
    expect(await state.storage.connector.byHash("secret-hash")).toBeNull();
    expect(memory.rows("uploadParts")).toEqual([]);
  });

  it("reports an owned source that another account's project still needs", async () => {
    state.user = await signUp({ email: "a@example.com", password }, null, state.storage) as typeof state.user;
    const source = await state.storage.sources.put(new Uint8Array([4, 5]), "shared.eote", state.user!.id);
    const other = await state.storage.projects.create("user:other", { ...sample(), id: "uses-shared-source" });
    await memory.transaction(async data => {
      const project = await data.get("projects", other._id);
      await data.put("projects", { ...project!, sourceId: source });
    });

    const response = await DELETE(request());
    expect(response.status).toBe(200);
    expect((await response.json()).retainedSources).toEqual([`shared.eote (used by ${other.name})`]);
    expect(await state.storage.sources.get(source)).not.toBeNull();
  });
});
