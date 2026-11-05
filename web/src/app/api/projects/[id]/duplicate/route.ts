/** A copy of a project as it stands now, owned by whoever asked. Its history and its conversation stay behind. */
import { currentUser } from "@/lib/server/session";
import { requireAccess } from "@/lib/server/access";
import { errorResponse, type Context } from "@/lib/server/http";
import { ServerError } from "@/lib/server/errors";
import { repo } from "@/lib/server/repo";

export const runtime = "nodejs";

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    // A copy is a way out of the project, so it asks what an export asks.
    const user = await requireAccess(await currentUser(), id, "export", request);
    const [project, version] = await Promise.all([repo().projects.get(id), repo().versions.current(id)]);
    if (!project || !version) throw new ServerError(404, "not-found", "Project not found");
    const name = `${project.name} copy`.slice(0, 255);
    const copy = await repo().projects.create(user.id, { ...version.snapshot, id: crypto.randomUUID(), name, versions: [], chat: [] }, project.layout);
    return Response.json({ project: copy }, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
