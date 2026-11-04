/**
 * Who is on a project, with names to show beside their roles. Any member may
 * see the list; changing it is the owner's (see ./[userId]).
 */
import { repo } from "@/lib/server/repo";
import { can, requireAccess } from "@/lib/server/access";
import { currentUser } from "@/lib/server/session";
import { errorResponse, type Context } from "@/lib/server/http";
export const runtime = "nodejs";

/** Members, strongest role first, each with the profile the repository holds. */
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const user = await requireAccess(await currentUser(), id, "read", request);
    // Addresses are for whoever manages the members, not every viewer (S2-10).
    const showEmail = await can(user, id, "manage");
    const members = [];
    for (const m of await repo().members.list(id)) {
      const profile = await repo().users.get(m.userId);
      members.push({
        userId: m.userId,
        name: profile?.name ?? (m.userId === "local" ? "Local engineer" : "Engineer"),
        email: showEmail ? profile?.email ?? undefined : undefined,
        image: profile?.image ?? undefined,
        role: m.role,
        addedAt: m.addedAt,
        ...(m.exportDenied ? { exportDenied: true } : {}),
      });
    }
    return Response.json({ members }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
