"use client";

/**
 * How a chat turn behaves in a shared project (Phase D).
 *
 * The conversation is the same; where its result goes is not. Nothing the
 * Copilot does commits to a document other people are editing: an edit is
 * sent to the server as ops and comes back, to everyone, as a proposal; a
 * build runs on the server against the shared snapshot and ends the same
 * way. One turn per screen at a time, so the turn takes the screen first.
 */
import type { Op } from "@/lib/ai/ops";
import { useAccess } from "@/store/access";
import { useProject } from "@/store/project";

/** The open project when it is a shared one this browser may edit, else null. */
export function sharedTurn(): { projectId: string; screenId?: string } | null {
  const s = useProject.getState();
  const access = useAccess.getState();
  if (!access.access || access.projectId !== s.id) return null;
  return { projectId: s.id, screenId: s.activeScreenId ?? s.screens[0]?.UniqueId };
}

/** Read an error body into the sentence the server wrote. */
async function failure(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `the server answered ${response.status}`;
}

/** Take the screen for this turn; returns why not ("Copilot is working on this screen for …"), or null. */
export async function takeScreen(turn: { projectId: string; screenId?: string }): Promise<string | null> {
  if (!turn.screenId) return null;
  const response = await fetch(`/api/projects/${turn.projectId}/agent/lock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ screenId: turn.screenId }),
  });
  return response.ok ? null : failure(response);
}

/** Give the screen back; harmless if the server already did. */
export async function releaseScreen(turn: { projectId: string; screenId?: string }) {
  if (!turn.screenId) return;
  await fetch(`/api/projects/${turn.projectId}/agent/lock?screenId=${encodeURIComponent(turn.screenId)}`, { method: "DELETE" }).catch(() => undefined);
}

/** Send the turn's ops to become a shared proposal; returns how many changes it holds. */
export async function proposeShared(turn: { projectId: string; screenId?: string }, request: string, ops: Op[]) {
  const response = await fetch(`/api/projects/${turn.projectId}/proposals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ screenId: turn.screenId, request, ops }),
  });
  if (!response.ok) throw new Error(await failure(response));
  const body = (await response.json()) as { proposal: { labels: string[]; rejected: string[] } };
  return body.proposal;
}

/** Start a build or repair on the server; its result arrives as a proposal on the stream. */
export async function runSharedAgent(turn: { projectId: string; screenId?: string }, mode: "build" | "repair", goal: string) {
  const response = await fetch(`/api/projects/${turn.projectId}/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ screenId: turn.screenId, mode, goal }),
  });
  if (!response.ok) throw new Error(await failure(response));
}
