/** Repository contracts run against isolated memory and real temporary files. */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MemoryRepo, FileRepo, type Repo } from "@/lib/server/repo";
import { sample } from "./fixtures/collab";
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
for (const kind of ["memory", "file"]) describe(`${kind} repository`, () => {
  async function storage(): Promise<Repo> {
    if (kind === "memory") return new MemoryRepo();
    const dir = await mkdtemp(path.join(tmpdir(), "hmi-repo-")); dirs.push(dir); return new FileRepo(dir);
  }
  it("creates owner membership, private lists, and authored snapshots", async () => {
    const r = await storage(); const p = await r.projects.create("alice", sample());
    expect(p.rev).toBe(1); expect((await r.members.get(p._id, "alice"))?.role).toBe("owner");
    expect(await r.projects.list("bob")).toEqual([]);
    await r.members.put(p._id, "bob", "editor");
    expect(await r.projects.list("bob")).toHaveLength(1);
    expect((await r.projects.save(p._id, 1, { ...sample(), name: "Changed" }, "bob", "Valve edit")).authorId).toBe("bob");
    await expect(r.projects.save(p._id, 1, sample(), "alice")).rejects.toMatchObject({ status: 409, detail: { rev: 2, snapshot: { name: "Changed" } } });
    expect((await r.projects.get(p._id))?.name).toBe("Changed");
    await expect(r.members.put(p._id, "bob", "owner")).rejects.toMatchObject({ status: 400 });
  });
  it("allows one concurrent save, caps history at 50, restores forward, deletes membership", async () => {
    const r = await storage(); await r.projects.create("alice", sample());
    const outcomes = await Promise.allSettled([r.projects.save("project-test", 1, sample(), "alice"), r.projects.save("project-test", 1, sample(), "bob")]);
    expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1);
    for (let rev = 2; rev < 55; rev++) await r.projects.save("project-test", rev, { ...sample(), name: `Revision ${rev + 1}` }, "alice");
    expect(await r.versions.list("project-test")).toHaveLength(50);
    const restored = await r.versions.restore("project-test", 10, "alice");
    expect(restored.rev).toBe(56); expect(restored.snapshot.name).toBe("Revision 10");
    await r.projects.delete("project-test");
    expect(await r.versions.list("project-test")).toEqual([]); expect(await r.members.get("project-test", "alice")).toBeNull();
  }, 15000);
  it("persists permanent source bytes and user creation time", async () => {
    const r = await storage(); const first = await r.users.upsert({ id: "alice", name: "A" });
    expect((await r.users.upsert({ id: "alice", name: "Alice" })).createdAt).toBe(first.createdAt);
    const id = await r.sources.put(new Uint8Array([1, 2, 3]), "plant.eote", "alice");
    const reopened = kind === "file" ? new FileRepo(dirs.at(-1)!) : r;
    expect((await reopened.sources.get(id))?.bytes).toEqual(new Uint8Array([1, 2, 3]));
  });
});
