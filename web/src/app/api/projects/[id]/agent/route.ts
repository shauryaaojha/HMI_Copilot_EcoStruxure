/**
 * Build or repair a shared project with the agent loop, on the server.
 *
 * The screen is taken before answering, so a busy screen is refused at once
 * with the holder's name. The run itself continues after the response
 * (Next's `after`, which Vercel keeps alive with waitUntil); its steps reach
 * the requester as `agent` events on the project stream, and its result
 * arrives as a `proposal` for every member.
 */
import { after } from "next/server";
import { currentUser } from "@/lib/server/session";
import { runAgentOnSnapshot, startAgent } from "@/lib/server/agent-run";
import { errorResponse, json, type Context } from "@/lib/server/http";
export const runtime = "nodejs";
export const maxDuration = 120;

/** Body `{ screenId, mode: "build" | "repair", goal? }`; answers 202 once the run has started. */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const user = await currentUser();
    const run = await startAgent(user, id, await json(request));
    after(async () => {
      // Failures are reported on the stream as an `error` step.
      await runAgentOnSnapshot(user!, id, run).catch(() => undefined);
    });
    return Response.json({ started: true, screenId: run.screenId }, { status: 202 });
  } catch (e) { return errorResponse(e); }
}
