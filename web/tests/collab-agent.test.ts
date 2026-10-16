/**
 * The agent as a collaborator, end to end: two simulated browsers on one
 * MemoryRepo, each with its own project store, live session and stream feed.
 * One asks the Copilot for an edit; both receive the proposal; the other
 * accepts part of it; both stores then show exactly the accepted change,
 * which reached them through the ordinary change log authored by the agent.
 */
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { demoScreen, demoVariables } from "@/fixtures";
import { MemoryRepo, type Proposal, type Snapshot, type User } from "@/lib/server/repo";
import { decideProposal, proposalEvents, proposeEdit } from "@/lib/server/proposals";
import { CollabSession, type SessionStore, type Transport } from "@/lib/collab/sync";
import { createProjectStore, type ProjectStore } from "@/store/project";
import type { StreamEvent } from "@/lib/server/stream";
import { sample } from "./fixtures/collab";

const ID = "project-test";
const screenId = demoScreen.UniqueId;
let server: MemoryRepo;

/** A browser: a store, a session against the repo, and its stream's proposal feed. */
interface Browser {
  user: User;
  store: ProjectStore;
  session: CollabSession;
  feed: () => Promise<StreamEvent[]>;
  proposals: Map<string, Proposal>;
  handlers?: Parameters<Transport["subscribe"]>[2];
}

async function open(user: User): Promise<Browser> {
  const current = await server.versions.current(ID);
  const store = createProjectStore();
  store.getState().hydrate({ ...current!.snapshot, activeScreenId: screenId });
  const browser = { user, store, proposals: new Map(), feed: proposalEvents(ID, user.id, server) } as Browser;
  const transport: Transport = {
    post: async (projectId, body) => server.live.append(projectId, body.changes),
    presence: async () => undefined,
    snapshot: async (projectId) => {
      const v = await server.versions.current(projectId);
      return { rev: v!.rev, snapshot: v!.snapshot };
    },
    subscribe: (_id, _since, handlers) => {
      browser.handlers = handlers;
      return () => undefined;
    },
  };
  browser.session = new CollabSession({
    projectId: ID,
    author: user.id,
    rev: current!.rev,
    store: store as unknown as SessionStore,
    transport,
    timers: { set: () => 0, clear: () => undefined },
    onProposal: (body) => browser.proposals.set((body as Proposal)._id, body as Proposal),
  });
  browser.session.start();
  return browser;
}

/** What one stream poll would deliver: log changes, then proposal events. */
async function pump(browser: Browser) {
  const found = await server.live.since(ID, browser.session.revision);
  if ("changes" in found) for (const change of found.changes) browser.handlers!.change(change);
  for (const event of await browser.feed()) {
    if (event.event === "proposal") browser.handlers!.proposal?.(event.data);
  }
}

const lamp = (b: Browser) => b.store.getState().screens[0].Children[0].Children.find((p) => p.Name === "Lamp_PUMP1_RUN")!;
const title = (b: Browser) => JSON.stringify(b.store.getState().screens[0].Children[0].Children.find((p) => p.Name === "Title"));

beforeAll(() => vi.stubEnv("AI_PROVIDER", "none"));
afterAll(() => vi.unstubAllEnvs());

beforeEach(async () => {
  server = new MemoryRepo();
  const snapshot: Snapshot = { ...sample(ID), screens: [structuredClone(demoScreen)], variables: structuredClone(demoVariables) };
  await server.projects.create("ravi", snapshot);
  await server.members.put(ID, "asha", "editor");
});

it("shows the proposal to both browsers and lands only the accepted change in both", async () => {
  const ravi = await open({ id: "ravi", name: "Ravi" });
  const asha = await open({ id: "asha", name: "Asha" });
  const titleBefore = title(ravi);
  const lampBefore = lamp(ravi).Location;

  const proposal = await proposeEdit(ravi.user, ID, {
    screenId,
    request: "Move the pump lamp and retitle the screen",
    ops: [
      { op: "moveObject", target: "Lamp_PUMP1_RUN", left: 420, top: 330 },
      { op: "setText", target: "Title", text: "Station 7" },
    ],
  }, server);

  await pump(ravi);
  await pump(asha);
  for (const b of [ravi, asha]) {
    expect(b.proposals.get(proposal._id)?.status).toBe("open");
    // Seen, not applied.
    expect(lamp(b).Location).toEqual(lampBefore);
  }

  await decideProposal(asha.user, ID, proposal._id, { action: "accept", indexes: [0] }, server);
  await pump(ravi);
  await pump(asha);
  for (const b of [ravi, asha]) {
    expect(lamp(b).Location).toMatchObject({ Left: 420, Top: 330 });
    expect(title(b)).toBe(titleBefore);
    expect(b.proposals.get(proposal._id)).toMatchObject({ status: "partially-accepted", decidedByName: "Asha" });
    // An agent's change from the log is someone else's edit: nothing to send back.
    expect(b.session.unconfirmed).toBe(0);
  }
  const log = await server.live.since(ID, 1);
  expect("changes" in log && log.changes.map((c) => [c.author, c.change.acceptedBy])).toEqual([["agent:none:local", "asha"]]);
});
