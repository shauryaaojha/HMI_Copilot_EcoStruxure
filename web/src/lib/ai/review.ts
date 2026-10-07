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

/**
 * One op as the engineer reads it in a proposal: what it does and to what.
 * The model's own note leads when it wrote one.
 */
export function labelOp(op: { op: string; target?: string; targets?: string[]; name?: string; type?: string; text?: string; tag?: string; equipment?: string; screen?: string; note?: string }): string {
  if (op.note) return op.note;
  const verb = op.op.replace(/([A-Z])/g, " $1").toLowerCase();
  const what = op.equipment ?? op.target ?? op.targets?.join(", ") ?? op.name ?? op.type ?? "";
  const extra = op.tag ? ` to ${op.tag}` : op.text ? ` "${op.text}"` : "";
  return `${verb.charAt(0).toUpperCase()}${verb.slice(1)} ${what}${extra}`.trim() + (op.screen ? ` on ${op.screen}` : "");
}

/** The ops the engineer kept ticked, in their original order. */
export const selectedOps = <T>(ops: T[], keep: ReadonlySet<number>): T[] => ops.filter((_, i) => keep.has(i));
