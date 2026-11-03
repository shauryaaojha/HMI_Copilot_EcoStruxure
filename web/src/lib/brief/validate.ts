/**
 * Checking a project's tags against the brief that was confirmed.
 *
 * The drafting path produces tags from a brief; this path asks the opposite
 * question, of whatever tags the project actually holds: which of these traces
 * to a row a person agreed to? Separating the two is the point. If the same
 * code both wrote the tags and vouched for them, a tag added afterwards - by a
 * later model turn, by an edit, by a brief row that was removed and left its
 * tags behind - would be vouched for too.
 *
 * Only runs on a project built from a brief. A project with a real tag export
 * has no brief and these rules say nothing (docs/PLAN_FULL_ARCHITECTURE.md §5.3
 * step 6, the "checked, never trusted" pattern).
 */

import type { Variable } from "@/lib/ote/schema";
import type { Finding } from "@/lib/validation/rules";
import { signalsForUnit, untraceable, type ConfirmedBrief } from "./brief";

/**
 * Tags that no confirmed row accounts for, and rows that produced nothing.
 *
 * An untraceable tag is an error: it is bound to parts on screens, so it looks
 * to a reviewer exactly like a tag the plant has. A row that produced nothing
 * is a warning, because the brief and the project disagree but nothing on
 * screen is wrong.
 */
export function checkBrief(variables: Variable[], confirmed: ConfirmedBrief | undefined | null): Finding[] {
  if (!confirmed) return [];
  const findings: Finding[] = [];

  for (const stray of untraceable(variables, confirmed.brief, confirmed.provenance)) {
    findings.push({
      severity: "error",
      rule: "brief.provenance",
      tag: stray.Name,
      message: `Tag ${stray.Name} is not in the confirmed brief. Placeholder tags may only come from a brief row.`,
      suggestion: "Add the unit to the brief and confirm it, or remove the tag and whatever is bound to it.",
    });
  }

  const present = new Set(variables.map((v) => v.Name));
  const produced = new Map<string, number>();
  for (const [tag, unitId] of Object.entries(confirmed.provenance.byTag)) {
    if (present.has(tag)) produced.set(unitId, (produced.get(unitId) ?? 0) + 1);
  }
  for (const unit of confirmed.brief.units) {
    const expected = (unit.count ?? 0) * signalsForUnit(unit).length;
    const found = produced.get(unit.id) ?? 0;
    if (expected > 0 && found === 0) {
      findings.push({
        severity: "warning",
        rule: "brief.missing",
        message: `${unit.label} was confirmed in the brief but none of its tags are in the project.`,
        suggestion: "Draft the tags from the brief again, or remove the row.",
      });
    } else if (found < expected) {
      findings.push({
        severity: "info",
        rule: "brief.missing",
        message: `${unit.label}: ${found} of ${expected} tags from the brief are in the project.`,
      });
    }
  }
  return findings;
}
