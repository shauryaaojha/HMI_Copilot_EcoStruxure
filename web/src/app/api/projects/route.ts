/** Private project index. Membership is the only route into shared projects. */
import { repo } from "@/lib/server/repo";
import { userRequired, snapshot, errorResponse } from "@/lib/server/http";
import { snapshotBody } from "@/lib/server/snapshot";
export const runtime = "nodejs";
export async function GET() {
  try {
    const user = await userRequired();
    // The list comes from the user's memberships and every role may read, so
    // a per-project access check here was two more queries per project.
    const projects = await repo().projects.list(user.id);
    return Response.json({ projects }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
export async function POST(request: Request) {
  try {
    const user = await userRequired(); const body = await snapshotBody(request, user);
    const p = await snapshot(body.snapshot, user);
    const layout = body.layout === "typed" || body.layout === "struct" ? body.layout : undefined;
    return Response.json({ project: await repo().projects.create(user.id, p, layout) }, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
