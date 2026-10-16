/**
 * The server side of live co-editing: two clients against one MemoryRepo.
 * Edits to different parts both land, the same part goes to the last writer,
 * a stale base is applied on top of what is there, the log keeps its last
 * 2,000 entries, and a client further behind than that gets a reset.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoScreen, demoVariables } from "@/fixtures";
import { MemoryRepo, type Snapshot, type User } from "@/lib/server/repo";
import { LOG_LIMIT } from "@/lib/server/repo-live";
import { projectEvents, sse } from "@/lib/server/stream";
import type { Change, StoreChange } from "@/lib/collab/types";
import type { Part } from "@/lib/ote/schema";
import { sample } from "./fixtures/collab";

const state = vi.hoisted(() => ({ repo: null as unknown as MemoryRepo, user: null as User | null }));
vi.mock("@/lib/server/repo", async original => ({ ...await original<typeof import("@/lib/server/repo")>(), repo: () => state.repo }));
vi.mock("@/lib/server/session", () => ({ currentUser: async () => state.user }));
import { POST as postChanges } from "@/app/api/projects/[id]/changes/route";
import { POST as postPresence } from "@/app/api/projects/[id]/presence/route";
import { GET as getProject } from "@/app/api/projects/[id]/route";

const ID = "project-test";
const screen = structuredClone(demoScreen);
const screenId = screen.UniqueId;
const parts = screen.Children[0].Children;
const [first, second] = parts;

/** The demo pump station as a server project. */
function project(): Snapshot {
  return { ...sample(ID), screens: [structuredClone(screen)], variables: structuredClone(demoVariables) };
}

let seq = 0;
/** One change moving a part to `left`, as a client would send it. */
function move(part: Part, left: number, author: string, base: number): Change {
  const moved = { ...structuredClone(part), Location: { ...part.Location, Left: left } };
  return { id: `c${++seq}`, base, author, ops: [{ kind: "setPart", screenId, part: moved }] };
}

const partOf = async (id: string) => {
  const current = await state.repo.versions.current(ID);
  return current?.snapshot.screens[0].Children[0].Children.find(p => p.UniqueId === id);
};

beforeEach(async () => {
  seq = 0;
  state.repo = new MemoryRepo();
  state.user = { id: "alice", name: "Alice" };
  await state.repo.projects.create("alice", project());
  await state.repo.members.put(ID, "bob", "editor");
  await state.repo.members.put(ID, "val", "viewer");
});

describe("applying changes", () => {
  it("lands concurrent edits to different parts, one revision each", async () => {
    const a = await state.repo.live.append(ID, [move(first, 11, "alice", 1)]);
    const b = await state.repo.live.append(ID, [move(second, 22, "bob", 1)]);
    expect(a).toEqual({ rev: 2, accepted: ["c1"], rejected: [] });
    expect(b.rev).toBe(3);
    expect((await partOf(first.UniqueId))?.Location.Left).toBe(11);
    expect((await partOf(second.UniqueId))?.Location.Left).toBe(22);
    expect((await state.repo.projects.get(ID))?.rev).toBe(3);
  });
  it("gives the same part to the last writer, whatever base it had seen", async () => {
    await state.repo.live.append(ID, [move(first, 100, "alice", 1)]);
    await state.repo.live.append(ID, [move(first, 200, "bob", 1)]);
    expect((await partOf(first.UniqueId))?.Location.Left).toBe(200);
  });
  it("applies a stale base on top of the latest snapshot rather than refusing it", async () => {
    await state.repo.live.append(ID, [move(first, 5, "alice", 1)]);
    await state.repo.live.append(ID, [move(first, 6, "alice", 2)]);
    const stale = await state.repo.live.append(ID, [move(second, 7, "bob", 1)]);
    expect(stale.accepted).toHaveLength(1);
    expect((await partOf(first.UniqueId))?.Location.Left).toBe(6);
    expect((await partOf(second.UniqueId))?.Location.Left).toBe(7);
  });
  it("lets removePart beat a setPart only when it arrived later", async () => {
    const remove: StoreChange = { kind: "removePart", screenId, partId: first.UniqueId };
    await state.repo.live.append(ID, [move(first, 9, "alice", 1), { id: "rm", base: 1, author: "bob", ops: [remove] }]);
    expect(await partOf(first.UniqueId)).toBeUndefined();
    await state.repo.live.append(ID, [move(first, 10, "alice", 1)]);
    expect((await partOf(first.UniqueId))?.Location.Left).toBe(10);
  });
  it("does not apply a retried change twice, and says why a change was refused", async () => {
    const change = move(first, 33, "alice", 1);
    await state.repo.live.append(ID, [change]);
    const again = await state.repo.live.append(ID, [change]);
    expect(again).toEqual({ rev: 2, accepted: [change.id], rejected: [] });
    const lost = await state.repo.live.append(ID, [
      { id: "lost", base: 2, author: "alice", ops: [{ kind: "setPart", screenId: "gone", part: first }] },
      { id: "bad", base: 2, author: "alice", ops: [{ kind: "nonsense" } as never] },
    ]);
    expect(lost.rejected).toEqual([{ id: "lost", reason: "screen-missing" }, { id: "bad", reason: "malformed operation" }]);
    expect(lost.rev).toBe(2);
  });
});

