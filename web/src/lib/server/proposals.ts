/**
 * The Copilot's suggestions in a shared project (Phase D).
 *
 * The agent is a member in all but name: its author id is
 * `agent:<provider>:<model>`, its display name "HMI Copilot", and every change
 * it makes carries that author through the Phase C log. What it never does is
 * commit on its own: a request becomes a proposal that every member sees, and
 * only an editor or the owner accepts it, op by op, or discards it. Each
 * decision is logged for the sign-off report.
 */
import { z } from "zod";
import { Op } from "@/lib/ai/ops";
import { resolveProvider } from "@/lib/ai/provider";
import { selectedOps } from "@/lib/ai/review";
import { dryRunOnSnapshot } from "@/lib/collab/proposal";
import { docOf } from "@/lib/collab/changes";
import type { StoreChange } from "@/lib/collab/types";
import { can } from "./access";
import { ServerError } from "./errors";
import { repo, type Proposal, type Repo, type User } from "./repo";
import type { StreamEvent } from "./stream";

/** The name every member sees beside the Copilot's work. */
export const AGENT_NAME = "HMI Copilot";

/** The author id the agent's changes carry, naming the model that made them. */
export function agentAuthor(): string {
  const choice = resolveProvider();
  return choice.provider ? `agent:${choice.provider}:${choice.model}` : "agent:none:local";
}

/** Deciding and asking both need the edit role; reading needs only membership. */
async function editor(user: User | null, projectId: string, storage: Repo): Promise<User> {
  if (!user) throw new ServerError(401, "unauthorized", "Sign in to work with the Copilot");
  if (!await storage.projects.get(projectId)) throw new ServerError(404, "not-found", "Project not found");
  if (!await can(user, projectId, "edit", storage)) throw new ServerError(403, "forbidden", "Only editors and the owner can ask for or decide AI changes");
  return user;
}

/** The latest shared document, which every dry run starts from. */
async function latestDoc(projectId: string, storage: Repo) {
  const current = await storage.versions.current(projectId);
  if (!current) throw new ServerError(409, "no-snapshot", "The project has no snapshot yet");
  return { rev: current.rev, doc: docOf(current.snapshot) };
}

/** Take a screen for one Copilot turn, or learn who has it. */
export async function lockScreen(user: User | null, projectId: string, screenId: unknown, storage: Repo = repo()) {
  const actor = await editor(user, projectId, storage);
  if (typeof screenId !== "string" || !screenId) throw new ServerError(400, "invalid", "Name the screen the Copilot will work on");
  return storage.locks.acquire(projectId, screenId, actor.id, actor.name);
}

/** Give a screen back once the turn is over. */
export async function unlockScreen(user: User | null, projectId: string, screenId: unknown, storage: Repo = repo()) {
  if (!user || typeof screenId !== "string") return;
  await storage.locks.release(projectId, screenId, user.id);
}

const Ops = z.array(Op).max(200);

/**
 * A chat edit becomes a proposal: its ops run against the server snapshot,
 * and what they would change is kept for everyone to see. The requester's
 * lock on the screen ends here.
 */
export async function proposeEdit(user: User | null, projectId: string, body: Record<string, unknown>, storage: Repo = repo()): Promise<Proposal> {
  const actor = await editor(user, projectId, storage);
  const parsed = Ops.safeParse(body.ops);
  if (!parsed.success) throw new ServerError(400, "invalid", "Expected the Copilot's list of ops");
  const screenId = typeof body.screenId === "string" ? body.screenId : undefined;
  const request = typeof body.request === "string" ? body.request.slice(0, 2000) : "";
  try {
    const { doc } = await latestDoc(projectId, storage);
    const run = dryRunOnSnapshot(doc, parsed.data, screenId);
    return await storage.proposals.create({
      projectId,
      ...(screenId ? { screenId } : {}),
      requestedBy: actor.id,
      requestedByName: actor.name,
      request,
      author: agentAuthor(),
      ops: parsed.data,
      labels: run.labels,
      changes: run.changes,
      rejected: run.outcome.problems,
    });
  } finally {
    if (screenId) await storage.locks.release(projectId, screenId, actor.id);
  }
}

