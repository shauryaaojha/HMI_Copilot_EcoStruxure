/**
 * An editor decides a proposal: accept the ticked ops (they go through the
 * change log authored by the Copilot, with the editor recorded), or discard it.
 */
import { currentUser } from "@/lib/server/session";
import { decideProposal } from "@/lib/server/proposals";
import { errorResponse, json } from "@/lib/server/http";
export const runtime = "nodejs";

/** Body `{ action: "accept" | "discard", indexes?: number[] }`. */
export async function POST(request: Request, context: { params: Promise<{ id: string; pid: string }> }) {
  try {
    const { id, pid } = await context.params;
    const proposal = await decideProposal(await currentUser(), id, pid, await json(request));
    return Response.json({ proposal });
  } catch (e) { return errorResponse(e); }
}
