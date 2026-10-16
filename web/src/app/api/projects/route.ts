/** Private project index. Membership is the only route into shared projects. */
import { repo } from "@/lib/server/repo";
import { can } from "@/lib/server/access";
import { json, userRequired, snapshot, errorResponse } from "@/lib/server/http";
export const runtime = "nodejs";
export async function GET() {
  try {
    const user = await userRequired();
    const projects = [];
    for (const p of await repo().projects.list(user.id)) if (await can(user, p._id, "read")) projects.push(p);
    return Response.json({ projects }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
export async function POST(request: Request) {
  try {
    const user = await userRequired(); const body = await json(request);
    const p = await snapshot(body.snapshot, user);
    const layout = body.layout === "typed" || body.layout === "struct" ? body.layout : undefined;
    return Response.json({ project: await repo().projects.create(user.id, p, layout) }, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
