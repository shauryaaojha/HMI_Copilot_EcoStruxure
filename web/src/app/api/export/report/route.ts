/**
 * The sign-off report, as a standalone HTML file.
 *
 * Separate from the .eote download because a QA process archives them
 * separately, and because a report is worth having even when the export itself
 * is blocked by a missing skeleton.
 *
 * Phase 7 of docs/BUILD_PLAN.md.
 */

import { panelOf, type PackageInput } from "@/lib/ote/packager";
import { renderReport } from "@/lib/validation/report";
import { validateProject } from "@/lib/validation/rules";

export const runtime = "nodejs";

function safeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : "project";
}

export async function POST(request: Request) {
  let project: PackageInput;
  try {
    project = (await request.json()) as PackageInput;
  } catch {
    return Response.json({ error: "expected a JSON project" }, { status: 400 });
  }

  if (!Array.isArray(project?.screens) || project.screens.length === 0) {
    return Response.json({ error: "a project needs at least one screen" }, { status: 400 });
  }

  // No skeleton means no Target.dat to compare against. The report still stands;
  // it just falls back to the panel the project declares.
  const panel = await panelOf().catch(() => null);
  const findings = validateProject(project, panel);
  const html = renderReport({ project, findings, panel });

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName(project.name)}_validation.html"`,
    },
  });
}
