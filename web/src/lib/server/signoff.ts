/**
 * What a shared project adds to its sign-off report: the review threads still
 * open on each screen. Only a server project has other people's comments, so
 * a report for a browser-only project carries none of this and reads as before.
 */
import type { PackageInput } from "@/lib/ote/packager";
import type { ReportInput } from "@/lib/validation/report";
import { requireReader } from "./access";
import { unresolvedByScreen } from "./comments";
import { repo, type Repo, type User } from "./repo";

/** The extra report sections for one shared project, checked against the caller's access. */
export async function signoffSections(
  projectId: string,
  project: PackageInput,
  user: User | null,
  request: Request,
  storage: Repo = repo(),
): Promise<Pick<ReportInput, "comments">> {
  await requireReader(user, projectId, request);
  const counts = await unresolvedByScreen(projectId, storage);
  const names = new Map(project.screens.map((s) => [s.UniqueId, s.Name]));
  const comments = project.screens.map((s) => ({ screen: s.Name, unresolved: counts[s.UniqueId] ?? 0 }));
  // Threads on the project as a whole, or on a screen since deleted, still count.
  const elsewhere = Object.entries(counts)
    .filter(([screenId]) => !names.has(screenId))
    .reduce((n, [, count]) => n + count, 0);
  if (elsewhere > 0) comments.push({ screen: "Project (no screen)", unresolved: elsewhere });
  return { comments };
}
