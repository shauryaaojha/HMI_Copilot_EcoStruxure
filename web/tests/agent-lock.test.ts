/**
 * One Copilot turn per screen: a second request on a busy screen is told who
 * the Copilot is working for, the lock lapses after 90 s, and both a chat
 * proposal and a server-side agent run give the screen back. No model is
 * called (AI_PROVIDER=none).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { demoScreen, demoVariables } from "@/fixtures";
import { MemoryRepo, LOCK_MS, type Snapshot, type User } from "@/lib/server/repo";
import { lockScreen, proposeEdit, proposalEvents, unlockScreen } from "@/lib/server/proposals";
import { runAgentOnSnapshot, startAgent } from "@/lib/server/agent-run";
import { sample } from "./fixtures/collab";

const ID = "project-test";
const screenId = demoScreen.UniqueId;
const ravi: User = { id: "ravi", name: "Ravi" };
const asha: User = { id: "asha", name: "Asha" };
let clock = 1_000_000;
let r: MemoryRepo;

beforeAll(() => vi.stubEnv("AI_PROVIDER", "none"));
afterAll(() => vi.unstubAllEnvs());

beforeEach(async () => {
  clock = 1_000_000;
  r = new MemoryRepo(() => clock);
  const snapshot: Snapshot = { ...sample(ID), screens: [structuredClone(demoScreen)], variables: structuredClone(demoVariables) };
  await r.projects.create("ravi", snapshot);
  await r.members.put(ID, "asha", "editor");
  await r.members.put(ID, "val", "viewer");
});

describe("the screen lock", () => {
  it("allows one turn per screen and names who has it", async () => {
    await lockScreen(ravi, ID, screenId, r);
    await expect(lockScreen(asha, ID, screenId, r)).rejects.toMatchObject({
      status: 409,
      code: "busy",
      message: "Copilot is working on this screen for Ravi",
      detail: { holder: "Ravi" },
    });
    // Another screen is free, and the holder may take theirs again.
    await expect(lockScreen(asha, ID, "another-screen", r)).resolves.toMatchObject({ holder: "asha" });
    await expect(lockScreen(ravi, ID, screenId, r)).resolves.toMatchObject({ holder: "ravi" });
    await unlockScreen(ravi, ID, screenId, r);
    await expect(lockScreen(asha, ID, screenId, r)).resolves.toMatchObject({ holder: "asha" });
  });
  it("lapses after 90 seconds so a crashed turn cannot hold a screen", async () => {
    await lockScreen(ravi, ID, screenId, r);
    clock += LOCK_MS - 1;
    await expect(lockScreen(asha, ID, screenId, r)).rejects.toMatchObject({ status: 409 });
    clock += 2;
    await expect(lockScreen(asha, ID, screenId, r)).resolves.toMatchObject({ holder: "asha", expiresAt: clock + LOCK_MS });
  });
  it("is only for editors, and only the holder can release it", async () => {
    await expect(lockScreen({ id: "val", name: "Val" }, ID, screenId, r)).rejects.toMatchObject({ status: 403 });
    await lockScreen(ravi, ID, screenId, r);
    await unlockScreen(asha, ID, screenId, r);
    await expect(lockScreen(asha, ID, screenId, r)).rejects.toMatchObject({ status: 409 });
  });
  it("ends when the chat turn's proposal is made", async () => {
    await lockScreen(ravi, ID, screenId, r);
    await proposeEdit(ravi, ID, { screenId, request: "Retitle", ops: [{ op: "setText", target: "Title", text: "Hi" }] }, r);
    await expect(lockScreen(asha, ID, screenId, r)).resolves.toMatchObject({ holder: "asha" });
  });
});

describe("a server-side agent run", () => {
  it("holds the screen while it runs, streams its steps, and leaves a proposal", async () => {
    const run = await startAgent(ravi, ID, { screenId, mode: "build", goal: "Pump station overview" }, r);
    await expect(lockScreen(asha, ID, screenId, r)).rejects.toMatchObject({ message: "Copilot is working on this screen for Ravi" });
    const events = proposalEvents(ID, "ravi", r);
    // The requester's stream is already listening when the run starts.
    expect(await events()).toEqual([]);
    const proposal = await runAgentOnSnapshot(ravi, ID, run, r);
    expect(proposal).toMatchObject({ status: "open", author: "agent:none:local", requestedBy: "ravi", ops: [] });
    expect(proposal!.groups).toHaveLength(1);
    expect(proposal!.labels[0]).toMatch(/^Build: /);
    expect(proposal!.changes.length).toBeGreaterThan(0);
    // The project is untouched until an editor accepts.
    expect((await r.projects.get(ID))!.rev).toBe(1);
    const seen = await events();
    await expect(lockScreen(asha, ID, screenId, r)).resolves.toMatchObject({ holder: "asha" });
    expect(seen.some(e => e.event === "proposal")).toBe(true);
    const steps = seen.filter(e => e.event === "agent").map(e => (e.data as { kind: string }).kind);
    expect(steps).toContain("look");
    expect(steps.at(-1)).toBe("done");
  }, 30000);
  it("refuses a second run on a busy screen and an unknown mode", async () => {
    await startAgent(ravi, ID, { screenId, mode: "repair" }, r);
    await expect(startAgent(asha, ID, { screenId, mode: "repair" }, r)).rejects.toMatchObject({ status: 409 });
    await expect(startAgent(asha, ID, { screenId: "other", mode: "dance" }, r)).rejects.toMatchObject({ status: 400 });
  });
});
