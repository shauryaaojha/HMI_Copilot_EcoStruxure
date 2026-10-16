/** Project HTTP contracts exercise real access checks over an isolated Repo. */
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRepo, type User } from "@/lib/server/repo";
import { sample } from "./fixtures/collab";
const state = vi.hoisted(() => ({ repo: null as unknown as MemoryRepo, user: null as User | null }));
vi.mock("@/lib/server/repo", async original => ({ ...await original<typeof import("@/lib/server/repo")>(), repo: () => state.repo }));
vi.mock("@/lib/server/session", () => ({ currentUser: async () => state.user }));
import { GET as list, POST as create } from "@/app/api/projects/route";
import { GET as get, PUT as save, DELETE as remove } from "@/app/api/projects/[id]/route";
import { GET as versions, POST as restore } from "@/app/api/projects/[id]/versions/route";
const context = (id = "project-test") => ({ params: Promise.resolve({ id }) });
const request = (method = "GET", body?: unknown) => new Request("http://localhost/api/projects/project-test", { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
beforeEach(() => { state.repo = new MemoryRepo(); state.user = { id: "owner", name: "Owner" }; });
it("creates, saves, returns the current snapshot on 409, and restores forward", async () => {
  expect((await create(request("POST", { snapshot: { ...sample(), selectedIds: ["volatile"] } }))).status).toBe(201);
  const saved = await save(request("PUT", { rev: 1, snapshot: { ...sample(), name: "Changed" }, label: "Renamed" }), context());
  expect(saved.status).toBe(200);
  const conflict = await save(request("PUT", { rev: 1, snapshot: sample() }), context());
  expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ code: "conflict", rev: 2, snapshot: { name: "Changed" } });
  expect((await get(request(), context())).status).toBe(200);
  expect((await (await versions(request(), context())).json()).versions).toHaveLength(2);
  expect((await (await restore(request("POST", { rev: 1 }), context())).json()).rev).toBe(3);
  expect((await state.repo.versions.current("project-test"))?.snapshot).not.toHaveProperty("selectedIds");
});
it("lists shared projects and enforces 401, 403, 404 and owner-only deletion", async () => {
  await state.repo.projects.create("owner", sample());
  state.user = null; expect((await list()).status).toBe(401);
  state.user = { id: "viewer", name: "V" };
  expect((await get(request(), context())).status).toBe(403);
  expect((await get(request(), context("missing"))).status).toBe(404);
  await state.repo.members.put("project-test", "viewer", "viewer");
  expect((await (await list()).json()).projects).toHaveLength(1);
  expect((await get(request(), context())).status).toBe(200);
  expect((await save(request("PUT", { rev: 1, snapshot: sample() }), context())).status).toBe(403);
  expect((await remove(request("DELETE"), context())).status).toBe(403);
  state.user = { id: "owner", name: "Owner" };
  expect((await remove(request("DELETE"), context())).status).toBe(200);
});
it("rejects malformed snapshots and foreign browser writes", async () => {
  expect((await create(request("POST", { snapshot: {} }))).status).toBe(400);
  const crossOrigin = new Request("http://localhost/api/projects", { method: "POST", headers: { Origin: "https://untrusted.invalid", "Content-Type": "application/json" }, body: JSON.stringify({ snapshot: sample() }) });
  expect((await create(crossOrigin)).status).toBe(403);
});
