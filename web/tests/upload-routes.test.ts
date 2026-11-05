/** A file too big for one request reaches every reader by its upload id; a live change cannot name someone else's file. */

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BaseRepo } from "@/lib/server/repo";
import { MemoryStorage } from "@/lib/server/storage";
import { sample } from "./fixtures/collab";

const state = vi.hoisted(() => ({ repo: null as never as BaseRepo, user: { id: "alice", name: "Alice" } as { id: string; name: string } | null }));
vi.mock("@/lib/server/repo", async (actual) => ({ ...(await actual<object>()), repo: () => state.repo }));
vi.mock("@/lib/server/session", () => ({ currentUser: async () => state.user }));
vi.mock("@/lib/realtime/announce", () => ({ announceRevision: () => {} }));

import { POST as parseTags } from "@/app/api/tags/parse/route";
import { POST as readScreens } from "@/app/api/import/screens/route";
import { POST as migrate } from "@/app/api/vijeo/migrate/route";
import { POST as postChanges } from "@/app/api/projects/[id]/changes/route";

const CSV = "Name,DataType\nPUMP_RUN,BOOL\nPUMP_SPEED,REAL\n";
const asJson = (body: unknown) => new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json", origin: "http://localhost" }, body: JSON.stringify(body) });

async function uploaded(bytes: Uint8Array, fileName: string, owner = "alice") {
  const upload = await state.repo.uploads.create(fileName, bytes.length, owner);
  await state.repo.uploads.part(upload._id, 0, bytes, owner);
  await state.repo.uploads.complete(upload._id, owner);
  return upload._id;
}

beforeEach(() => {
  state.repo = new BaseRepo(new MemoryStorage());
  state.user = { id: "alice", name: "Alice" };
});

describe("a large file by its upload id", () => {
  it("reads a tag list, under the name it was uploaded with", async () => {
    const uploadId = await uploaded(new TextEncoder().encode(CSV), "tags.csv");
    const response = await parseTags(asJson({ uploadId }));
    expect(response.status).toBe(200);
    expect((await response.json() as { variables: { Name: string }[] }).variables.map(v => v.Name)).toEqual(["PUMP_RUN", "PUMP_SPEED"]);
  });

  it("still reads a tag list sent as a form", async () => {
    const form = new FormData();
    form.append("file", new File([CSV], "tags.csv"));
    const response = await parseTags(new Request("http://localhost/x", { method: "POST", body: form }));
    expect(response.status).toBe(200);
  });

  it("reads another project's screens", async () => {
    const bytes = new Uint8Array(readFileSync(path.resolve(import.meta.dirname, "../../demo_project/HMICopilot_Bars.eote")));
    const response = await readScreens(asJson({ uploadId: await uploaded(bytes, "Bars.eote") }));
    expect(response.status).toBe(200);
    expect((await response.json() as { screens: unknown[] }).screens.length).toBeGreaterThan(0);
  });

  it("takes a Vijeo backup's place in the form, and checks what it is", async () => {
    const form = new FormData();
    form.append("uploadId", await uploaded(new TextEncoder().encode(CSV), "plant.vdz"));
    const response = await migrate(new Request("http://localhost/x", { method: "POST", headers: { origin: "http://localhost" }, body: form }));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect((await response.json() as { error: string }).error).not.toMatch(/No Vijeo Designer backup/);
  });

  it("answers someone else's upload as forbidden, on every route", async () => {
    const uploadId = await uploaded(new TextEncoder().encode(CSV), "tags.csv", "bob");
    expect((await parseTags(asJson({ uploadId }))).status).toBe(403);
    expect((await readScreens(asJson({ uploadId }))).status).toBe(403);
    const form = new FormData();
    form.append("uploadId", uploadId);
    expect((await migrate(new Request("http://localhost/x", { method: "POST", headers: { origin: "http://localhost" }, body: form }))).status).toBe(403);
  });
});

describe("a live change naming a source file", () => {
  const send = (ops: unknown[], id = "c1") => postChanges(asJson({ base: 1, changes: [{ id, ops }] }), { params: Promise.resolve({ id: "p1" }) } as never);
  beforeEach(async () => { await state.repo.projects.create("alice", sample("p1") as never); });

  it("lands the author's own file", async () => {
    const mine = await state.repo.sources.put(new Uint8Array([1]), "mine.eote", "alice");
    const result = await (await send([{ kind: "setField", field: "sourceId", value: mine }])).json() as { accepted: unknown[]; rejected: unknown[] };
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toEqual([]);
  });

  it("refuses another account's file, and the rest of the batch still lands", async () => {
    const theirs = await state.repo.sources.put(new Uint8Array([1]), "theirs.eote", "bob");
    const response = await postChanges(asJson({ base: 1, changes: [
      { id: "bad", ops: [{ kind: "setField", field: "sourceId", value: theirs }] },
      { id: "good", ops: [{ kind: "setField", field: "name", value: "Renamed" }] },
    ] }), { params: Promise.resolve({ id: "p1" }) } as never);
    const result = await response.json() as { accepted: { id: string }[] | string[]; rejected: { id: string; reason: string }[] };
    expect(result.rejected).toEqual([{ id: "bad", reason: expect.stringMatching(/source file/) }]);
    expect(result.accepted).toHaveLength(1);
    expect((await state.repo.versions.current("p1"))!.snapshot.sourceId).not.toBe(theirs);
  });

  it("refuses a target that is not one", async () => {
    const result = await (await send([{ kind: "setField", field: "target", value: "oops" }])).json() as { rejected: { reason: string }[] };
    expect(result.rejected[0].reason).toBe("malformed operation");
  });
});
