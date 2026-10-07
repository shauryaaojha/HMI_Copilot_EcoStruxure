/**
 * Whether a conversational edit may land without the engineer accepting it.
 *
 * By default a clean edit - nothing rejected, nothing deleted - commits at
 * once, with undo and a version snapshot, which suits design work. A site
 * under management of change (MOC, 21 CFR Part 11) needs every AI change to
 * be an explicit decision by a named person, so `reviewAiEdits` turns every
 * edit into a proposal drawn as ghosts on the canvas and accepted or
 * discarded. docs/AUDIT_2026-10.md §4.
 */

export interface EditOutcome {
  rejected: readonly unknown[];
  deleted?: unknown;
}

export function commitsWithoutReview(outcome: EditOutcome, standards: { reviewAiEdits?: boolean }): boolean {
  if (standards.reviewAiEdits) return false;
  return outcome.rejected.length === 0 && !outcome.deleted;
}
