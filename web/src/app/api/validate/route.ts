/**
 * Design-time validation. Phase 6 of docs/BUILD_PLAN.md.
 *
 * Naming conventions, binding integrity, type mismatch, completeness and
 * standards conformance. Each finding carries the id of the object that caused
 * it, so the UI can put the engineer in front of it.
 */

import type { PackageInput } from "@/lib/ote/packager";
import { summarise, validateProject } from "@/lib/validation/rules";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let project: PackageInput;
  try {
    project = (await request.json()) as PackageInput;
  } catch {
    return Response.json({ error: "expected a JSON project" }, { status: 400 });
  }

  if (!Array.isArray(project?.screens)) {
    return Response.json({ error: "project has no screens array" }, { status: 400 });
  }

  const findings = validateProject(project);
  return Response.json({ findings, summary: summarise(findings) });
}
