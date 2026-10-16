/** Exercise real compression and upload assembly without a network or model. */
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRepo } from "@/lib/server/repo";
import { snapshotRequest } from "@/lib/client/snapshot";
import { snapshotBody } from "@/lib/server/snapshot";
import type { PersistedProject } from "@/store/persist";

const state = vi.hoisted(() => ({ repo: null as unknown as MemoryRepo }));
vi.mock("@/lib/server/repo", async original => ({ ...await original<typeof import("@/lib/server/repo")>(), repo: () => state.repo }));
afterEach(() => vi.unstubAllGlobals());
const user = { id: "alice", name: "Alice" };
const project = (name: string) => ({ v: 3, id: "project", name, screens: [] }) as unknown as PersistedProject;

it("keeps small snapshots inline and compresses large snapshots below the host ceiling", async () => {
  const small = project("small");
  const inline = await snapshotRequest(small, 1);
  expect(JSON.parse(inline.body as string)).toEqual({ rev: 1, snapshot: small });
  const large = project("x".repeat(5 * 1024 * 1024));
  const init = await snapshotRequest(large, 3);
  expect(init.headers).toEqual({ "Content-Type": "application/gzip" });
  expect((init.body as Blob).size).toBeLessThan(3.5 * 1024 * 1024);
  expect(await snapshotBody(new Request("http://localhost/api/projects/project", { method: "PUT", ...init }), user)).toEqual({ rev: 3, snapshot: large });
});

it("stages incompressible snapshots in bounded chunks and decodes the owned completed upload", async () => {
  state.repo = new MemoryRepo();
  const sizes: number[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (url === "/api/upload") {
      const body = JSON.parse(init.body as string);
      const upload = await state.repo.uploads.create(body.fileName, body.size, user.id);
      return Response.json({ uploadId: upload._id });
    }
    const path = new URL(url, "http://localhost");
    const id = path.pathname.split("/")[3];
    if (path.pathname.endsWith("/complete")) {
      await state.repo.uploads.complete(id, user.id);
    } else {
      const bytes = new Uint8Array(await (init.body as Blob).arrayBuffer());
      sizes.push(bytes.length);
      await state.repo.uploads.part(id, Number(path.searchParams.get("part")), bytes, user.id);
    }
    return Response.json({ ok: true });
  }));
  const large = project(randomBytes(5 * 1024 * 1024).toString("base64"));
  const init = await snapshotRequest(large, 7);
  expect(JSON.parse(init.body as string).snapshotUploadId).toBeTruthy();
  expect(sizes.length).toBeGreaterThan(1);
  expect(Math.max(...sizes)).toBeLessThanOrEqual(3.5 * 1024 * 1024);
  const request = () => new Request("http://localhost/api/projects/project", { method: "PUT", ...init });
  expect(await snapshotBody(request(), user)).toEqual({ rev: 7, snapshot: large });
  await expect(snapshotBody(request(), { id: "bob", name: "Bob" })).rejects.toMatchObject({ status: 403 });
});

it("rejects malformed gzip and inflation beyond the uncompressed snapshot ceiling", async () => {
  const request = (body: Blob) => new Request("http://localhost/api/projects/project", { method: "PUT", headers: { "Content-Type": "application/gzip" }, body });
  await expect(snapshotBody(request(new Blob(["bad"])), user)).rejects.toMatchObject({ code: "invalid" });
  const compressed = gzipSync(Buffer.alloc(64 * 1024 * 1024 + 2048, 32));
  await expect(snapshotBody(request(new Blob([compressed])), user)).rejects.toMatchObject({ code: "invalid" });
});
