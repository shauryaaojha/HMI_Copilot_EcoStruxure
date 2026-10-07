/**
 * Vijeo Designer -> Operator Terminal Expert, as a plan an engineer can read.
 *
 * Schneider's own VJD-to-OTE migration tool is on hold (FAQ FAQ000273797) and
 * the Vijeo panel format is unpublished binary, so a screen cannot be copied
 * object by object. What can be carried honestly is the *structure*: which
 * panels the application had, and which equipment each one showed. That is
 * read from the backup (lib/vijeo/vdz.ts: each panel's variable references),
 * matched to equipment inferred from the tags, and turned into one OTE screen
 * program per Vijeo base panel - same name, same units - which the normal
 * pipeline compiles into OTE-native faceplates, bindings and alarms.
 *
 * Everything that does not carry is reported by name: popups and templates
 * (OTE builds those differently), panels that show no recognisable unit, and
 * every data type that had to be assumed because no variable export came
 * with the backup. Nothing is guessed silently.
 */

import { inferEquipment, type StructureHint } from "@/lib/ai/infer";
import { fitToLimits, limitsFor } from "@/lib/ai/plan";
import { programOf, type ScreenProgram } from "@/lib/program/program";
import type { ScreenSpec } from "@/lib/ote/layout";
import { normaliseNames } from "@/lib/validation/naming";
import type { Variable } from "@/lib/ote/schema";
import type { VijeoInventory } from "./vdz";

export interface MigrationPlan {
  programs: ScreenProgram[];
  /** The tags the OTE project will have. */
  variables: Variable[];
  structure?: StructureHint[];
  report: {
    migrated: { panel: string; screen: string; units: string[] }[];
    notMigrated: { panel: string; kind: string; reason: string }[];
    /** Data types assumed from tag names, when no Vijeo variable export came with the backup. */
    assumedTypes: { tag: string; dataType: Variable["DataType"] }[];
    /** Variables the panels name that the variable export does not have. */
    unknownReferences: string[];
  };
}

/** Roles whose signal is a bit: anything else read from a name is taken as a number. */
const BIT = /_(RUN|RUNNING|ON|FLT|FAULT|TRIP|ALM|ALARM|OPEN|OPENED|OPN|CLOSED|CLOSE|CLS|AVAIL|AVAILABLE|READY|HI|HIGH|HH|LO|LOW|LL|ESTOP|START|STOP|CMD|AUTO|MAN|RESET|ACK|JAM|LOCKOUT|ENABLED|ACTIVE)$/i;

/** OTE-legal name for a Vijeo variable: folders and structure members joined with "_". */
const oteName = (vijeo: string) => vijeo.replace(/\[(\d+)\]/g, "_$1").replace(/[^A-Za-z0-9_]/g, "_");

/**
 * Names for variables known only by their dotted Vijeo paths. Folders hide
 * the equipment prefix (PUMPS.PMP_101_RUN), so each name is the shortest tail
 * of its path that no other path shares - never a bare member like "Running",
 * which says nothing about whose it is.
 */
export function shortNames(paths: string[]): string[] {
  const segs = paths.map((p) => p.replace(/\[(\d+)\]/g, ".$1").split("."));
  const tail = (s: string[], k: number) => s.slice(-k).join(".");
  const count = new Map<string, number>();
  for (const s of segs) for (let k = 1; k <= s.length; k++) count.set(tail(s, k), (count.get(tail(s, k)) ?? 0) + 1);
  return segs.map((s) => {
    for (let k = 1; k <= s.length; k++) {
      const t = tail(s, k);
      // An array index ("3" from [3]) never tells whose element it is.
      const last = s[s.length - 1];
      const telling = k >= 2 ? !/^\d+$/.test(s[s.length - k]) || k === s.length : /[_\d]/.test(last) && !/^\d+$/.test(last);
      if (telling && count.get(t) === 1) return oteName(t);
    }
    return oteName(s.join("."));
  });
}

