/** History queries must not multiply snapshot reads by retained revisions. */
import { expect, it } from "vitest";
import { BaseRepo } from "@/lib/server/repo";
import { MemoryStorage, type Storage } from "@/lib/server/storage";
import { sample } from "./fixtures/collab";

it("saves against 50 versions with at most one snapshot read", async () => {
  const memory = new MemoryStorage();
  let snapshots = 0;
  const storage: Storage = {
    bytes: memory.bytes,
    transaction: fn => memory.transaction(d => fn({
      ...d,
      get: async (table, id) => {
        const value = await d.get(table, id);
        if (table === "versions" && value?.snapshot) snapshots++;
        return value as never;
      },
      list: async (table, query, options) => {
        const rows = await d.list(table, query, options);
        if (table === "versions") snapshots += rows.filter(row => row.snapshot).length;
        return rows as never;
      },
    })),
  };
  const repo = new BaseRepo(storage);
  await repo.projects.create("alice", sample());
  for (let rev = 1; rev < 50; rev++) await repo.projects.save("project-test", rev, sample(), "alice");
  snapshots = 0;
  await repo.projects.save("project-test", 50, sample(), "alice");
  expect(snapshots).toBeLessThanOrEqual(1);
  expect(await repo.versions.list("project-test")).toHaveLength(50);
  expect(snapshots).toBe(0);
  expect((await repo.versions.current("project-test"))?.rev).toBe(51);
  expect(snapshots).toBe(1);
  expect((await repo.projects.get("project-test"))?.headRev).toBe(51);
});
