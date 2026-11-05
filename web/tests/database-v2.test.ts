/**
 * Database v2 (docs/DATABASE_V2.md): snapshots as content-addressed pieces,
 * read back exactly, stored once, swept when nothing refers to them, and
 * still readable when they were written by v1 as whole snapshots.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { demoScreen, demoVariables } from "@/fixtures";
import { BaseRepo, FileRepo, type Snapshot } from "@/lib/server/repo";
import { LOG_LIMIT } from "@/lib/server/repo-live";
import { FileStorage, MemoryStorage } from "@/lib/server/storage";
import { hashesOf, readSnapshot, writeSnapshot, type Manifest } from "@/lib/server/snapshots";
import type { Change } from "@/lib/collab/types";
import type { Part } from "@/lib/ote/schema";
import { sample } from "./fixtures/collab";

const ID = "project-test";
const screen = structuredClone(demoScreen);

function project(): Snapshot {
  return {
    ...sample(ID),
    screens: [structuredClone(screen), { ...structuredClone(screen), UniqueId: "second", Name: "Second" }],
    variables: structuredClone(demoVariables),
    objectMeta: { a: { note: "x".repeat(2000) } } as never,
    versions: [{ at: 1, description: "first", author: "alice", screens: [structuredClone(screen)], variables: [], alarms: [], bindings: [] }],
    chat: [],
  };
}

/** The same project with one screen renamed: the shape of a typical save. */
const renamed = (base: Snapshot, name: string): Snapshot => ({ ...base, screens: [{ ...base.screens[0], Name: name }, base.screens[1]] });

function setup(now = () => Date.now()) {
  const storage = new MemoryStorage();
  return { storage, repo: new BaseRepo(storage, now) };
}

describe("the snapshot codec", () => {
  it("reads back exactly what it wrote, field order included", async () => {
    const storage = new MemoryStorage();
    const snapshot = project();
    const manifest = await storage.transaction(d => writeSnapshot(d, ID, snapshot, 0));
    const back = await storage.transaction(d => readSnapshot(d, ID, manifest));
    expect(back).toEqual(snapshot);
    expect(Object.keys(back)).toEqual(Object.keys(snapshot));
  });

  it("stores a piece per screen and inlines small fields", async () => {
    const storage = new MemoryStorage();
    const manifest = await storage.transaction(d => writeSnapshot(d, ID, project(), 0));
    expect("a" in manifest.k.screens && manifest.k.screens.a).toHaveLength(2);
    expect("j" in manifest.k.name).toBe(true);
    // Compressed: the pieces together are much smaller than the JSON.
    const stored = storage.rows("objects").reduce((sum, row) => sum + (row.z as Uint8Array).length, 0);
    expect(stored).toBeLessThan(manifest.n / 3);
  });

  it("refuses to invent a piece that is missing", async () => {
    const storage = new MemoryStorage();
    const manifest = await storage.transaction(d => writeSnapshot(d, ID, project(), 0));
    await storage.transaction(d => d.removeMany("objects", storage.rows("objects").map(r => r._id)));
    await expect(storage.transaction(d => readSnapshot(d, ID, manifest))).rejects.toThrow(/missing a stored piece/);
  });
});

describe("versions on pieces", () => {
  it("stores an unchanged screen once across many saves", async () => {
    const { storage, repo } = setup();
    const base = project();
    await repo.projects.create("alice", base);
    for (let rev = 1; rev <= 20; rev++) await repo.projects.save(ID, rev, renamed(base, `Main ${rev}`), "alice");
    const versions = storage.rows("versions");
    expect(versions.every(v => v.manifest && !v.snapshot)).toBe(true);
    // 21 versions, but only the renamed screen changes: one new piece a save
    // (plus the small fields that differ), never a copy of the project.
    expect(storage.rows("objects").length).toBeLessThan(21 + 10);
    for (const v of await repo.versions.list(ID)) {
      const full = await repo.versions.get(ID, v.rev);
      expect(full?.snapshot.screens[1].Name).toBe("Second");
    }
    expect((await repo.versions.get(ID, 7))?.snapshot.screens[0].Name).toBe("Main 6");
  });

  it("sweeps the pieces of trimmed versions and keeps every retained one readable", async () => {
    const { storage, repo } = setup();
    const base = project();
    await repo.projects.create("alice", base);
    for (let rev = 1; rev <= 70; rev++) await repo.projects.save(ID, rev, renamed(base, `Main ${rev}`), "alice");
    const versions = storage.rows("versions");
    expect(versions).toHaveLength(50);
    const referenced = new Set(versions.flatMap(v => hashesOf(v.manifest as Manifest)));
    expect(storage.rows("objects").length).toBe(referenced.size);
    for (const v of versions) await expect(repo.versions.get(ID, v.rev as number)).resolves.toBeTruthy();
  });

  it("restores an old version as a new one", async () => {
    const { repo } = setup();
    const base = project();
    await repo.projects.create("alice", base);
    await repo.projects.save(ID, 1, renamed(base, "Changed"), "alice");
    const restored = await repo.versions.restore(ID, 1, "alice");
    expect(restored.rev).toBe(3);
    expect((await repo.versions.current(ID))?.snapshot.screens[0].Name).toBe(screen.Name);
  });

  it("takes a project's pieces with it when it is deleted", async () => {
    const { storage, repo } = setup();
    await repo.projects.create("alice", project());
    await repo.projects.create("alice", project_("other"));
    await repo.projects.delete(ID);
    expect(storage.rows("objects").every(row => row.projectId === "other")).toBe(true);
    expect(storage.rows("objects").length).toBeGreaterThan(0);
  });
});