/**
 * Plan the migration.
 *
 * `exported` is the Vijeo variable export read by lib/tags/parse.ts, when the
 * engineer provided one: it carries the real data types and the structure.
 * Without it the variables are the ones the panels name, typed from their
 * names, and every such type is listed in the report.
 */
export function planMigration(
  inventory: VijeoInventory,
  panel: { width: number; height: number },
  exported?: { variables: Variable[]; structure?: StructureHint[]; corrections: { from: string; to: string }[] },
): MigrationPlan {
  const report: MigrationPlan["report"] = { migrated: [], notMigrated: [], assumedTypes: [], unknownReferences: [] };

  // --- the tags -----------------------------------------------------------
  let variables: Variable[];
  const nameOf = new Map<string, string>();
  if (exported) {
    variables = exported.variables;
    const renamed = new Map(exported.corrections.map((c) => [c.from, c.to]));
    const have = new Set(variables.map((v) => v.Name));
    for (const ref of inventory.variables) {
      const n = renamed.get(ref) ?? (have.has(ref) ? ref : oteName(ref));
      if (have.has(n)) nameOf.set(ref, n);
      else report.unknownReferences.push(ref);
    }
  } else {
    const { names } = normaliseNames(shortNames(inventory.variables));
    variables = names.map((name, i) => {
      const dataType: Variable["DataType"] = BIT.test(name) ? "BOOL" : "REAL";
      report.assumedTypes.push({ tag: name, dataType });
      nameOf.set(inventory.variables[i], name);
      return { Name: name, DataType: dataType, Comments: `from Vijeo ${inventory.variables[i]}`, DeviceAddress: "" };
    });
  }

  // --- the screens ----------------------------------------------------------
  const units = inferEquipment(variables, exported?.structure);
  const unitOf = new Map(units.flatMap((u) => u.tags.map((t) => [t, u] as const)));
  const specs: ScreenSpec[] = [];
  const taken = new Set<string>();
  for (const p of inventory.panels) {
    if (p.kind !== "base") {
      report.notMigrated.push({
        panel: p.name,
        kind: p.kind,
        reason: p.kind === "popup" ? "a popup window: OTE builds these as content screens, add them by hand or from a faceplate" : "a template: OTE uses compound objects for this",
      });
      continue;
    }
    const tags = p.references.map((r) => nameOf.get(r)).filter((t): t is string => !!t);
    const shown = [...new Set(tags.map((t) => unitOf.get(t)).filter((u) => u && u.kind !== "instrument").map((u) => u!.id))];
    if (shown.length === 0) {
      report.notMigrated.push({
        panel: p.name,
        kind: p.kind,
        reason: tags.length === 0 ? "it names no variable this project has" : `its ${tags.length} variable${tags.length === 1 ? "" : "s"} belong to no recognised unit`,
      });
      continue;
    }
    let screenName = oteName(p.name).replace(/^(\d)/, "S$1") || "Screen";
    for (let n = 2; taken.has(screenName.toLowerCase()); n++) screenName = `${oteName(p.name)}_${n}`;
    taken.add(screenName.toLowerCase());
    const hasFaults = shown.some((id) => units.find((u) => u.id === id)?.roles.some((r) => r.role === "fault"));
    specs.push({
      screenName,
      title: p.name,
      level: 2,
      include: shown,
      sections: hasFaults ? ["status", "process", "alarms"] : ["status", "process"],
    });
    report.migrated.push({ panel: p.name, screen: screenName, units: shown });
  }
  // A panel with more units than an OTE screen of this size holds is split,
  // the way the planner splits its own screens.
  const fitted = fitToLimits(specs, limitsFor(panel));
  const programs = fitted.map((spec) => programOf(spec, "migrated from a Vijeo Designer panel"));
  return { programs, variables, ...(exported?.structure ? { structure: exported.structure } : {}), report };
}
