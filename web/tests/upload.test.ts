/** Chunk assembly, expiry and the real import parser, with no external services. */
import { beforeEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { MemoryRepo, PART_BYTES, TTL_MS } from "@/lib/server/repo";
import { uploadedSource } from "@/lib/server/uploads";
const state = vi.hoisted(() => ({ repo: null as unknown as MemoryRepo }));
vi.mock("@/lib/server/repo", async original => ({ ...await original<typeof import("@/lib/server/repo")>(), repo: () => state.repo }));
vi.mock("@/lib/server/session", () => ({ currentUser: async () => ({ id: "alice", name: "Alice" }) }));
vi.mock("@/lib/knowledge/learn", () => ({ learnFromProject: vi.fn(async () => null) }));
vi.mock("@/lib/knowledge/store", () => ({ knowledgeStore: () => "mongo" }));
beforeEach(() => { state.repo = new MemoryRepo(); });
it("assembles out-of-order parts, tolerates retries, and completes idempotently", async () => {
  const r = state.repo; const u = await r.uploads.create("large.eote", PART_BYTES + 3, "alice");
  await r.uploads.part(u._id, 1, new Uint8Array([1,2,3]), "alice");
  await expect(r.uploads.complete(u._id, "alice")).rejects.toMatchObject({ code: "incomplete" });
  await r.uploads.part(u._id, 0, new Uint8Array(PART_BYTES).fill(42), "alice");
  await r.uploads.part(u._id, 1, new Uint8Array([4,5,6]), "alice");
  const id = await r.uploads.complete(u._id, "alice");
  expect(await r.uploads.complete(u._id, "alice")).toBe(id);
  const source = await r.sources.get(id); expect(source?.bytes.length).toBe(PART_BYTES + 3); expect(source?.bytes.slice(-3)).toEqual(new Uint8Array([4,5,6]));
  await expect(uploadedSource(u._id, null, r)).rejects.toMatchObject({ status: 403 });
});
it("bounds aggregate and individual sizes and denies other users", async () => {
  const r = state.repo;
  await expect(r.uploads.create("huge", 100 * 1024 * 1024 + 1, null)).rejects.toMatchObject({ status: 413 });
  const u = await r.uploads.create("p", 2, "alice");
  await expect(r.uploads.part(u._id, 0, new Uint8Array(3), "alice")).rejects.toMatchObject({ status: 413 });
  await expect(r.uploads.part(u._id, -1, new Uint8Array(2), "alice")).rejects.toMatchObject({ status: 400 });
  await expect(r.uploads.part(u._id, 0, new Uint8Array(2), "bob")).rejects.toMatchObject({ status: 403 });
  const short = await r.uploads.create("short-parts", 5, "alice");
  await r.uploads.part(short._id, 0, new Uint8Array([1,2]), "alice");
  await expect(r.uploads.part(short._id, 1, new Uint8Array(4), "alice")).rejects.toMatchObject({ status: 413 });
  await r.uploads.part(short._id, 1, new Uint8Array([3,4,5]), "alice");
  const source = await r.sources.get(await r.uploads.complete(short._id, "alice"));
  expect(source?.bytes).toEqual(new Uint8Array([1,2,3,4,5]));
});
it("expires incomplete uploads and anonymous sources but keeps account sources", async () => {
  let now = 100; const r = new MemoryRepo(() => now);
  const u = await r.uploads.create("p", 1, null); await r.uploads.part(u._id, 0, new Uint8Array([7]), null);
  const temp = await r.uploads.complete(u._id, null);
  const permanent = await r.sources.put(new Uint8Array([8]), "p", "alice");
  const incomplete = await r.uploads.create("p", 1, null);
  now += TTL_MS + 1;
  expect(await r.uploads.get(incomplete._id)).toBeNull(); expect(await r.sources.get(temp)).toBeNull();
  await expect(r.uploads.complete(incomplete._id, null)).rejects.toMatchObject({ status: 404 });
  await r.uploads.sweep(); expect((await r.sources.get(permanent))?.bytes[0]).toBe(8);
});
it("imports the demo through uploadId and keeps the original permanent bytes", async () => {
  const bytes = await readFile("../demo_project/HMICopilot_Minimal.eote");
  const r = state.repo; const u = await r.uploads.create("HMICopilot_Minimal.eote", bytes.length, "alice");
  for (let start = 0, part = 0; start < bytes.length; start += PART_BYTES, part++) await r.uploads.part(u._id, part, bytes.subarray(start, start + PART_BYTES), "alice");
  const sourceId = await r.uploads.complete(u._id, "alice");
  const { POST } = await import("@/app/api/import/route");
  const response = await POST(new Request("http://localhost/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId: u._id }) }));
  const body = await response.json(); expect(response.status, JSON.stringify(body)).toBe(200); expect(body.source).toBe(sourceId); expect(body.screens.length).toBeGreaterThan(0);
  expect(Buffer.from((await r.sources.get(sourceId))!.bytes)).toEqual(bytes);
  const { learnFromProject } = await import("@/lib/knowledge/learn"); expect(learnFromProject).not.toHaveBeenCalled();
});
