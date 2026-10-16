/**
 * The Copilot's proposals in a shared project: created by a dry run on the
 * server snapshot, accepted op by op (only the ticked changes land, authored
 * by the agent, with the editor recorded and the decision logged), discarded,
 * and guarded by the role matrix. No model is called.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { demoScreen, demoVariables } from "@/fixtures";
import { MemoryRepo, type Snapshot, type User } from "@/lib/server/repo";
import { agentAuthor, decideProposal, proposeEdit } from "@/lib/server/proposals";
import { createComment } from "@/lib/server/comments";
import { renderReport } from "@/lib/validation/report";
import type { Op } from "@/lib/ai/ops";
import { sample } from "./fixtures/collab";

const state = vi.hoisted(() => ({ repo: null as unknown as MemoryRepo, user: null as User | null }));
vi.mock("@/lib/server/repo", async original => ({ ...await original<typeof import("@/lib/server/repo")>(), repo: () => state.repo }));
vi.mock("@/lib/server/session", () => ({ currentUser: async () => state.user }));
import { GET as listProposals } from "@/app/api/projects/[id]/proposals/route";
import { signoffSections } from "@/lib/server/signoff";

const ID = "project-test";
const screenId = demoScreen.UniqueId;
const as = (id: string): User => ({ id, name: id[0].toUpperCase() + id.slice(1) });
const MOVE: Op = { op: "moveObject", target: "Lamp_PUMP1_RUN", left: 400, top: 300 };
const TEXT: Op = { op: "setText", target: "Title", text: "Station 7" };

const part = async (name: string) => {
  const current = await state.repo.versions.current(ID);
  return current!.snapshot.screens[0].Children[0].Children.find(p => p.Name === name)!;
};

beforeAll(() => vi.stubEnv("AI_PROVIDER", "none"));
afterAll(() => vi.unstubAllEnvs());

beforeEach(async () => {
  state.repo = new MemoryRepo();
  const snapshot: Snapshot = { ...sample(ID), screens: [structuredClone(demoScreen)], variables: structuredClone(demoVariables) };
  await state.repo.projects.create("alice", snapshot);
  await state.repo.members.put(ID, "bob", "editor");
  await state.repo.members.put(ID, "cat", "commenter");
  await state.repo.members.put(ID, "val", "viewer");
});

describe("creating", () => {
  it("dry-runs the ops on the server snapshot and changes nothing yet", async () => {
    const before = await part("Lamp_PUMP1_RUN");
    const proposal = await proposeEdit(as("bob"), ID, { screenId, request: "Move the pump lamp and retitle", ops: [MOVE, TEXT] }, state.repo);
    expect(proposal).toMatchObject({ status: "open", requestedBy: "bob", requestedByName: "Bob", author: "agent:none:local", screenId });
    expect(proposal.labels).toHaveLength(2);
    expect(proposal.changes.some(c => c.kind === "setPart" && c.part.Name === "Lamp_PUMP1_RUN" && c.part.Location.Left === 400)).toBe(true);
    expect(proposal.changes.some(c => c.kind === "setPart" && c.part.Name === "Title")).toBe(true);
    expect((await part("Lamp_PUMP1_RUN")).Location).toEqual(before.Location);
    expect(agentAuthor()).toBe("agent:none:local");
  });
  it("marks what the Copilot placed or changed as generated", async () => {
    const title = await part("Title");
    const current = await state.repo.versions.current(ID);
    await state.repo.live.append(ID, [{ id: "seed", base: current!.rev, author: "alice", ops: [{ kind: "setEntry", field: "objectMeta", key: title.UniqueId, value: { origin: "generated", key: "title" } }] }]);
    const ops: Op[] = [
      { op: "addScreen", name: "Notes" },
      { op: "addObject", screen: "Notes", type: "TextBox", name: "Note_1", text: "Check pump", place: { region: "body" } },
      TEXT,
    ];
    const proposal = await proposeEdit(as("bob"), ID, { screenId, request: "Add notes", ops }, state.repo);
    expect(proposal.rejected).toEqual([]);
    const screen = proposal.changes.find(c => c.kind === "addScreen");
    const note = screen?.kind === "addScreen" ? screen.screen.Children[0].Children.find(p => p.Name === "Note_1") : undefined;
    expect(note).toBeTruthy();
    expect(proposal.changes).toContainEqual({ kind: "setEntry", field: "objectMeta", key: note!.UniqueId, value: { origin: "generated" } });
    // An edit by the Copilot to a generated part is not the engineer's hand.
    expect(proposal.changes.some(c => c.kind === "setEntry" && c.field === "objectMeta" && c.key === title.UniqueId)).toBe(false);
  });
  it("refuses malformed ops", async () => {
    await expect(proposeEdit(as("bob"), ID, { screenId, ops: [{ op: "explode" }] }, state.repo)).rejects.toMatchObject({ status: 400 });
  });
});

describe("deciding", () => {
  it("accepts a subset: only those changes land, authored by the agent, and the decision is logged", async () => {
    const titleBefore = await part("Title");
    const proposal = await proposeEdit(as("bob"), ID, { screenId, request: "Move and retitle", ops: [MOVE, TEXT] }, state.repo);
    const decided = await decideProposal(as("alice"), ID, proposal._id, { action: "accept", indexes: [0] }, state.repo);
    expect(decided).toMatchObject({ status: "partially-accepted", decidedBy: "alice", decidedByName: "Alice", acceptedOpIndexes: [0] });
    expect((await part("Lamp_PUMP1_RUN")).Location).toMatchObject({ Left: 400, Top: 300 });
    expect(await part("Title")).toEqual(titleBefore);
    const log = await state.repo.live.since(ID, 1);
    expect("changes" in log && log.changes).toHaveLength(1);
    const entry = "changes" in log ? log.changes[0] : null;
    expect(entry?.author).toBe("agent:none:local");
    expect(entry?.change.acceptedBy).toBe("alice");
    expect(decided.rev).toBe(entry?.rev);
    const decisions = await state.repo.proposals.decisions(ID);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ decision: "partially-accepted", by: "alice", byName: "Alice", requestedByName: "Bob", accepted: [proposal.labels[0]] });
    await expect(decideProposal(as("bob"), ID, proposal._id, { action: "accept" }, state.repo)).rejects.toMatchObject({ status: 409 });
  });
  it("accepts everything, or discards without touching the project", async () => {
    const all = await proposeEdit(as("bob"), ID, { screenId, request: "Retitle", ops: [TEXT] }, state.repo);
    expect((await decideProposal(as("bob"), ID, all._id, { action: "accept" }, state.repo)).status).toBe("accepted");
    expect(JSON.stringify(await part("Title"))).toContain("Station 7");
    const revBefore = (await state.repo.projects.get(ID))!.rev;
    const other = await proposeEdit(as("bob"), ID, { screenId, request: "Move", ops: [MOVE] }, state.repo);
    expect((await decideProposal(as("alice"), ID, other._id, { action: "discard" }, state.repo)).status).toBe("discarded");
    expect((await state.repo.projects.get(ID))!.rev).toBe(revBefore);
    expect((await state.repo.proposals.decisions(ID)).map(d => d.decision)).toEqual(["accepted", "discarded"]);
  });
  it("puts every decision in the sign-off report", async () => {
    const proposal = await proposeEdit(as("bob"), ID, { screenId, request: "Retitle the overview", ops: [TEXT] }, state.repo);
    await decideProposal(as("alice"), ID, proposal._id, { action: "accept" }, state.repo);
    const project = { name: "Station", target: { model: "HMIST6", width: 800, height: 480 }, screens: [demoScreen], variables: [], alarms: [], wires: [] };
    state.user = as("val");
    const sections = await signoffSections(ID, project, as("val"), new Request("http://localhost/x"), state.repo);
    const html = renderReport({ project, findings: [], ...sections });
    expect(html).toContain("AI-suggested changes and who accepted them");
    expect(html).toContain("Retitle the overview");
    expect(html).toContain("<td>Alice</td>");
    expect(html).toContain("agent:none:local");
  });
});

describe("permissions", () => {
  it("lets editors and the owner ask and decide, commenters comment, viewers read", async () => {
    for (const who of ["cat", "val", "stranger"]) {
      await expect(proposeEdit(as(who), ID, { screenId, ops: [TEXT] }, state.repo)).rejects.toMatchObject({ status: 403 });
    }
    await expect(proposeEdit(null, ID, { screenId, ops: [TEXT] }, state.repo)).rejects.toMatchObject({ status: 401 });
    const proposal = await proposeEdit(as("alice"), ID, { screenId, request: "Retitle", ops: [TEXT] }, state.repo);
    for (const who of ["cat", "val"]) {
      await expect(decideProposal(as(who), ID, proposal._id, { action: "accept" }, state.repo)).rejects.toMatchObject({ status: 403 });
    }
    const note = await createComment(as("cat"), ID, { body: "Title should stay as is", proposalId: proposal._id }, state.repo);
    expect(note.proposalId).toBe(proposal._id);
    await expect(createComment(as("val"), ID, { body: "me too", proposalId: proposal._id }, state.repo)).rejects.toMatchObject({ status: 403 });
    state.user = as("val");
    const listed = await (await listProposals(new Request("http://localhost/x"), { params: Promise.resolve({ id: ID }) })).json();
    expect(listed.proposals).toHaveLength(1);
    state.user = as("stranger");
    expect((await listProposals(new Request("http://localhost/x"), { params: Promise.resolve({ id: ID }) })).status).toBe(403);
  });
});
