/**
 * A proposal that builds on another still in the queue: the second call names
 * a screen the first one adds. It used to be refused op by op ("no screen
 * called Home"); now it is worked out on top of the queue and waits for it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { demoScreen, demoVariables } from "@/fixtures";
import { MemoryRepo, type Snapshot, type User } from "@/lib/server/repo";
import { decideProposal, proposeEdit } from "@/lib/server/proposals";
import { sample } from "./fixtures/collab";

const ID = "project-stack";
const ravi: User = { id: "ravi", name: "Ravi" };
let clock = 1_000_000;
let r: MemoryRepo;

beforeAll(() => vi.stubEnv("AI_PROVIDER", "none"));
afterAll(() => vi.unstubAllEnvs());

beforeEach(async () => {
  clock = 1_000_000;
  r = new MemoryRepo(() => clock++);
  const snapshot: Snapshot = { ...sample(ID), screens: [structuredClone(demoScreen)], variables: structuredClone(demoVariables) };
  await r.projects.create("ravi", snapshot);
});

const shell = [{ op: "addScreen", name: "Home" }] as never;
const body = [{ op: "addObject", screen: "Home", type: "TextBox", name: "Home_Title", text: "Home" }] as never;

describe("stacked proposals", () => {
  it("works a second proposal out on top of the first, and records that it depends on it", async () => {
    const first = await proposeEdit(ravi, ID, { ops: shell, request: "Home shell" }, r, "mcp");
    const second = await proposeEdit(ravi, ID, { ops: body, request: "Home body" }, r, "mcp");
    expect(first.rejected).toEqual([]);
    expect(second.rejected).toEqual([]);
    expect(second.dependsOn).toEqual([first._id]);
  });

  it("refuses to accept the second while the first is open, then lands both in order", async () => {
    const first = await proposeEdit(ravi, ID, { ops: shell, request: "Home shell" }, r, "mcp");
    const second = await proposeEdit(ravi, ID, { ops: body, request: "Home body" }, r, "mcp");
    await expect(decideProposal(ravi, ID, second._id, { action: "accept" }, r)).rejects.toMatchObject({ status: 409, code: "depends" });
    await decideProposal(ravi, ID, first._id, { action: "accept" }, r);
    const landed = await decideProposal(ravi, ID, second._id, { action: "accept" }, r);
    expect(landed.status).toBe("accepted");
    const head = await r.versions.current(ID);
    const home = head!.snapshot.screens.find((s: { Name: string }) => s.Name === "Home");
    expect(home).toBeTruthy();
    expect(JSON.stringify(home)).toContain("Home_Title");
  });

  it("leaves a self-contained proposal alone", async () => {
    await proposeEdit(ravi, ID, { ops: shell, request: "Home shell" }, r, "mcp");
    const own = await proposeEdit(ravi, ID, { ops: [{ op: "addScreen", name: "Alarms" }] as never, request: "Alarms" }, r, "mcp");
    expect(own.dependsOn).toBeUndefined();
  });
});
