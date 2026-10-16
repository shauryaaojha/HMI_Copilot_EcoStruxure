/**
 * The Copilot as a collaborator (Phase D): its proposals, the decisions people
 * made about them, and the lock that keeps one agent turn per screen.
 *
 * A proposal is shared: every member sees it, editors decide it, and the
 * decision is logged for the sign-off report. The lock is a row with an
 * expiry, so a crashed function never holds a screen for longer than 90 s;
 * it also carries the steps of a server-side agent run, which the project
 * stream forwards to whoever asked.
 */
import type { Op } from "@/lib/ai/ops";
import type { StoreChange } from "@/lib/collab/types";
import { ServerError } from "./errors";
import { validId, type Data, type Row } from "./storage";
import type { Clock, Tx } from "./repo-collab";

export type ProposalStatus = "open" | "accepted" | "partially-accepted" | "discarded";

/**
 * One suggestion from the Copilot, waiting for an editor. Chat edits keep
 * their `ops`, so a subset can be run again on accept; an agent run (a build
 * or a repair) keeps fixed `groups` of changes, one per label, instead.
 */
export type Proposal = Row & {
  projectId: string;
  screenId?: string;
  requestedBy: string;
  requestedByName: string;
  request: string;
  /** `agent:<provider>:<model>`: the author every accepted change carries. */
  author: string;
  ops: Op[];
  labels: string[];
  /** The whole dry run, for the canvas ghosts. */
  changes: StoreChange[];
  groups?: StoreChange[][];
  /** What the dry run could not do, and why. */
  rejected: string[];
  createdAt: number;
  updatedAt: number;
  status: ProposalStatus;
  decidedBy?: string;
  decidedByName?: string;
  decidedAt?: number;
  acceptedOpIndexes?: number[];
  /** The revision the accepted changes landed at. */
  rev?: number;
};

/** The audit trail: one row per decision, kept with the project. */
export type Decision = Row & {
  projectId: string;
  proposalId: string;
  decision: Exclude<ProposalStatus, "open">;
  by: string;
  byName: string;
  at: number;
  request: string;
  requestedByName: string;
  author: string;
  /** The labels of the ops that were accepted. */
  accepted: string[];
  rev?: number;
};

/** A screen the Copilot is working on, and for whom. */
export type AgentLock = Row & {
  projectId: string;
  screenId: string;
  holder: string;
  holderName: string;
  expiresAt: number;
  released?: boolean;
  /** Steps of a server-side run, streamed to the holder as `agent` events. */
  steps: { at: number; kind: string; message: string }[];
};

export const LOCK_MS = 90_000;

/** What creating a proposal needs; `Omit` would collapse over Row's index signature. */
export type ProposalInput = Pick<Proposal, "projectId" | "requestedBy" | "requestedByName" | "request" | "author" | "ops" | "labels" | "changes" | "rejected"> &
  Partial<Pick<Proposal, "screenId" | "groups">>;

export interface ProposalsRepo {
  create(proposal: ProposalInput): Promise<Proposal>;
  get(projectId: string, id: string): Promise<Proposal | null>;
  list(projectId: string): Promise<Proposal[]>;
  /** Records a decision, once: deciding a decided proposal is a conflict. */
  decide(projectId: string, id: string, decision: Pick<Proposal, "status" | "decidedBy" | "decidedByName" | "acceptedOpIndexes" | "rev">): Promise<Proposal>;
  decisions(projectId: string): Promise<Decision[]>;
}

export interface LocksRepo {
  /** Take the screen for `holder`, or say who has it. Re-taking your own lock refreshes it. */
  acquire(projectId: string, screenId: string, holder: string, holderName: string): Promise<AgentLock>;
  release(projectId: string, screenId: string, holder: string): Promise<void>;
  step(projectId: string, screenId: string, holder: string, step: { kind: string; message: string }): Promise<void>;
  list(projectId: string): Promise<AgentLock[]>;
}

const lockId = (projectId: string, screenId: string) => `${projectId}:${screenId}`;

