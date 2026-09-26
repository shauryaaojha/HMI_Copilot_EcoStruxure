/**
 * The critic's other half: what the model knows, checked against what the
 * tags say. docs/PLAN_PHASE4.md §3.
 *
 * Two of the four defects the vision critic found were not about the picture
 * at all - a suffix the role table had never been taught, and a headline
 * reading chosen without regard to what the equipment is. Both are visible in
 * the model, before anything is drawn, and both are cheaper to catch here.
 *
 * Deterministic, keyless: Lane 1.
 */

import type { Finding } from "@/lib/validation/rules";
import type { Variable } from "@/lib/ote/schema";
import { isReading, type PlantModel } from "@/lib/plant/model";
import { roleMatched } from "@/lib/ai/infer";
import { headlineRolesFor } from "@/lib/plant/classes";

/**
 * A trailing segment that looks like a word: TNK_101_LEVEL has one, FT_101
 * does not. Only a word can be a role we failed to recognise; a number is
 * just a loop.
 */
const TRAILING_WORD = /_([A-Za-z]{2,})$/;

/**
 * Tags whose last segment is a word the role table does not know. Each one is
 * silently read as a plain value today, which is how a running-hours counter
 * ends up on a screen labelled "value" with no unit.
 */
export function critiqueRoleCoverage(variables: Variable[]): Finding[] {
  const unknown = new Map<string, string[]>();
  for (const v of variables) {
    const word = TRAILING_WORD.exec(v.Name);
    if (!word || roleMatched(v.Name)) continue;
    const key = word[1].toUpperCase();
    unknown.set(key, [...(unknown.get(key) ?? []), v.Name]);
  }
  return [...unknown.entries()].map(([word, tags]) => ({
    severity: "warning" as const,
    rule: "model.roleCoverage",
    tag: tags[0],
    message:
      `${tags.length === 1 ? "Tag" : `${tags.length} tags`} end in _${word}, which the role table does not recognise: ` +
      `${tags.slice(0, 3).join(", ")}${tags.length > 3 ? ", …" : ""}. They are being read as plain values.`,
    suggestion: `Add _${word} to the role table in lib/ai/infer.ts, and to the unit and range defaults in lib/plant/units.ts.`,
  }));
}

/**
 * Equipment whose headline reading is not one its class would lead with. A
 * pump reads flow, speed, pressure, current or hours; when it reads a level,
 * either the class is wrong or the tag belongs to something else. Information,
 * not a warning: a pump whose only reading is a level is a real pump with one
 * odd tag, and the engineer decides which.
 */
export function critiqueHeadlines(model: PlantModel): Finding[] {
  const findings: Finding[] = [];
  for (const e of model.equipment) {
    const expected = headlineRolesFor(e.class);
    if (!expected.length) continue;
    const readings = e.roles.filter((r) => isReading(r.dataType));
    if (!readings.length) continue;
    const chosen = readings.find((r) => expected.includes(r.role)) ?? readings[0];
    if (expected.includes(chosen.role)) continue;
    findings.push({
      severity: "info",
      rule: "model.classHeadline",
      tag: chosen.tag,
      message: `${e.label} is a ${e.class} and its headline reading is a ${chosen.role} (${chosen.tag}); a ${e.class} leads with ${expected.join(", ")}.`,
      suggestion: `Check the class of ${e.label}, or whether ${chosen.tag} belongs to it.`,
    });
  }
  return findings;
}
