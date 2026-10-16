/**
 * The agent loop run on the server for a shared project (Phase D).
 *
 * In a browser-only project the agent builds and repairs in the engineer's
 * own tab. In a shared one it runs here, against the server snapshot, and
 * its result is a proposal rather than a file or a commit: everyone sees the
 * ghosts, an editor decides. Its steps are written onto the screen's lock as
 * they happen, and the project stream forwards them to whoever asked.
 *
 * No bench and no packaging: the licensed editor is not on a server, and the
 * proof that the file opens belongs to the export, which reads the snapshot.
 */
import { runAgent } from "@/lib/agent/loop";
import { docOf } from "@/lib/collab/changes";
import { packageInputOf } from "@/lib/collab/package";
import { agentChanges } from "@/lib/collab/proposal";
import { ServerError } from "./errors";
import { lockScreen, proposeAgentRun } from "./proposals";
import { repo, type Proposal, type Repo, type User } from "./repo";

export type AgentMode = "build" | "repair";

export interface AgentRequest {
  screenId: string;
  mode: AgentMode;
  goal: string;
}

/** Check the request and take the screen; throws 409 with the holder's name when it is busy. */
export async function startAgent(user: User | null, projectId: string, body: Record<string, unknown>, storage: Repo = repo()): Promise<AgentRequest> {
  const mode = body.mode === "build" || body.mode === "repair" ? body.mode : null;
  if (!mode) throw new ServerError(400, "invalid", "mode is build or repair");
  const goal = typeof body.goal === "string" ? body.goal.slice(0, 2000) : "";
  await lockScreen(user, projectId, body.screenId, storage);
  return { screenId: body.screenId as string, mode, goal };
}

/**
 * Run the loop on the latest snapshot and leave a proposal behind. Always
 * gives the screen back, whether the run finished, found nothing to change,
 * or failed.
 */
export async function runAgentOnSnapshot(user: User, projectId: string, request: AgentRequest, storage: Repo = repo()): Promise<Proposal | null> {
  const note = (kind: string, message: string) => storage.locks.step(projectId, request.screenId, user.id, { kind, message });
  try {
    const current = await storage.versions.current(projectId);
    if (!current) throw new ServerError(409, "no-snapshot", "The project has no snapshot yet");
    const doc = docOf(current.snapshot);
    const steps = runAgent({
      goal: request.goal || doc.name,
      name: doc.name,
      variables: doc.variables,
      panel: doc.target,
      prove: false,
      ...(request.mode === "repair" ? { from: packageInputOf(doc) } : {}),
    });
    for await (const step of steps) {
      if (step.kind !== "done") {
        await note(step.kind, step.message);
        continue;
      }
      const changes = agentChanges(doc, step.input);
      if (changes.length === 0) {
        await note("done", `${step.message}; nothing to change`);
        return null;
      }
      const verb = request.mode === "build" ? "Build" : "Repair";
      const proposal = await proposeAgentRun(user, projectId, {
        screenId: request.screenId,
        request: request.goal || `${verb} the project`,
        label: `${verb}: ${step.message}`,
        changes,
        rejected: step.report.findings.filter((f) => f.severity === "error").map((f) => f.message).slice(0, 20),
      }, storage);
      await note("done", `${step.message}; proposal ready for an editor`);
      return proposal;
    }
    return null;
  } catch (error) {
    await note("error", error instanceof Error ? error.message : "The agent run failed");
    throw error;
  } finally {
    await storage.locks.release(projectId, request.screenId, user.id);
  }
}