/** Proposals and their decisions, bound to the repository's transaction and clock. */
export function proposalsRepo(tx: Tx, now: Clock): ProposalsRepo {
  const find = async (d: Data, projectId: string, id: string) => {
    const row = validId(id) ? await d.get<Proposal>("proposals", id) : null;
    return row && row.projectId === projectId ? row : null;
  };
  return {
    create: proposal => tx(async d => {
      if (!await d.get("projects", proposal.projectId)) throw new ServerError(404, "not-found", "Project not found");
      const row = { ...proposal, _id: crypto.randomUUID(), createdAt: now(), updatedAt: now(), status: "open" } as Proposal;
      await d.put("proposals", row);
      return row;
    }),
    get: (projectId, id) => tx(d => find(d, projectId, id)),
    list: projectId => tx(async d => {
      const rows = await d.list<Proposal>("proposals", { projectId });
      return rows.sort((a, b) => b.createdAt - a.createdAt);
    }),
    decide: (projectId, id, decision) => tx(async d => {
      const row = await find(d, projectId, id);
      if (!row) throw new ServerError(404, "not-found", "Proposal not found");
      if (row.status !== "open") throw new ServerError(409, "decided", `This proposal was already ${row.status}`);
      const next: Proposal = { ...row, ...decision, decidedAt: now(), updatedAt: now() };
      await d.put("proposals", next);
      const indexes = decision.acceptedOpIndexes ?? [];
      const entry: Decision = {
        _id: crypto.randomUUID(),
        projectId,
        proposalId: id,
        decision: decision.status as Decision["decision"],
        by: decision.decidedBy ?? "",
        byName: decision.decidedByName ?? "",
        at: now(),
        request: row.request,
        requestedByName: row.requestedByName,
        author: row.author,
        accepted: indexes.map(i => row.labels[i]).filter((l): l is string => !!l),
        ...(decision.rev ? { rev: decision.rev } : {}),
      };
      await d.put("decisions", entry);
      return next;
    }),
    decisions: projectId => tx(async d => {
      const rows = await d.list<Decision>("decisions", { projectId });
      return rows.sort((a, b) => a.at - b.at);
    }),
  };
}

/** One agent turn per screen, bound to the repository's transaction and clock. */
export function locksRepo(tx: Tx, now: Clock): LocksRepo {
  return {
    acquire: (projectId, screenId, holder, holderName) => tx(async d => {
      const id = lockId(projectId, screenId);
      const old = await d.get<AgentLock>("agentLocks", id);
      const live = old && !old.released && old.expiresAt > now();
      if (live && old.holder !== holder) {
        throw new ServerError(409, "busy", `Copilot is working on this screen for ${old.holderName}`, { holder: old.holderName, expiresAt: old.expiresAt });
      }
      const lock: AgentLock = {
        _id: id,
        projectId,
        screenId,
        holder,
        holderName,
        expiresAt: now() + LOCK_MS,
        steps: live ? old.steps : [],
      };
      await d.put("agentLocks", lock);
      return lock;
    }),
    release: (projectId, screenId, holder) => tx(async d => {
      const lock = await d.get<AgentLock>("agentLocks", lockId(projectId, screenId));
      if (!lock || lock.holder !== holder) return;
      // Kept, released, so the stream can still deliver the last steps.
      await d.put("agentLocks", { ...lock, released: true });
    }),
    step: (projectId, screenId, holder, step) => tx(async d => {
      const lock = await d.get<AgentLock>("agentLocks", lockId(projectId, screenId));
      if (!lock || lock.holder !== holder) return;
      const steps = [...lock.steps, { at: now(), ...step }].slice(-200);
      // A step is also a sign of life: the run keeps its screen while it works.
      await d.put("agentLocks", { ...lock, steps, expiresAt: Math.max(lock.expiresAt, now() + LOCK_MS) });
    }),
    list: projectId => tx(d => d.list<AgentLock>("agentLocks", { projectId })),
  };
}
