"use client";

/**
 * The Copilot's proposals in a shared project, as every member sees them.
 *
 * Loaded once when the project opens and kept current by the project stream's
 * `proposal` events (lib/collab/sync.ts). The `agent` events of this person's
 * own server-side runs land in `steps`, so the chat can say what the agent is
 * doing. Deciding goes to the server; the accepted changes come back through
 * the ordinary change log like anyone else's edit.
 */
import { create } from "zustand";
import type { StoreChange } from "@/lib/collab/types";

/** A proposal as the API returns it (src/lib/server/repo-agent.ts). */
export interface SharedProposal {
  _id: string;
  projectId: string;
  screenId?: string;
  requestedBy: string;
  requestedByName: string;
  request: string;
  author: string;
  labels: string[];
  changes: StoreChange[];
  rejected: string[];
  createdAt: number;
  updatedAt: number;
  status: "open" | "accepted" | "partially-accepted" | "discarded";
  decidedByName?: string;
  decidedAt?: number;
  acceptedOpIndexes?: number[];
  /** Chat edits only: present when a subset can be run again. */
  ops?: unknown[];
}

/** One step of an agent run on the server, for the person who started it. */
export interface AgentStep {
  screenId: string;
  at: number;
  kind: string;
  message: string;
  released: boolean;
}

interface ProposalsState {
  projectId: string | null;
  list: SharedProposal[];
  steps: AgentStep[];
  /** Replace the list for a project, from GET /api/projects/[id]/proposals. */
  load: (projectId: string, list: SharedProposal[]) => void;
  /** A `proposal` event: insert or replace by id, newest first. */
  receive: (body: unknown) => void;
  /** An `agent` event. */
  agentStep: (body: unknown) => void;
  clear: () => void;
}

/** Newest first, the way the chat lists them. */
const byNewest = (a: SharedProposal, b: SharedProposal) => b.createdAt - a.createdAt;

export const useProposals = create<ProposalsState>()((set) => ({
  projectId: null,
  list: [],
  steps: [],
  load: (projectId, list) => set({ projectId, list: [...list].sort(byNewest), steps: [] }),
  receive: (body) =>
    set((s) => {
      const proposal = body as SharedProposal;
      if (!proposal?._id || (s.projectId && proposal.projectId !== s.projectId)) return s;
      const rest = s.list.filter((p) => p._id !== proposal._id);
      return { list: [...rest, proposal].sort(byNewest) };
    }),
  agentStep: (body) =>
    set((s) => {
      const step = body as AgentStep;
      if (!step?.message) return s;
      return { steps: [...s.steps, step].slice(-50) };
    }),
  clear: () => set({ projectId: null, list: [], steps: [] }),
}));

/** Load the project's proposals; a failure leaves the list empty, the stream fills it in. */
export async function loadProposals(projectId: string) {
  try {
    const response = await fetch(`/api/projects/${projectId}/proposals`, { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as { proposals: SharedProposal[] };
    useProposals.getState().load(projectId, body.proposals);
  } catch {
    // Offline: the stream's first poll sends every open proposal anyway.
  }
}

/** Ask the server to accept the ticked ops, or discard the proposal. */
export async function decideProposal(projectId: string, id: string, action: "accept" | "discard", indexes?: number[]) {
  const response = await fetch(`/api/projects/${projectId}/proposals/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...(indexes ? { indexes } : {}) }),
  });
  const body = (await response.json().catch(() => ({}))) as { proposal?: SharedProposal; error?: string };
  if (!response.ok || !body.proposal) throw new Error(body.error ?? `The server answered ${response.status}`);
  useProposals.getState().receive(body.proposal);
  return body.proposal;
}
