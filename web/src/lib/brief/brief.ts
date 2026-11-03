/**
 * A plant brief: the only input to a build that has no tag export.
 *
 * Before this, a description went straight to the model, the model returned a
 * tag list, and the screens were built from it with nobody having looked. The
 * placeholders appeared in the tag panel after the screens existed, which is
 * the wrong order: the engineer found out what had been assumed by reading
 * what had already been drawn (docs/PLAN_FULL_ARCHITECTURE.md §5.2).
 *
 * A brief is that assumption, written down and shown as a table before
 * anything is built. The model fills it in; the engineer confirms or edits a
 * row; only then do placeholder tags exist. Each tag records the row it came
 * from, so "where did this tag come from?" has an answer, and validation can
 * refuse one that has no answer.
 *
 * There are two ways to fill one in - a description the model reads, or the
 * form the engineer types into (decision D) - and this file is deliberately
 * ignorant of which was used. One type, one `problemsWith` gate, one
 * `tagsFromBrief`: a brief filled in by hand is not a second kind of brief
 * with a second set of rules, it is the same rows arrived at differently.
 *
 * Two rules the structure enforces rather than asks for:
 *
 *   - a brief with no units, or a unit with a count of zero, cannot be
 *     confirmed, so an empty build cannot happen silently;
 *   - a unit's kind comes from the catalogue, so the model cannot invent
 *     equipment. The engineer can still add a custom unit, with its signals
 *     written out, because the catalogue binds the model and not the person.
 */

import { z } from "zod";
import type { Variable } from "@/lib/ote/schema";
// Type-only, so this stays a module the server can import: the store's shape
// is needed to record an import, the store itself is not.
import type { TagImport } from "@/store/types";
import { CATALOGUE, KIND_IDS, kindOf, type CatalogueSignal } from "./catalogue";

/** A signal on a custom unit, which has no catalogue entry to be checked against. */
export const CustomSignal = z.object({
  id: z.string().min(1),
  type: z.enum(["BOOL", "INT", "DINT", "REAL", "LREAL", "STRING"]),
  what: z.string().default(""),
});
export type CustomSignal = z.infer<typeof CustomSignal>;

export const Unit = z.object({
  /** Stable across edits, so a tag's provenance survives renaming a row. */
  id: z.string().min(1),
  /** A catalogue id, or "custom" when the engineer wrote the signals out. */
  kind: z.string().min(1),
  label: z.string().min(1),
  /**
   * How many of this unit. Optional on a draft and required to confirm: the
   * difference between "the model did not say" and "the engineer said none",
   * which is the distinction §5.6's first test is about.
   */
  count: z.number().int().optional(),
  /** Signal ids, a subset of the kind's catalogue. */
  signals: z.array(z.string()).default([]),
  /** Only for kind "custom": the signals, written out. */
  customSignals: z.array(CustomSignal).optional(),
});
export type Unit = z.infer<typeof Unit>;

/**
 * §5.3 lists `panel` among the brief's fields. It is not here: the project
 * already carries the target panel (`ProjectState.target`), and a second copy
 * that could disagree with it would be worse than no copy. The brief's job is
 * the plant, which nothing else records.
 */
export const Brief = z.object({
  plant: z.object({ name: z.string().default(""), purpose: z.string().default("") }).default({ name: "", purpose: "" }),
  units: z.array(Unit).default([]),
  /** What feeds what. Used for ordering and connections, never for geometry. */
  flow: z.array(z.object({ from: z.string(), to: z.string() })).default([]),
  /** Signal ids that raise an alarm, across every unit that has them. */
  alarms: z.array(z.string()).default(["HI", "LO", "FLT"]),
  screens: z.object({
    overview: z.boolean().default(true),
    perUnitGroup: z.boolean().default(true),
    alarms: z.boolean().default(true),
  }).default({ overview: true, perUnitGroup: true, alarms: true }),
  naming: z.object({
    /** The only pattern today; named so a second one is a value, not a rewrite. */
    pattern: z.literal("<PREFIX>_<NNN>_<SIGNAL>").default("<PREFIX>_<NNN>_<SIGNAL>"),
    start: z.number().int().min(1).default(101),
  }).default({ pattern: "<PREFIX>_<NNN>_<SIGNAL>", start: 101 }),
});
export type Brief = z.infer<typeof Brief>;

export const EMPTY_BRIEF: Brief = Brief.parse({});

/** One reason a brief cannot be confirmed, naming the field that is missing. */
export interface BriefProblem {
  unitId?: string;
  field: string;
  message: string;
}

/**
 * What stops this brief being confirmed, or nothing.
 *
 * Every problem names the field, because "the brief is invalid" sends an
 * engineer looking and "unit 2 has no count" does not.
 */