describe("the log", () => {
  it("replays changes after a revision, and resets a client the log no longer reaches", async () => {
    await state.repo.live.append(ID, [move(first, 1, "alice", 1), move(first, 2, "alice", 1)]);
    const found = await state.repo.live.since(ID, 1);
    expect("changes" in found && found.changes.map(c => c.rev)).toEqual([2, 3]);
    expect(await state.repo.live.since(ID, 3)).toEqual({ rev: 3, changes: [] });
    // A whole-snapshot save leaves no log entry: a client behind it starts over.
    const current = await state.repo.versions.current(ID);
    await state.repo.projects.save(ID, 3, current!.snapshot, "alice");
    const reset = await state.repo.live.since(ID, 3);
    expect("reset" in reset && reset.rev).toBe(4);
  });
  it("keeps the last 2,000 changes and folds older ones into the head", async () => {
    let base = 1;
    for (let batch = 0; batch < 5; batch++) {
      const changes = Array.from({ length: 401 }, (_, i) => move(first, batch * 1000 + i, "alice", base));
      base = (await state.repo.live.append(ID, changes)).rev;
    }
    expect(base).toBe(1 + 5 * 401);
    const recent = await state.repo.live.since(ID, base - 10);
    expect("changes" in recent && recent.changes).toHaveLength(10);
    const oldest = base - LOG_LIMIT;
    const edge = await state.repo.live.since(ID, oldest);
    expect("changes" in edge && edge.changes[0].rev).toBe(oldest + 1);
    const tooOld = await state.repo.live.since(ID, oldest - 1);
    expect("reset" in tooOld && tooOld.reset.screens[0].Children[0].Children.find(p => p.UniqueId === first.UniqueId)?.Location.Left).toBe(4400);
  }, 30000);
  it("rebuilds the snapshot at an older revision for export", async () => {
    await state.repo.live.append(ID, [move(first, 50, "alice", 1), move(first, 60, "alice", 2)]);
    expect((await state.repo.live.at(ID, 2))?.screens[0].Children[0].Children[0].Location.Left).toBe(50);
    expect((await state.repo.live.at(ID, 3))?.screens[0].Children[0].Children[0].Location.Left).toBe(60);
    expect(await state.repo.live.at(ID, 99)).toBeNull();
  });
});

describe("routes and stream", () => {
  const request = (body: unknown) => new Request(`http://localhost/api/projects/${ID}/changes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const context = { params: Promise.resolve({ id: ID }) };
  it("accepts editors, refuses viewers, and always records the signed-in author", async () => {
    state.user = { id: "bob", name: "Bob" };
    const accepted = await postChanges(request({ base: 1, changes: [{ ...move(first, 70, "agent:claude:x", 1) }] }), context);
    expect(await accepted.json()).toMatchObject({ rev: 2, accepted: ["c1"] });
    const logged = await state.repo.live.since(ID, 1);
    expect("changes" in logged && logged.changes[0].author).toBe("bob");
    state.user = { id: "val", name: "Val" };
    expect((await postChanges(request({ base: 2, changes: [move(first, 1, "val", 2)] }), context)).status).toBe(403);
    const read = await (await getProject(new Request(`http://localhost/api/projects/${ID}`), context)).json();
    expect(read.rev).toBe(2);
    expect(read.snapshot.screens[0].Children[0].Children[0].Location.Left).toBe(70);
  });
  it("streams changes after `since`, presence, and ends with a ping", async () => {
    await state.repo.live.append(ID, [move(first, 1, "alice", 1)]);
    state.user = { id: "bob", name: "Bob" };
    await postPresence(new Request(`http://localhost/api/projects/${ID}/presence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ screenId, selection: [first.UniqueId], cursor: { x: 4, y: 5 } }) }), context);
    const events = [];
    for await (const event of projectEvents(ID, 1, { storage: state.repo, duration: 1, sleep: async () => undefined })) events.push(event);
    expect(events.map(e => e.event)).toEqual(["change", "presence", "ping"]);
    expect(events[1].data).toMatchObject({ users: [{ userId: "bob", name: "Bob", screenId, selection: [first.UniqueId], cursor: { x: 4, y: 5 } }] });
    expect(sse(events[2])).toBe('event: ping\ndata: {"rev":2}\n\n');
    const behind = [];
    for await (const event of projectEvents(ID, 0, { storage: state.repo, duration: 1, sleep: async () => undefined })) behind.push(event.event);
    expect(behind[0]).toBe("reset");
  });
  it("forgets presence after 15 seconds", async () => {
    let clock = 0;
    const r = new MemoryRepo(() => clock);
    await r.projects.create("alice", project());
    await r.live.presence.put(ID, { userId: "bob", name: "Bob", selection: [] });
    expect(await r.live.presence.list(ID)).toHaveLength(1);
    clock = 15_001;
    expect(await r.live.presence.list(ID)).toEqual([]);
  });
});