function project_(id: string): Snapshot { return { ...project(), id }; }

describe("reading what v1 wrote", () => {
  it("serves, saves over and restores a whole-snapshot version", async () => {
    const { storage, repo } = setup();
    const legacy = project();
    await storage.transaction(async d => {
      await d.put("projects", { _id: ID, ownerId: "alice", name: legacy.name, target: legacy.target, createdAt: 1, updatedAt: 1, rev: 1, headRev: 1 });
      await d.put("members", { _id: `${ID}:alice`, projectId: ID, userId: "alice", role: "owner", addedAt: 1 });
      await d.put("versions", { _id: `${ID}:1`, projectId: ID, rev: 1, authorId: "alice", label: "Created", createdAt: 1, snapshot: legacy });
    });
    expect((await repo.versions.current(ID))?.snapshot).toEqual(legacy);
    expect((await repo.versions.list(ID))[0]).not.toHaveProperty("snapshot");
    await repo.projects.save(ID, 1, renamed(legacy, "New"), "alice");
    expect((await repo.versions.get(ID, 1))?.snapshot).toEqual(legacy);
    await repo.versions.restore(ID, 1, "alice");
    expect((await repo.versions.current(ID))?.snapshot.screens[0].Name).toBe(screen.Name);
  });

  it("replays live edits on top of a whole-snapshot head", async () => {
    const { storage, repo } = setup();
    const legacy = project();
    await repo.projects.create("alice", legacy);
    await storage.transaction(d => d.put("heads", { _id: ID, projectId: ID, rev: 2, author: "alice", at: 1, snapshot: renamed(legacy, "From head") }));
    await storage.transaction(async d => { const p = await d.get("projects", ID); await d.put("projects", { ...p!, rev: 2 }); });
    expect((await repo.versions.current(ID))?.snapshot.screens[0].Name).toBe("From head");
    const result = await repo.live.append(ID, [move(0, 5, 2)]);
    expect(result.rejected).toEqual([]);
    const current = await repo.versions.current(ID);
    expect(current?.snapshot.screens[0].Name).toBe("From head");
  });
});

let seq = 0;
const parts = screen.Children[0].Children;
function move(index: number, left: number, base: number): Change {
  const part = parts[index] as Part;
  return { id: `c${++seq}`, base, author: "alice", ops: [{ kind: "setPart", screenId: screen.UniqueId, part: { ...structuredClone(part), Location: { ...part.Location, Left: left } } }] };
}

describe("the live head on pieces", () => {
  it("keeps the head small, answers polls without loading it, and rebuilds any revision", async () => {
    let clock = 1_000_000;
    const { storage, repo } = setup(() => clock);
    await repo.projects.create("alice", project());
    for (let i = 0; i < 30; i++) {
      clock += 1000;
      await repo.live.append(ID, [move(i % 2, 100 + i, 1 + i)]);
    }
    const head = storage.rows("heads")[0];
    expect(head.manifest).toBeTruthy();
    expect(head.snapshot).toBeUndefined();
    expect(JSON.stringify(head).length).toBeLessThan(4000);
    const at = await repo.live.at(ID, 10);
    expect(at?.screens[0].Children[0].Children[0].Location.Left).toBe(108);
    const poll = await repo.live.since(ID, 31);
    expect(poll).toEqual({ rev: 31, changes: [] });
  });

  it("sweeps the pieces of superseded heads at a checkpoint", async () => {
    let clock = 1_000_000;
    const { storage, repo } = setup(() => clock);
    await repo.projects.create("alice", project());
    for (let i = 0; i < 20; i++) { clock += 1000; await repo.live.append(ID, [move(0, 200 + i, 1 + i)]); }
    const before = storage.rows("objects").length;
    clock += 11 * 60 * 1000;
    await repo.live.append(ID, [move(0, 999, 21)]);
    const after = storage.rows("objects").length;
    expect(after).toBeLessThan(before);
    const referenced = new Set([...storage.rows("versions"), ...storage.rows("heads")].flatMap(r => r.manifest ? hashesOf(r.manifest as Manifest) : []));
    expect(after).toBe(referenced.size);
    expect((await repo.versions.current(ID))?.snapshot.screens[0].Children[0].Children[0].Location.Left).toBe(999);
    expect(LOG_LIMIT).toBeGreaterThan(20);
  });
});

