/**
 * Projects in and out through the connector.
 *
 * Out: `export_project` checks the project the way the Export panel does and
 * hands back a signed link to the .eote, good for 15 minutes, that only works
 * for the person who asked (lib/server/export-link.ts). Claude cannot carry a
 * file to the engineer, so a link is the honest answer.
 *
 * In: `open_eote` and `import_tags` take a file up to 3 MB inside the call.
 * Anything bigger cannot cross the connector (Vercel caps a request body at
 * 4.5 MB), so `import_link` points the engineer at the upload in the app.
 */
import { z } from "zod";
import { exportProblems, LINK_MS, signExportLink } from "@/lib/server/export-link";
import { field, limited, projectData, RESULT_LIMIT } from "./data";
import { openProject } from "./project";
import { refusal } from "./result";
import { tool, type McpTool } from "./spec";

const exportProject = tool({
  name: "export_project",
  title: "Export a project",
  description:
    "Checks a project the way the app's Export panel does and, when it passes, returns a link to download the .eote that EcoStruxure Operator Terminal Expert 4.4 opens. The link lasts 15 minutes and works only for the signed-in engineer. When the check fails it returns the problems to fix instead. Give the engineer the link as it is; never say a file was sent.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  input: { projectId: z.string().describe("The project id, from list_projects.") },
  async run({ projectId }, { caller }) {
    const { project, rev } = await openProject(caller, projectId, "export");
    const problems = await exportProblems(projectId, rev);
    if (problems.length) {
      return refusal(
        [
          `"${field(project.name, 120)}" cannot be exported yet: ${problems.length} problem(s). Fix them with apply_ops, or tell the engineer, then ask again.`,
          projectData("problems", limited(problems.map((p) => `${field(p.where, 120)}: ${field(p.problem, 300)}`), RESULT_LIMIT - 2_000)),
        ].join("\n"),
        "preflight",
      );
    }
    if (!caller.origin) return refusal("This call did not say which address the app is on, so no link can be made. Export from the app.", "internal");
    const url = `${caller.origin}/api/export/link?t=${signExportLink(projectId, rev, caller.userId)}`;
    return {
      text: [
        `"${field(project.name, 120)}" at revision ${rev} passed the export checks.`,
        `Download link (works for ${Math.round(LINK_MS / 60000)} minutes, only for the engineer who is signed in): ${url}`,
        "In Operator Terminal Expert: File > Open Project, and pick the downloaded .eote.",
      ].join("\n"),
      structured: { projectId, rev, url, expiresInMinutes: Math.round(LINK_MS / 60000) },
    };
  },
});

const importLink = tool({
  name: "import_link",
  title: "Where to upload a project",
  description:
    "For a project file or tag export too big to send inside a call (over 3 MB), or when the engineer would rather upload it themselves: returns the app page where they drop it in. Once they say it is uploaded, call list_projects to find it. Files up to 3 MB can go straight through open_eote (an .eote) or import_tags (a tag export).",
  annotations: { readOnlyHint: true, openWorldHint: false },
  input: { kind: z.enum(["eote", "tags"]).describe("eote for an Operator Terminal Expert project, tags for a PLC tag export.") },
  async run({ kind }, { caller }) {
    if (!caller.origin) return refusal("This call did not say which address the app is on. Upload on the app's Projects page.", "internal");
    const url = `${caller.origin}/projects`;
    return {
      text:
        kind === "eote"
          ? `Upload the .eote here: ${url} (Open .eote). Older 3.x projects are converted there too. Tell me when it is done and I will find it with list_projects.`
          : `Open the project in the app (${url}), then Tags > import, and drop the export in. Tell me when it is done and I will read the tags with find_tags.`,
      structured: { url, kind },
    };
  },
});

export const PORT_TOOLS: readonly McpTool[] = [exportProject, importLink];
