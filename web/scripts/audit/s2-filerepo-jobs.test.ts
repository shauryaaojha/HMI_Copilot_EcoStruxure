/**
 * S2-03: the laptop store (FileStorage, src/lib/server/storage.ts:132-143)
 * keeps an allow-list of tables and silently drops writes to any other.
 * "generationJobs" (src/lib/server/repo-jobs.ts) is not on it, so on a laptop
 * without MongoDB - where the MCP Inspector is tested - a generate job is
 * created, answered with an id, and is gone on the next read.
 */
import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileRepo } from "@/lib/server/repo";
import { sample } from "../../tests/fixtures/collab";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

it("keeps a generation job on the laptop store", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "s2-jobs-")); dirs.push(dir);
  const r = new FileRepo(dir);
  await r.projects.create("alice", sample());
  const job = await r.jobs.create({ projectId: "project-test", requestedBy: "alice", requestedByName: "Alice", request: "build it" });
  const read = await r.jobs.get(job._id);
  expect(read?._id ?? null, "FileRepo dropped the generationJobs row it just wrote").toBe(job._id);
});
