/**
 * `generate` as a job: phase 4, M3.
 *
 * Driven through the route as JSON-RPC, like tests/mcp.test.ts, because the
 * thing being tested is partly the shape of the answer: a build takes longer
 * than Claude allows for one tool call (docs/CONNECTOR_SPEC_NOTES.md §2), so
 * `generate` has to come back with an id while the work is still going, and
 * `generation_status` has to be able to tell the engineer where it got to from
 * a different invocation.
 *
 * Four rules are held hardest here. A job is not privileged: a project that
 * has not opted in to direct writes gets a proposal from a job exactly as it
 * does from `apply_ops`. A job belongs to whoever started it, and nobody else
 * may read or cancel it. An unconfirmed brief never becomes tags - the fields
 * come back named and the project is untouched. And the job writes through
 * `core/ops`, so an op it cannot resolve is refused in core/ops' own words
 * rather than quietly dropped.
 *
 * No model is called: with no provider configured the brief is drafted by the
 * rules and the pipeline lays out from the tag names.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepo, type Snapshot, type User } from "@/lib/server/repo";
import { sample } from "./fixtures/collab";

const state = vi.hoisted(() => ({ repo: null as unknown as MemoryRepo, user: null as User | null }));
vi.mock("@/lib/server/repo", async original => ({ ...await original<typeof import("@/lib/server/repo")>(), repo: () => state.repo }));
vi.mock("@/lib/server/session", () => ({ currentUser: async () => state.user }));
import { POST as mcpPost } from "@/app/api/mcp/route";
import { GENERATES_PER_USER } from "@/lib/server/rate-limit";

const ID = "project-empty";
const URL_MCP = "https://hmi.example.com/api/mcp";

/** A brief an engineer has agreed to: two pumps and a break tank. */
const CONFIRMED = {
  plant: { name: "Transfer Station", purpose: "lifts raw water to the break tank" },
  units: [
    { id: "pump-1", kind: "pump", label: "Transfer pump", count: 2, signals: ["RUN", "FLT", "START", "STOP"] },
    { id: "tank-1", kind: "tank", label: "Break tank", count: 1, signals: ["PV", "HI", "LO"] },
  ],
};

/** The same brief with nobody having said how many pumps there are. */
const NO_COUNT = {
  ...CONFIRMED,
  units: [{ ...CONFIRMED.units[0], count: undefined }, CONFIRMED.units[1]],
};

let seq = 0;

async function rpc(method: string, params?: unknown) {
  const response = await mcpPost(
    new Request(URL_MCP, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, ...(params ? { params } : {}) }),
    }),
  );
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const { body } = await rpc("tools/call", { name, arguments: args });
  expect(body.error, `${name} answered a protocol error: ${JSON.stringify(body.error)}`).toBeUndefined();
  const result = body.result as { content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
  return {
    text: result.content.filter(c => c.type === "text").map(c => c.text).join("\n"),
    structured: result.structuredContent as Record<string, unknown> | undefined,
    refused: result.isError === true,
  };
}

const snapshotOf = async (id = ID) => (await state.repo.versions.current(id))!;

/** Start a build and wait for the job to stop moving. */
async function build(args: Record<string, unknown> = { projectId: ID, brief: CONFIRMED }) {
  const started = await call("generate", args);
  const jobId = started.structured?.jobId as string;
  expect(jobId, started.text).toBeTruthy();
  const finished = await vi.waitFor(
    async () => {
      const status = await call("generation_status", { jobId });
      expect(["done", "failed", "cancelled"]).toContain(status.structured?.state);
      return status;
    },
    { timeout: 20_000, interval: 10 },
  );
  return { started, jobId, finished };
}

beforeAll(() => vi.stubEnv("AI_PROVIDER", "none"));
afterAll(() => vi.unstubAllEnvs());

beforeEach(async () => {
  vi.stubEnv("MCP_DEV_USER_ID", "");
  // An empty project: generate lays out an application, it does not edit one.
  const snapshot: Snapshot = { ...sample(ID), name: "Transfer Station" };
  state.repo = new MemoryRepo();
  await state.repo.projects.create("alice", snapshot);
  await state.repo.members.put(ID, "bob", "editor");
  await state.repo.members.put(ID, "val", "viewer");
  state.user = { id: "alice", name: "Alice" };
});

describe("starting a build", () => {
  it("answers with a job id and has not built anything yet", async () => {
    const before = await snapshotOf();
    const { text, structured, refused } = await call("generate", { projectId: ID, brief: CONFIRMED });
    expect(refused).toBe(false);
    expect(typeof structured?.jobId).toBe("string");
    // Queued, not finished: the id is the answer, the build is not.
    expect(structured).toMatchObject({ state: "queued", units: 2 });
    expect(text).toContain("generation_status");
    expect(text).toContain("as a proposal for an editor to accept");
    const after = await snapshotOf();
    expect(after.rev).toBe(before.rev);
    expect(JSON.stringify(after.snapshot)).toBe(JSON.stringify(before.snapshot));
    expect(await state.repo.proposals.list(ID)).toHaveLength(0);
  });

  it("reports the steps as it goes, and then the result", async () => {
    const { finished } = await build();
    expect(finished.structured).toMatchObject({ state: "done", of: 8, percent: 100, steps: 8 });
    // Progress is the pipeline's own detail lines, not a spinner.
    expect(finished.text).toContain("ingest done");
    expect(finished.text).toContain("layout done");
    expect(finished.text).toContain("8 of 8 steps done (100%)");
    expect(finished.text).toContain("placeholder tag");
  });
});

