/**
 * The browser side of live co-editing, with two real project stores talking
 * to one MemoryRepo through an in-memory transport: local edits queue and go
 * out in one batch, remote edits apply without being sent back (no echo),
 * pending edits are rebased over remote ones, and undo only reverts one's own.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { demoScreen, demoVariables } from "@/fixtures";
import { MemoryRepo, type Snapshot } from "@/lib/server/repo";
import { CollabSession, type SessionStore, type StreamHandlers, type Transport } from "@/lib/collab/sync";
import { createProjectStore, type ProjectStore } from "@/store/project";
import type { Change } from "@/lib/collab/types";
import { sample } from "./fixtures/collab";

const ID = "project-test";
const parts = demoScreen.Children[0].Children;
const [first, second] = parts;

/** A browser: its own store, a session, and the stream handlers the transport feeds. */
interface Client {
  store: ProjectStore;
  session: CollabSession;
  posts: Change[][];
  handlers?: StreamHandlers;
  since: number;
}

let server: MemoryRepo;

/** fetch/EventSource replaced by direct calls on the repository. */
function transport(client: () => Client): Transport {
  return {
    async post(projectId, body) {
      client().posts.push(body.changes);
      return server.live.append(projectId, body.changes);
    },
    async presence() {},
    async snapshot(projectId) {
      const v = await server.versions.current(projectId);
      return { rev: v!.rev, snapshot: v!.snapshot };
    },
    subscribe(_projectId, since, handlers) {
      client().handlers = handlers;
      client().since = since;
      return () => undefined;
    },
  };
}

/** Deliver everything the log has after what the client has heard. */
async function pump(client: Client) {
  const found = await server.live.since(ID, client.session.revision);
  if ("reset" in found) client.handlers!.reset({ rev: found.rev, snapshot: found.reset });
  else for (const change of found.changes) client.handlers!.change(change);
}

/** Timers that never fire on their own: the test flushes when it wants to. */
const manual = { set: () => 0, clear: () => undefined };

async function client(author: string | null): Promise<Client> {
  const current = await server.versions.current(ID);
  const store = createProjectStore();
  store.getState().hydrate({ ...current!.snapshot, activeScreenId: current!.snapshot.screens[0].UniqueId });
  const self = {} as Client;
  Object.assign(self, {
    store,
    posts: [],
    since: -1,
    session: new CollabSession({ projectId: ID, author, rev: current!.rev, store: store as unknown as SessionStore, transport: transport(() => self), timers: manual }),
  });
  self.session.start();
  return self;
}

const leftOf = (c: Client, id: string) =>
  c.store.getState().screens[0].Children[0].Children.find((p) => p.UniqueId === id)?.Location.Left;

beforeEach(async () => {
  server = new MemoryRepo();
  const snapshot: Snapshot = { ...sample(ID), screens: [structuredClone(demoScreen)], variables: structuredClone(demoVariables) };
  await server.projects.create("alice", snapshot);
});

describe("the queue", () => {
  it("captures committed store actions and sends them as one batch", async () => {
    const alice = await client("alice");
    alice.store.getState().nudge([first.UniqueId], 4, 0);
    alice.store.getState().nudge([first.UniqueId], 4, 0);
    alice.store.getState().select([second.UniqueId]);
    expect(alice.session.unconfirmed).toBe(2);
    await alice.session.flush();
    expect(alice.posts).toHaveLength(1);
    expect(alice.posts[0]).toHaveLength(1);
    expect(alice.posts[0][0].ops).toHaveLength(1);
    await alice.session.flush();
    expect(alice.posts).toHaveLength(1);
    await pump(alice);
    expect(alice.session.unconfirmed).toBe(0);
    expect(alice.session.revision).toBe(2);
    expect((await server.versions.current(ID))!.snapshot.screens[0].Children[0].Children[0].Location.Left).toBe(first.Location.Left + 8);
  });
  it("sends nothing for selection, hover or a read-only listener", async () => {
    const viewer = await client(null);
    viewer.store.getState().select([first.UniqueId]);
    viewer.store.getState().hover(first.UniqueId);
    await viewer.session.flush();
    expect(viewer.posts).toEqual([]);
    const alice = await client("alice");
    alice.store.getState().select([first.UniqueId]);
    expect(alice.session.unconfirmed).toBe(0);
  });
});

describe("remote changes", () => {
  it("apply to the store without being sent back", async () => {
    const alice = await client("alice");
    const bob = await client("bob");
    bob.store.getState().nudge([second.UniqueId], 0, 30);
    await bob.session.flush();
    await pump(alice);
    expect(alice.store.getState().screens[0].Children[0].Children[1].Location.Top).toBe(second.Location.Top + 30);
    expect(alice.session.unconfirmed).toBe(0);
    await alice.session.flush();
    expect(alice.posts).toEqual([]);
    // Bob hears his own change back as a confirmation, not as a new edit.
    await pump(bob);
    expect(bob.session.unconfirmed).toBe(0);
    await bob.session.flush();
    expect(bob.posts).toHaveLength(1);
  });
  it("rebase pending local edits over them, and both browsers converge", async () => {
    const alice = await client("alice");
    const bob = await client("bob");
    alice.store.getState().nudge([first.UniqueId], 10, 0);
    bob.store.getState().nudge([second.UniqueId], 20, 0);
    bob.store.getState().nudge([first.UniqueId], 99, 0);
    await bob.session.flush();
    await pump(alice);
    // Alice's own unsent move of the first part survives Bob's, on her screen.
    expect(leftOf(alice, first.UniqueId)).toBe(first.Location.Left + 10);
    expect(leftOf(alice, second.UniqueId)).toBe(second.Location.Left + 20);
    await alice.session.flush();
    await pump(alice);
    await pump(bob);
    // Last writer wins on the shared part: Alice sent after Bob.
    for (const c of [alice, bob]) {
      expect(leftOf(c, first.UniqueId)).toBe(first.Location.Left + 10);
      expect(leftOf(c, second.UniqueId)).toBe(second.Location.Left + 20);
    }
    expect(alice.session.unconfirmed + bob.session.unconfirmed).toBe(0);
  });
  it("take a reset when the client is behind a whole-snapshot save", async () => {
    const alice = await client("alice");
    const current = await server.versions.current(ID);
    await server.projects.save(ID, current!.rev, { ...current!.snapshot, name: "Renamed elsewhere" }, "bob");
    await pump(alice);
    expect(alice.store.getState().name).toBe("Renamed elsewhere");
    expect(alice.session.revision).toBe(2);
  });
});

describe("undo", () => {
  it("reverts only this person's change, by sending its inverse", async () => {
    const alice = await client("alice");
    const bob = await client("bob");
    alice.store.getState().nudge([first.UniqueId], 5, 0);
    await alice.session.flush();
    bob.store.getState().nudge([second.UniqueId], 7, 0);
    await bob.session.flush();
    await pump(alice);
    alice.store.getState().undo();
    expect(leftOf(alice, first.UniqueId)).toBe(first.Location.Left);
    expect(leftOf(alice, second.UniqueId)).toBe(second.Location.Left + 7);
    await alice.session.flush();
    await pump(bob);
    expect(leftOf(bob, first.UniqueId)).toBe(first.Location.Left);
    expect(leftOf(bob, second.UniqueId)).toBe(second.Location.Left + 7);
    alice.store.getState().redo();
    expect(leftOf(alice, first.UniqueId)).toBe(first.Location.Left + 5);
    alice.session.stop();
    expect(alice.store.getState().undo).not.toBe(bob.store.getState().undo);
  });
});