/** A finished agent run, as a proposal with fixed groups of changes. */
export async function proposeAgentRun(
  actor: User,
  projectId: string,
  run: { screenId: string; request: string; label: string; changes: StoreChange[]; rejected: string[] },
  storage: Repo = repo(),
) {
  return storage.proposals.create({
    projectId,
    screenId: run.screenId,
    requestedBy: actor.id,
    requestedByName: actor.name,
    request: run.request,
    author: agentAuthor(),
    ops: [],
    labels: [run.label],
    changes: run.changes,
    groups: [run.changes],
    rejected: run.rejected,
  });
}

/**
 * Accept some or all of a proposal's ops, or discard it. Accepted changes go
 * through the ordinary change log, authored by the agent, with the editor
 * who accepted them recorded beside it.
 */
export async function decideProposal(user: User | null, projectId: string, id: string, body: Record<string, unknown>, storage: Repo = repo()): Promise<Proposal> {
  const actor = await editor(user, projectId, storage);
  const proposal = await storage.proposals.get(projectId, id);
  if (!proposal) throw new ServerError(404, "not-found", "Proposal not found");
  if (proposal.status !== "open") throw new ServerError(409, "decided", `This proposal was already ${proposal.status}`);
  const who = { decidedBy: actor.id, decidedByName: actor.name };
  if (body.action === "discard") return storage.proposals.decide(projectId, id, { status: "discarded", ...who });
  if (body.action !== "accept") throw new ServerError(400, "invalid", "action is accept or discard");

  const all = proposal.labels.map((_, i) => i);
  const wanted = Array.isArray(body.indexes) ? body.indexes.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < all.length) : all;
  const keep = [...new Set(wanted)].sort((a, b) => a - b);
  if (keep.length === 0) throw new ServerError(400, "invalid", "Tick at least one change to accept, or discard the proposal");

  const { rev, doc } = await latestDoc(projectId, storage);
  // Chat edits run again on the project as it is now; an agent run's changes are fixed.
  const changes = proposal.groups
    ? keep.flatMap(i => proposal.groups![i] ?? [])
    : dryRunOnSnapshot(doc, selectedOps(proposal.ops, new Set(keep)), proposal.screenId).changes;
  let landed = rev;
  if (changes.length > 0) {
    const result = await storage.live.append(projectId, [{ id: `proposal-${id}`, base: rev, author: proposal.author, ops: changes, acceptedBy: actor.id }]);
    if (result.rejected.length > 0) throw new ServerError(409, "stale", `The project changed under this proposal (${result.rejected[0].reason}); ask again`);
    landed = result.rev;
  }
  const status = keep.length < all.length ? "partially-accepted" : "accepted";
  return storage.proposals.decide(projectId, id, { status, ...who, acceptedOpIndexes: keep, rev: landed });
}

/**
 * New and changed proposals for the project stream, and the steps of the
 * listener's own agent runs. The first call sends every open proposal, so a
 * client that connects late still sees what is waiting.
 */
export function proposalEvents(projectId: string, userId: string | null, storage: Repo = repo()): () => Promise<StreamEvent[]> {
  const seen = new Map<string, number>();
  const stepsSeen = new Map<string, number>();
  let first = true;
  return async () => {
    const events: StreamEvent[] = [];
    for (const proposal of await storage.proposals.list(projectId)) {
      const known = seen.get(proposal._id);
      seen.set(proposal._id, proposal.updatedAt);
      if (known === proposal.updatedAt) continue;
      if (first && proposal.status !== "open") continue;
      events.push({ event: "proposal", data: proposal });
    }
    first = false;
    if (userId) {
      for (const lock of await storage.locks.list(projectId)) {
        if (lock.holder !== userId) continue;
        // A run still going is told from its first step; a finished one only
        // from what is new since this connection last looked.
        const from = stepsSeen.get(lock._id) ?? (lock.released ? lock.steps.length : 0);
        for (const step of lock.steps.slice(from)) {
          events.push({ event: "agent", data: { screenId: lock.screenId, ...step, released: !!lock.released } });
        }
        stepsSeen.set(lock._id, lock.steps.length);
      }
    }
    return events;
  };
}