describe("a job is not privileged", () => {
  it("queues a proposal on a project that has not opted in to direct writes", async () => {
    const before = await snapshotOf();
    const { finished } = await build();
    expect(finished.structured).toMatchObject({ state: "done", mode: "proposal" });

    // Nothing landed: the project is at the revision it was, byte for byte.
    const after = await snapshotOf();
    expect(after.rev).toBe(before.rev);
    expect(JSON.stringify(after.snapshot)).toBe(JSON.stringify(before.snapshot));
    expect(after.snapshot.variables).toHaveLength(0);

    // And an editor has one decision to make, with the tags and the screens
    // inside it so they cannot be accepted apart.
    const proposals = await state.repo.proposals.list(ID);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ status: "open", requestedBy: "alice" });
    expect(proposals[0].labels).toHaveLength(1);
    expect(proposals[0].changes.some(c => c.kind === "setVariable")).toBe(true);
    expect(proposals[0].changes.some(c => c.kind === "addScreen")).toBe(true);
    expect(finished.text).toContain("Nothing in the project has changed yet");
  });

  it("applies directly on a project that has opted in, through the same landing", async () => {
    await state.repo.projects.connector(ID, { directWrites: true });
    const before = await snapshotOf();
    const { finished } = await build();
    expect(finished.structured).toMatchObject({ state: "done", mode: "direct" });

    const after = await snapshotOf();
    expect(after.rev).toBeGreaterThan(before.rev);
    expect(after.snapshot.screens.length).toBeGreaterThan(0);
    // The placeholder tags the brief produced, and nothing else.
    expect(after.snapshot.variables.map(v => v.Name)).toContain("PMP_101_RUN");
    expect(after.snapshot.variables.map(v => v.Name)).toContain("LT_101_PV");
    expect(after.snapshot.tagImport?.pending).toBe(true);
    // A direct write from a job is still an AI change with a human's standing
    // agreement against it.
    const log = await state.repo.live.since(ID, before.rev);
    expect("changes" in log && log.changes[0].change.author).toBe("agent:none:local");
    expect("changes" in log && log.changes[0].change.acceptedBy).toBe("alice");
    expect(await state.repo.proposals.list(ID)).toHaveLength(0);
  });
});

describe("whose job it is", () => {
  it("hides a job from another member, who can neither read nor cancel it", async () => {
    const { jobId } = await build();
    state.user = { id: "bob", name: "Bob" };
    for (const name of ["generation_status", "generation_cancel"]) {
      const { refused, text } = await call(name, { jobId });
      expect(refused, name).toBe(true);
      // Not "forbidden": telling a stranger the id is real is itself an answer.
      expect(text).toContain("No generation job of yours has that id");
    }
    // Bob may still read the project, so it is the job that is private.
    expect((await call("get_screens", { projectId: ID })).refused).toBe(false);
  });

  it("refuses a caller who may only read the project", async () => {
    state.user = { id: "val", name: "Val" };
    const { refused, text } = await call("generate", { projectId: ID, brief: CONFIRMED });
    expect(refused).toBe(true);
    expect(text).toContain("permission");
    expect(await state.repo.jobs.list(ID)).toHaveLength(0);
    expect((await snapshotOf()).snapshot.variables).toHaveLength(0);
  });

  it("cancels its own job, which then writes nothing", async () => {
    const started = await call("generate", { projectId: ID, brief: CONFIRMED });
    const jobId = started.structured?.jobId as string;
    const { structured } = await call("generation_cancel", { jobId });
    expect(structured).toMatchObject({ state: "cancelled" });
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(await state.repo.proposals.list(ID)).toHaveLength(0);
    expect((await snapshotOf()).snapshot.variables).toHaveLength(0);
  });
});

describe("the brief gate", () => {
  it("refuses a brief with no count, naming the field, and creates no tags", async () => {
    const { text, structured, refused } = await call("generate", { projectId: ID, brief: NO_COUNT });
    expect(refused).toBe(true);
    expect(structured).toMatchObject({ code: "brief-unconfirmed" });
    expect((structured?.problems as { field: string }[])).toEqual([{ unitId: "pump-1", field: "count" }]);
    expect(text).toContain("count");
    expect(text).toContain("Transfer pump has no count");
    // No job, no tags, no proposal: the gate is before any of it.
    expect(await state.repo.jobs.list(ID)).toHaveLength(0);
    expect(await state.repo.proposals.list(ID)).toHaveLength(0);
    expect((await snapshotOf()).snapshot.variables).toHaveLength(0);
  });

  it("reads a description back as rows to agree to rather than building from it", async () => {
    const { text, structured, refused } = await call("generate", { projectId: ID, description: "a transfer station with two pumps and a break tank" });
    expect(refused).toBe(false);
    expect(structured).toMatchObject({ needsConfirm: true, by: "rules" });
    expect(text).toContain("2 x Pump");
    expect(text).toContain("confirm: true");
    expect(await state.repo.jobs.list(ID)).toHaveLength(0);
    expect((await snapshotOf()).snapshot.variables).toHaveLength(0);
  });

  it("asks the engineer when the description names no equipment at all", async () => {
    const { text, structured } = await call("generate", { projectId: ID, description: "a facility that does something with the stuff" });
    expect((structured?.questions as string[]).length).toBeGreaterThan(0);
    expect(text).toContain("no tags were created");
    expect(await state.repo.jobs.list(ID)).toHaveLength(0);
  });
});

describe("what a build costs", () => {
  it("caps a user's builds in one window, reusing the sign-in counter", async () => {
    for (let n = 0; n < GENERATES_PER_USER; n++) {
      expect((await call("generate", { projectId: ID, brief: CONFIRMED })).refused, `build ${n + 1}`).toBe(false);
    }
    const { refused, text } = await call("generate", { projectId: ID, brief: CONFIRMED });
    expect(refused).toBe(true);
    expect(text).toContain("Too many attempts");
  });
});
