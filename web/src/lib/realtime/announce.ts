/**
 * The one way a writer announces a revision. Kept apart from publish.ts so a
 * test that stubs the network publish still exercises this scheduling.
 */
import { after } from "next/server";
import { PROPOSAL_EVENT, type RevisionNotice } from "./config";
import { publishProjectEvent, publishRevision } from "./publish";

/**
 * Announce a committed revision after the response, without failing the write.
 *
 * Every path that moves a project's revision calls this: a posted change, an
 * accepted proposal, a whole-snapshot save, a restore and a direct MCP write.
 * A session on the Realtime transport learns of revisions only from these
 * notices, so a writer that skips it is invisible there until somebody else
 * posts (docs/audit/BUGS.md S2-04).
 *
 * Through `after` rather than a bare promise, for the reason the agent route
 * uses it (api/projects/[id]/agent/route.ts): Vercel may freeze the function
 * the instant the response is returned, and work nobody is waiting on is the
 * first thing lost. `after` is the ask to stay alive for it.
 *
 * `after` needs a request scope. Where there is none (a route function called
 * directly) there is nothing to schedule, and that is not worth failing a write
 * for: a missed notice is closed by the next one, because the broadcast is a
 * hint and not the truth.
 */
export function announceRevision(notice: RevisionNotice): void {
  try {
    after(async () => {
      await publishRevision(notice);
    });
  } catch {
    // No request scope: the edit is committed, which is what the answer says.
  }
}

/** Tell the project's open tabs that a proposal was made or decided (S4-22). */
export function announceProposals(projectId: string): void {
  try {
    after(async () => {
      await publishProjectEvent(projectId, PROPOSAL_EVENT, { projectId });
    });
  } catch {
    // No request scope: the next GET of the list shows it.
  }
}
