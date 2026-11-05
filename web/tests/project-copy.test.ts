/** Renaming and copying a project on the server, and what each may do. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepo, type User } from "@/lib/server/repo";
import { sample } from "./fixtures/collab";

const state = vi.hoisted(() => ({ repo: null as unknown as MemoryRepo, user: null as User | null }));
vi.mock("@/lib/server/repo", async (actual) => ({ ...(await actual<typeof import("@/lib/server/repo")>()), repo: () => state.repo }));
vi.mock("@/lib/server/session", () => ({ currentUser: async () => state.user }));
vi.mock("@/lib/realtime/announce", () => ({ announceRevision: () => {} }));

import { PATCH } from "@/app/api/projects/[id]/route";
import { POST } from "@/app/api/projects/[id]/duplicate/route";

const context = (id: string) => ({ params: Promise.resolve({ id }) });
const rename = (id: string, name: string) => PATCH(new Request("http://localhost/x", { method: "PATCH", headers: { "Content-Type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ name }) }), context(id) as never);
const copy = (id: string) => POST(new Request("http://localhost/x", { method: "POST" }), context(id) as never);

beforeEach(async () => {
  state.repo = new MemoryRepo();
  state.user = { id: "alice", name: "Alice" };
  await state.repo.projects.create("alice", { ...sample("p1"), name: "Plant", chat: [{ role: "user", text: "hello" }] } as never);
  await state.repo.members.put("p1", "val", "viewer");
});

describe("renaming", () => {
  it("changes the document and the card, as one revision", async () => {
    const before = (await state.repo.versions.current("p1"))!.rev;
    const response = await rename("p1", "  Water plant ");
    expect(response.status).toBe(200);
    expect((await state.repo.projects.get("p1"))!.name).toBe("Water plant");
    const now = (await state.repo.versions.current("p1"))!;
    expect(now.snapshot.name).toBe("Water plant");
    expect(now.rev).toBe(before + 1);
  });

  it("refuses an empty name, and a viewer", async () => {
    expect((await rename("p1", "   ")).status).toBe(400);
    state.user = { id: "val", name: "Val" };
    expect((await rename("p1", "Mine now")).status).toBe(403);
  });
});

describe("duplicating", () => {
  it("gives the caller a new project without the conversation", async () => {
    const response = await copy("p1");
    expect(response.status).toBe(201);
    const { project } = await response.json() as { project: { _id: string; name: string; ownerId: string } };
    expect(project._id).not.toBe("p1");
    expect(project).toMatchObject({ name: "Plant copy", ownerId: "alice" });
    const snapshot = (await state.repo.versions.current(project._id))!.snapshot;
    expect(snapshot.id).toBe(project._id);
    expect(snapshot.chat).toEqual([]);
    expect((await state.repo.versions.current("p1"))!.snapshot.chat).toHaveLength(1);
  });
});
