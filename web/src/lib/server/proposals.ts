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
import { Op } from "@/core/ops";
import { resolveProvider } from "@/lib/ai/provider";
import { selectedOps } from "@/lib/ai/review";
import { dryRunOnSnapshot, dryRunToDoc } from "@/lib/collab/proposal";
import { apply as applyChanges, docOf } from "@/lib/collab/changes";
import type { Doc, StoreChange } from "@/lib/collab/types";
import { can } from "./access";
import { ServerError } from "./errors";
import { repo, type Proposal, type Repo, type User } from "./repo";
import { announceProposals, announceRevision } from "@/lib/realtime/announce";
import { PROPOSAL_EVENT } from "@/lib/realtime/config";
import { publishProjectEvent } from "@/lib/realtime/publish";
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
 * The project with every open proposal applied, oldest first: what it will be
 * once the queue is accepted in order. A proposal that no longer applies is
 * left out rather than failing the one being made.
 */
export async function openStack(projectId: string, doc: Doc, storage: Repo): Promise<{ doc: Doc; ids: string[] }> {
  const open = (await storage.proposals.list(projectId)).filter((p) => p.status === "open").sort((a, b) => a.createdAt - b.createdAt);
  let stacked = doc;
  const ids: string[] = [];
  for (const p of open) {
    try {
      stacked = p.groups ? applyChanges(stacked, p.groups.flat()) : dryRunToDoc(stacked, p.ops, p.screenId).after;
      ids.push(p._id);
    } catch {
      // stale against the current project; it will say so when someone opens it
    }
  }
  return { doc: stacked, ids };
}

/**
 * A chat edit becomes a proposal: its ops run against the server snapshot,
 * and what they would change is kept for everyone to see. The requester's
 * lock on the screen ends here.
 */
export async function proposeEdit(user: User | null, projectId: string, body: Record<string, unknown>, storage: Repo = repo(), via?: "mcp"): Promise<Proposal> {
  const actor = await editor(user, projectId, storage);
  const parsed = Ops.safeParse(body.ops);
  if (!parsed.success) throw new ServerError(400, "invalid", "Expected the Copilot's list of ops");
  const screenId = typeof body.screenId === "string" ? body.screenId : undefined;
  const request = typeof body.request === "string" ? body.request.slice(0, 2000) : "";
  try {
    const { doc } = await latestDoc(projectId, storage);
    let run = dryRunOnSnapshot(doc, parsed.data, screenId);
    let dependsOn: string[] = [];
    // Claude splits big work over several calls: a screen's shell in one, its
    // body in the next. Against the project alone the second refers to a
    // screen that is still waiting in the queue, and every op was refused
    // ("no screen called Home", 170 times in the first week). So when the
    // project alone refuses something, the ops are worked out again on top of
    // the open proposals, and if that refuses less, that run is the proposal
    // and it waits for the ones it builds on.
    if (run.outcome.rejected.length > 0) {
      const stack = await openStack(projectId, doc, storage);
      if (stack.ids.length > 0) {
        const stacked = dryRunOnSnapshot(stack.doc, parsed.data, screenId);
        if (stacked.outcome.rejected.length < run.outcome.rejected.length) {
          run = stacked;
          dependsOn = stack.ids;
        }
      }
    }
    const proposal = await storage.proposals.create({
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
      // Set by the caller, never read from the request body.
      ...(via ? { via } : {}),
      ...(dependsOn.length ? { dependsOn } : {}),
    });
    announceProposals(projectId);
    return proposal;
  } finally {
    if (screenId) await storage.locks.release(projectId, screenId, actor.id);
  }
}

/**
 * A finished agent run, as a proposal with fixed groups of changes. Fixed
 * because the run's result is a document, not a list of edits to replay: there
 * is nothing to run again on accept, and re-deriving it would give a different
 * answer from the one the engineer looked at.
 */
export async function proposeAgentRun(
  actor: User,
  projectId: string,
  run: { screenId?: string; request: string; label: string; changes: StoreChange[]; rejected: string[]; via?: "mcp" },
  storage: Repo = repo(),
) {
  const proposal = await storage.proposals.create({
    projectId,
    // A whole-application build belongs to no one screen, which is the one
    // case this has to leave unset rather than invent an id for.
    ...(run.screenId ? { screenId: run.screenId } : {}),
    requestedBy: actor.id,
    requestedByName: actor.name,
    request: run.request,
    author: agentAuthor(),
    ops: [],
    labels: [run.label],
    changes: run.changes,
    groups: [run.changes],
    rejected: run.rejected,
    ...(run.via ? { via: run.via } : {}),
  });
  // Awaited, not `after`: a run already lives inside the agent route's `after`.
  await publishProjectEvent(projectId, PROPOSAL_EVENT, { projectId });
  return proposal;
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
  if (body.action === "discard") {
    const discarded = await storage.proposals.decide(projectId, id, { status: "discarded", ...who });
    announceProposals(projectId);
    return discarded;
  }
  if (body.action !== "accept") throw new ServerError(400, "invalid", "action is accept or discard");
  if (proposal.dependsOn?.length) {
    const list = await storage.proposals.list(projectId);
    const waiting = list.filter((p) => proposal.dependsOn!.includes(p._id) && p.status === "open");
    if (waiting.length > 0) {
      const first = waiting.sort((a, b) => a.createdAt - b.createdAt)[0];
      throw new ServerError(409, "depends", `This builds on "${(first.request || "an earlier proposal").slice(0, 120)}", which is still waiting. Accept that one first, or discard this one.`);
    }
  }

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
    announceRevision({ projectId, rev: landed, author: actor.id });
  }
  const status = keep.length < all.length ? "partially-accepted" : "accepted";
  const decided = await storage.proposals.decide(projectId, id, { status, ...who, acceptedOpIndexes: keep, rev: landed });
  announceProposals(projectId);
  return decided;
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