describe("queries", () => {
  it("lists a user's projects and finds the projects that use a source", async () => {
    const { repo } = setup();
    await repo.projects.create("alice", { ...project_("p1"), sourceId: "src-1" });
    await repo.projects.create("alice", project_("p2"));
    await repo.projects.create("bob", { ...project_("p3"), source: "src-1" });
    expect((await repo.projects.list("alice")).map(p => p._id).sort()).toEqual(["p1", "p2"]);
    expect((await repo.projects.referencing("src-1")).map(p => p._id).sort()).toEqual(["p1", "p3"]);
    expect(await repo.projects.referencing("nothing")).toEqual([]);
  });

  it("completes an upload whose parts are bytes, and one whose parts were base64", async () => {
    const { storage, repo } = setup();
    const u = await repo.uploads.create("a.eote", 6, "alice");
    await repo.uploads.part(u._id, 0, new Uint8Array([1, 2, 3]), "alice");
    await storage.transaction(d => d.put("uploadParts", { _id: `${u._id}:1`, uploadId: u._id, part: 1, size: 3, data: Buffer.from([4, 5, 6]).toString("base64") }));
    const id = await repo.uploads.complete(u._id, "alice");
    expect([...(await repo.sources.get(id))!.bytes]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(storage.rows("uploadParts")).toEqual([]);
  });
});

describe("the laptop store", () => {
  let dir = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("keeps compressed pieces and every table across restarts", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "hmi-db-"));
    const first = new FileRepo(dir);
    await first.projects.create("alice", project());
    await first.projects.save(ID, 1, renamed(project(), "Again"), "alice");
    // generationJobs was missing from v1's table allow-list, so its writes
    // were dropped on the laptop store.
    const job = await first.jobs.create({ projectId: ID, requestedBy: "alice", requestedByName: "Alice", request: "build" });
    const second = new FileRepo(dir);
    expect((await second.versions.current(ID))?.snapshot.screens[0].Name).toBe("Again");
    expect((await second.versions.get(ID, 1))?.snapshot).toEqual(project());
    expect((await second.jobs.get(job._id))?.request).toBe("build");
    const raw = new FileStorage(dir);
    const objects = await raw.transaction(d => d.list("objects"));
    expect(objects.length).toBeGreaterThan(0);
    expect(objects.every(o => o.z instanceof Uint8Array)).toBe(true);
  });
});

describe("reads without a transaction", () => {
  it("refuses a write inside a read, in the store tests use", async () => {
    const storage = new MemoryStorage();
    await expect(storage.read(d => d.put("projects", { _id: "x" }))).rejects.toThrow(/Write attempted inside a read/);
  });

  it("answers access, a heartbeat and a retried batch in one call each", async () => {
    const { repo } = setup();
    await repo.projects.create("alice", project());
    expect((await repo.projects.access(ID, "alice"))?.member?.role).toBe("owner");
    expect((await repo.projects.access(ID, "bob"))?.member).toBeNull();
    expect(await repo.projects.access("missing", "alice")).toBeNull();
    const { users } = await repo.live.presence.beat(ID, { userId: "alice", name: "Alice", selection: [] });
    expect(users.map(u => u.userId)).toEqual(["alice"]);
    const change = move(0, 42, 1);
    // The same id twice in one batch, then the batch again: applied once.
    const first = await repo.live.append(ID, [change, change]);
    expect(first.rev).toBe(2);
    const again = await repo.live.append(ID, [change]);
    expect(again).toEqual({ rev: 2, accepted: [change.id], rejected: [] });
  });
});

describe("a project past Mongo's 16 MB document limit", () => {
  it("is stored in pieces, none near the limit, and reads back", async () => {
    const storage = new MemoryStorage();
    const big = project();
    const filler = randomBytes(10 * 1024 * 1024).toString("hex");
    big.screens = [{ ...big.screens[0], UniqueId: "large", Name: filler }];
    const manifest = await storage.transaction(d => writeSnapshot(d, ID, big, 0));
    expect(manifest.n).toBeGreaterThan(20 * 1024 * 1024);
    expect(JSON.stringify(manifest).length).toBeLessThan(64 * 1024);
    const rows = await storage.transaction(d => d.list<{ _id: string; z: Uint8Array }>("objects", { projectId: ID }));
    for (const row of rows) expect(row.z.length).toBeLessThan(16 * 1024 * 1024);
    expect((await storage.transaction(d => readSnapshot(d, ID, manifest))).screens[0].Name).toBe(filler);
  }, 60_000);
});
