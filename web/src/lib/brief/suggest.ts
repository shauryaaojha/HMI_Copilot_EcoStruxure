/**
 * What finished projects suggest about a brief.
 *
 * The knowledge base (lib/knowledge) holds projects engineers actually
 * shipped. For a brief it can answer one useful question: when a plant like
 * this had pumps, which signals did the pumps actually have? A plant whose
 * pumps all carry START and STOP is evidence that a brief listing only RUN is
 * thin; a plant whose valves never carry FLT is evidence the other way.
 *
 * It may only ever suggest, and only about units the brief already has:
 *
 *   - a suggestion is returned, not applied. The engineer accepts a row.
 *   - no suggestion creates a unit. Evidence that other plants had a tank is
 *     not evidence that this plant has one, and a knowledge base that can add
 *     equipment is the hallucination of §5.2 with a citation attached
 *     (docs/PLAN_FULL_ARCHITECTURE.md §5.6, last test).
 *   - a suggested signal comes from the kind's own catalogue, so evidence
 *     cannot widen the vocabulary either.
 *
 * With an empty store this returns nothing and the brief stands as drafted,
 * which is the state every laptop is in today.
 */

import type { ProjectKnowledge } from "@/lib/knowledge/scan";
import type { Brief } from "./brief";
import { kindOf } from "./catalogue";

export interface SignalSuggestion {
  unitId: string;
  /** Catalogue signals this kind usually has that the brief leaves out. */
  add: string[];
  /** Signals the brief has that projects with this kind rarely carry. */
  rarely: string[];
  /** How many scanned projects the evidence comes from. */
  projects: number;
}

/** A signal is usual at this share of the projects that had the kind at all. */
const USUAL = 0.6;
/** And rare below this one. */
const RARE = 0.15;

/** The last word of a tag name: PMP_101_RUN -> RUN. */
const roleOf = (tag: string): string => {
  const words = tag.split(/[_.\-\s]+/).filter((w) => w && !/^\d+$/.test(w));
  return words.length > 1 ? words[words.length - 1].toUpperCase() : "";
};

/**
 * Per kind, which signals were seen and in how many projects.
 *
 * Counted by project rather than by tag, so one enormous plant does not
 * outvote ten ordinary ones.
 */
export function evidenceFor(records: ProjectKnowledge[]): Map<string, { projects: number; signals: Map<string, number> }> {
  const out = new Map<string, { projects: number; signals: Map<string, number> }>();
  for (const record of records) {
    const perKind = new Map<string, Set<string>>();
    for (const unit of record.equipment) {
      const kind = kindOf(unit.kind);
      if (!kind) continue;
      const seen = perKind.get(kind.id) ?? new Set<string>();
      for (const tag of unit.tags) {
        const role = roleOf(tag);
        if (role) seen.add(role);
      }
      perKind.set(kind.id, seen);
    }
    for (const [id, seen] of perKind) {
      const entry = out.get(id) ?? { projects: 0, signals: new Map<string, number>() };
      entry.projects += 1;
      for (const role of seen) entry.signals.set(role, (entry.signals.get(role) ?? 0) + 1);
      out.set(id, entry);
    }
  }
  return out;
}

/**
 * Suggestions for the units this brief already has, and nothing else.
 *
 * Returns one entry per unit it has something to say about; a unit it has no
 * evidence for is absent rather than present and empty, so a caller cannot
 * read silence as "these signals are wrong".
 */
export function suggestSignals(brief: Brief, records: ProjectKnowledge[], minProjects = 2): SignalSuggestion[] {
  if (records.length === 0) return [];
  const evidence = evidenceFor(records);
  const suggestions: SignalSuggestion[] = [];

  for (const unit of brief.units) {
    const kind = kindOf(unit.kind);
    if (!kind) continue;
    const seen = evidence.get(kind.id);
    if (!seen || seen.projects < minProjects) continue;

    const has = new Set(unit.signals);
    const share = (signal: string) => (seen.signals.get(signal) ?? 0) / seen.projects;
    // Only the kind's own catalogue, so evidence cannot invent a signal.
    const add = kind.signals.map((s) => s.id).filter((id) => !has.has(id) && share(id) >= USUAL);
    const rarely = unit.signals.filter((id) => share(id) <= RARE);
    if (add.length === 0 && rarely.length === 0) continue;
    suggestions.push({ unitId: unit.id, add, rarely, projects: seen.projects });
  }
  return suggestions;
}

/**
 * A brief with the accepted suggestions folded in.
 *
 * Takes the ids the engineer accepted rather than every suggestion, and
 * touches signals only - the unit list, the counts and the labels come out the
 * way they went in. That is enforced here rather than trusted, because this is
 * the one function in the phase that writes a brief from evidence.
 */
export function withSuggestions(brief: Brief, accepted: SignalSuggestion[]): Brief {
  const byUnit = new Map(accepted.map((s) => [s.unitId, s]));
  return {
    ...brief,
    units: brief.units.map((unit) => {
      const suggestion = byUnit.get(unit.id);
      if (!suggestion) return unit;
      const kind = kindOf(unit.kind);
      if (!kind) return unit;
      const allowed = new Set(kind.signals.map((s) => s.id));
      const signals = [...new Set([...unit.signals, ...suggestion.add.filter((s) => allowed.has(s))])];
      return { ...unit, signals };
    }),
  };
}