export function problemsWith(brief: Brief): BriefProblem[] {
  const problems: BriefProblem[] = [];
  if (brief.units.length === 0) {
    problems.push({ field: "units", message: "A brief needs at least one unit before it can be built from." });
  }
  const seen = new Set<string>();
  for (const unit of brief.units) {
    const where = unit.label || unit.id;
    if (seen.has(unit.id)) problems.push({ unitId: unit.id, field: "id", message: `Two units share the id ${unit.id}.` });
    seen.add(unit.id);

    // A drafted row always arrives with a label; one typed on the form can be
    // cleared, and the label is what the tag comments read, so an unnamed row
    // would reach the screens as "1 running".
    if (!unit.label.trim()) {
      problems.push({ unitId: unit.id, field: "label", message: `${where} has no name. Say what this equipment is called.` });
    }

    if (unit.count === undefined) {
      problems.push({ unitId: unit.id, field: "count", message: `${where} has no count. Say how many there are.` });
    } else if (unit.count < 1) {
      problems.push({ unitId: unit.id, field: "count", message: `${where} has a count of ${unit.count}. A unit needs at least one.` });
    }

    if (unit.kind === "custom") {
      if (!unit.customSignals?.length) {
        problems.push({ unitId: unit.id, field: "customSignals", message: `${where} is a custom unit, so its signals have to be listed.` });
      }
      continue;
    }

    const kind = kindOf(unit.kind);
    if (!kind) {
      problems.push({ unitId: unit.id, field: "kind", message: `${where} has kind "${unit.kind}", which is not in the catalogue.` });
      continue;
    }
    if (unit.signals.length === 0) {
      problems.push({ unitId: unit.id, field: "signals", message: `${where} has no signals. Pick at least one.` });
    }
    const allowed = new Set(kind.signals.map((s) => s.id));
    for (const signal of unit.signals) {
      if (!allowed.has(signal)) {
        problems.push({ unitId: unit.id, field: "signals", message: `${where} has signal ${signal}, which a ${kind.label.toLowerCase()} does not have.` });
      }
    }
  }
  return problems;
}

export const canConfirm = (brief: Brief): boolean => problemsWith(brief).length === 0;

/** The signals a unit actually carries, catalogue or custom. */
export function signalsForUnit(unit: Unit): CatalogueSignal[] {
  if (unit.kind === "custom") return (unit.customSignals ?? []).map((s) => ({ id: s.id, type: s.type, what: s.what }));
  const kind = kindOf(unit.kind);
  if (!kind) return [];
  const wanted = new Set(unit.signals);
  return kind.signals.filter((s) => wanted.has(s.id));
}

/**
 * Where a placeholder tag came from.
 *
 * Carried beside the tags rather than inside `Variable`, which is the
 * packager's shape and has no room for it. Validation reads this to refuse a
 * tag that traces to no row, and removing a row removes its tags by it.
 */
export interface TagProvenance {
  /** Tag name -> the brief unit that produced it. */
  byTag: Record<string, string>;
}

export interface DraftedTags {
  variables: Variable[];
  provenance: TagProvenance;
}

const prefixOf = (unit: Unit): string =>
  unit.kind === "custom"
    ? (unit.label.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "UNT")
    : (kindOf(unit.kind)?.prefix ?? "UNT");

/**
 * The placeholder tags a confirmed brief produces.
 *
 * Refuses an unconfirmable brief rather than producing a shorter list from it:
 * the whole point is that nothing exists until a person has agreed to it.
 */
export function tagsFromBrief(brief: Brief): DraftedTags {
  if (!canConfirm(brief)) throw new Error("This brief cannot be built from yet: " + problemsWith(brief)[0].message);
  const variables: Variable[] = [];
  const byTag: Record<string, string> = {};
  const start = brief.naming.start;

  for (const unit of brief.units) {
    const prefix = prefixOf(unit);
    const signals = signalsForUnit(unit);
    for (let i = 0; i < (unit.count ?? 0); i += 1) {
      const number = start + i;
      for (const signal of signals) {
        const name = `${prefix}_${number}_${signal.id}`;
        if (byTag[name]) continue;
        byTag[name] = unit.id;
        variables.push({
          Name: name,
          DataType: signal.type,
          Comments: `${unit.label} ${i + 1}${signal.what ? ` ${signal.what}` : ""}`,
          DeviceAddress: "",
        });
      }
    }
  }
  return { variables, provenance: { byTag } };
}

/**
 * Tags that trace to no row in the confirmed brief.
 *
 * The "checked, never trusted" half of §5.3: the drafting path and the
 * validation path are separate, so a tag that arrived some other way - a model
 * that added one after the fact, a stale list from an earlier brief - is found
 * rather than assumed not to exist.
 */
