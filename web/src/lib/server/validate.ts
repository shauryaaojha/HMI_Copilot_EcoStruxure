/**
 * The checks, run the one way.
 *
 * `/api/validate` answers this for the browser and the MCP server asks for it
 * on behalf of claude.ai. Both go through here rather than each assembling
 * the rules themselves, so a finding the engineer sees in the app and a
 * finding Claude is told about cannot come from two slightly different sets of
 * checks (docs/RESEARCH_CLAUDE_AI_INTEGRATION.md: the MCP server "must call
 * the same write path and the same validation, not copies of them").
 */
import { panelOf, type PackageInput } from "@/lib/ote/packager";
import { summarise, validateProject, type Finding } from "@/lib/validation/rules";

export interface Validation {
  findings: Finding[];
  summary: ReturnType<typeof summarise>;
}

/**
 * Without a skeleton there is no Target.dat to compare against, and a missing
 * installation is not a project error - so the panel check just does not run
 * rather than reporting a mismatch it cannot substantiate.
 */
export async function validateInput(project: PackageInput): Promise<Validation> {
  const panel = await panelOf().catch(() => null);
  const findings = validateProject(project, panel);
  return { findings, summary: summarise(findings) };
}
