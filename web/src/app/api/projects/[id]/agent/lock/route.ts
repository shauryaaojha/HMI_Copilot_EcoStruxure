/**
 * One Copilot turn per screen. A chat turn in a shared project takes the
 * screen here before asking the model; a second person asking on the same
 * screen is told who the Copilot is working for. The lock lapses after 90 s.
 */
import { currentUser } from "@/lib/server/session";
import { lockScreen, unlockScreen } from "@/lib/server/proposals";
import { errorResponse, json, sameOrigin, type Context } from "@/lib/server/http";
export const runtime = "nodejs";

/** Body `{ screenId }`; 409 `{ code: "busy", holder }` when someone else has it. */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = await json(request);
    const lock = await lockScreen(await currentUser(), id, body.screenId);
    return Response.json({ screenId: lock.screenId, expiresAt: lock.expiresAt });
  } catch (e) { return errorResponse(e); }
}

/** `?screenId=`: give the screen back early. */
export async function DELETE(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const { id } = await context.params;
    await unlockScreen(await currentUser(), id, new URL(request.url).searchParams.get("screenId"));
    return Response.json({ released: true });
  } catch (e) { return errorResponse(e); }
}