export function untraceable(variables: Variable[], brief: Brief, provenance: TagProvenance): Variable[] {
  const rows = new Set(brief.units.map((u) => u.id));
  return variables.filter((v) => {
    const from = provenance.byTag[v.Name];
    return from === undefined || !rows.has(from);
  });
}

/** Remove a unit and every tag it produced. */
export function withoutUnit(
  unitId: string,
  brief: Brief,
  variables: Variable[],
  provenance: TagProvenance,
): { brief: Brief; variables: Variable[]; provenance: TagProvenance } {
  const byTag = Object.fromEntries(Object.entries(provenance.byTag).filter(([, id]) => id !== unitId));
  return {
    brief: { ...brief, units: brief.units.filter((u) => u.id !== unitId), flow: brief.flow.filter((f) => f.from !== unitId && f.to !== unitId) },
    variables: variables.filter((v) => provenance.byTag[v.Name] !== unitId),
    provenance: { byTag },
  };
}

/** A unit with the catalogue's defaults filled in, for the rules and the UI. */
export function unitFromKind(kindId: string, count: number, index: number): Unit {
  const kind = CATALOGUE.find((k) => k.id === kindId);
  if (!kind) throw new Error(`${kindId} is not a catalogue kind`);
  return {
    id: `${kind.id}-${index}`,
    kind: kind.id,
    label: kind.label,
    count,
    signals: [...kind.defaultSignals],
  };
}

export { KIND_IDS };

/**
 * A brief an engineer agreed to, with the tags it produced.
 *
 * Carried on the project so validation can check the two against each other
 * later, when the screens exist and nobody remembers which rows were on screen
 * at the time. `confirmedAt` is the moment a person said yes, which is the fact
 * the whole phase turns on.
 */
export interface ConfirmedBrief {
  brief: Brief;
  provenance: TagProvenance;
  confirmedAt: number;
  /** How the brief was first drafted, for the report. */
  by: "model" | "rules" | "form";
}

export function confirm(brief: Brief, by: ConfirmedBrief["by"], now = Date.now()): { confirmed: ConfirmedBrief; variables: Variable[] } {
  const drafted = tagsFromBrief(brief);
  return {
    confirmed: { brief, provenance: drafted.provenance, confirmedAt: now, by },
    variables: drafted.variables,
  };
}

/**
 * A confirmed brief as the import record a project holds.
 *
 * The same three facts every caller of `confirm` needs next: the tags, the
 * brief they came from, and the note that they are assumed rather than
 * exported (`TagImport.pending`, which keeps them out of the written file).
 * Building that record was in the browser hook, which left anything without a
 * React tree - the MCP tool, a route, a test - to assemble it again and get
 * `pending` wrong once. This is the whole path from brief to placeholder tags,
 * and it runs anywhere.
 *
 * Throws on a brief that cannot be confirmed, the way `tagsFromBrief` does.
 * Ask `problemsWith` first; the answer is a list of fields, which is what a
 * caller can act on.
 */
export function placeholderImport(
  brief: Brief,
  by: ConfirmedBrief["by"],
  now = Date.now(),
): { confirmed: ConfirmedBrief; variables: Variable[]; tagImport: TagImport } {
  const { confirmed, variables } = confirm(brief, by, now);
  return {
    confirmed,
    variables,
    tagImport: {
      fileName: "Assumed from the confirmed brief",
      at: confirmed.confirmedAt,
      corrections: [],
      skipped: [],
      summary: { total: variables.length },
      pending: true,
      brief: confirmed,
    },
  };
}

/** "overview", "one screen per unit group" - in the order the pipeline builds them. */
const SCREEN_WORDS: [keyof Brief["screens"], string][] = [
  ["overview", "an overview"],
  ["perUnitGroup", "one screen per unit group"],
  ["alarms", "an alarm screen"],
];

/**
 * The brief, said out loud, as the request a build turn is given.
 *
 * A brief filled in on the form has no description behind it, and the turn
 * still needs words: the history reads as a build log, and "" is not a log
 * entry. It does not have to carry the engineering - by the time this is sent
 * the placeholder tags are already in the project and the generator reads the
 * equipment from their names, exactly as it does for a real export. This only
 * has to say what was asked for.
 */
export function requestFromBrief(brief: Brief): string {
  const plant = [brief.plant.name, brief.plant.purpose].map((s) => s.trim()).filter(Boolean).join(": ");
  const units = brief.units.map((u) => `${u.count ?? 1} ${u.label}`).join(", ");
  const screens = SCREEN_WORDS.filter(([key]) => brief.screens[key]).map(([, word]) => word);
  return [
    plant || "A plant",
    units ? `with ${units}.` : ".",
    screens.length ? `Build ${screens.join(", ")}.` : "",
  ].join(" ").replace(/\s+\./g, ".").trim();
}
