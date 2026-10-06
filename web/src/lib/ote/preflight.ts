/**
 * Before a file is written, and after.
 *
 * The export route used to trust its JSON. A screen missing its ViewBox
 * surfaced as "Cannot read properties of undefined (reading 'Children')" with
 * a 500, and a binding to a tag that is not declared reached buildGraph's
 * throw - also a 500, although both are defects in the project being exported,
 * not in the server. And nothing checked the file that came out.
 *
 * `preflight` checks the project against the schema the canvas and the
 * packager share, plus the cross-references no schema can express, and
 * returns every problem at once - an engineer fixing them one export at a
 * time is the experience this replaces. `selfCheck` reads the written bytes
 * back through the same reader an engineer's next import would use, and
 * refuses to hand over a file that does not open as what was asked for.
 */

import { Alarm, Screen, Variable } from "./schema";
import type { PackageInput } from "./packager";
import { assertBackslashEntries } from "./packager";
import { readProject } from "./reader";

export interface PreflightProblem {
  where: string;
  problem: string;
}

const MAX_PROBLEMS = 25;

export function preflight(input: PackageInput): PreflightProblem[] {
  const out: PreflightProblem[] = [];
  const push = (where: string, problem: string) => {
    if (out.length < MAX_PROBLEMS) out.push({ where, problem });
  };

  if (!input || typeof input !== "object") return [{ where: "project", problem: "not a project object" }];
  if (typeof input.name !== "string" || !input.name.trim()) push("project", "has no name");
  if (!Array.isArray(input.screens) || input.screens.length === 0) push("project", "has no screens");
  if (!Array.isArray(input.variables)) push("project", "variables is not a list");
  if (!Array.isArray(input.alarms)) push("project", "alarms is not a list");
  if (!Array.isArray(input.wires)) push("project", "wires is not a list");
  if (out.length) return out;

  const issue = (prefix: string, error: { issues: { path: (string | number)[]; message: string }[] }) => {
    const first = error.issues[0];
    push(prefix, `${first.path.join(".") || "(root)"}: ${first.message}${error.issues.length > 1 ? ` (+${error.issues.length - 1} more)` : ""}`);
  };

  input.screens.forEach((s, i) => {
    const r = Screen.safeParse(s);
    if (!r.success) issue(`screen ${(s as { Name?: string })?.Name ?? i + 1}`, r.error);
  });

  const names = new Set<string>();
  input.variables.forEach((v, i) => {
    const r = Variable.safeParse(v);
    if (!r.success) issue(`variable ${(v as { Name?: string })?.Name ?? i + 1}`, r.error);
    // Exact: OTE names are case-sensitive (featureguide, Naming Conventions),
    // and buildGraph resolves a binding's tag exactly.
    const key = String(v?.Name ?? "");
    if (names.has(key)) push(`variable ${v.Name}`, "is declared twice");
    names.add(key);
  });

  input.alarms.forEach((a, i) => {
    const r = Alarm.safeParse(a);
    if (!r.success) issue(`alarm ${i + 1}`, r.error);
    else if (a.Trigger && !names.has(a.Trigger)) push(`alarm "${a.Message}"`, `is triggered by ${a.Trigger}, which is not a declared variable`);
  });

  const parts = new Set(
    input.screens.flatMap((s) => (Array.isArray(s?.Children?.[0]?.Children) ? s.Children[0].Children.map((p) => p.UniqueId) : [])),
  );
  input.wires.forEach((w, i) => {
    if (!w || typeof w.tag !== "string" || !w.part?.UniqueId) {
      push(`binding ${i + 1}`, "is missing its tag or its object");
      return;
    }
    if (!names.has(w.tag)) push(`binding of ${w.part.Name}`, `reads ${w.tag}, which is not a declared variable`);
    if (!parts.has(w.part.UniqueId)) push(`binding of ${w.part.Name}`, "points at an object that is on no screen");
  });
  return out;
}

/**
 * Read the written file back. Throws with a sentence when it does not open as
 * what was exported: the wrong number of screens or variables, or entries
 * written with the wrong separator.
 */
export async function selfCheck(bytes: Uint8Array, input: PackageInput): Promise<void> {
  assertBackslashEntries(bytes);
  const back = await readProject(bytes, `${input.name}.eote`);
  const wantScreens = input.screens.length;
  const gotScreens = back.screens.length + back.carried.screens;
  if (gotScreens < wantScreens) throw new Error(`the written file holds ${gotScreens} of ${wantScreens} screens`);
  const declared = new Set(back.variables.map((v) => v.Name));
  const lost = input.variables.filter((v) => !declared.has(v.Name));
  if (lost.length) throw new Error(`the written file is missing ${lost.length} variable${lost.length === 1 ? "" : "s"}, e.g. ${lost[0].Name}`);
}
