/** Every role/action pair, plus isolation of permanent source files. */
import { describe, expect, it } from "vitest";
import { can, readSource, type Action } from "@/lib/server/access";
import { MemoryRepo, type Role } from "@/lib/server/repo";
import { sample } from "./fixtures/collab";
describe("access", () => {
  it("enforces the complete role matrix and denies strangers", async () => {
    const r = new MemoryRepo(); await r.projects.create("owner", sample());
    const matrix: Record<Role, boolean[]> = { owner: [true,true,true,true,true], editor: [true,true,true,false,true], commenter: [true,true,false,false,true], viewer: [true,false,false,false,true] };
    const actions: Action[] = ["read", "comment", "edit", "manage", "export"];
    for (const role of Object.keys(matrix) as Role[]) {
      if (role !== "owner") await r.members.put("project-test", role, role);
      for (const [i, action] of actions.entries()) expect(await can({ id: role, name: role }, "project-test", action, r)).toBe(matrix[role][i]);
    }
    expect(await can(null, "project-test", "read", r)).toBe(false);
    expect(await can({ id: "stranger", name: "S" }, "project-test", "read", r)).toBe(false);
    expect(await can({ id: "owner", name: "O" }, "missing", "read", r)).toBe(false);
  });
  it("source ids alone cannot read another account's file", async () => {
    const r = new MemoryRepo(); const id = await r.sources.put(new Uint8Array([42]), "p.eote", "owner");
    await expect(readSource(id, null, "export", r)).rejects.toMatchObject({ status: 401 });
    await expect(readSource(id, { id: "viewer", name: "V" }, "export", r)).rejects.toMatchObject({ status: 403 });
    await r.projects.create("owner", { ...sample(), source: id });
    await r.members.put("project-test", "viewer", "viewer");
    expect((await readSource(id, { id: "viewer", name: "V" }, "export", r))?.bytes[0]).toBe(42);
  });
});
