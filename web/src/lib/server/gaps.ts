/**
 * Writing to the gap log (lib/server/repo-gaps.ts) without ever failing the
 * request that found the gap. A refusal is already the answer the caller
 * gets; losing the log line is better than turning it into a 500.
 */
import { repo } from "./repo";
import type { GapInput } from "./repo-gaps";

export async function logGaps(rows: GapInput[]): Promise<void> {
  if (rows.length === 0) return;
  // Also in the function log, so a gap is visible even where the database is not.
  for (const row of rows.slice(0, 5)) console.warn(`[gap] ${row.source}${row.tool ? ` ${row.tool}` : ""}: ${row.detail.slice(0, 200)}`);
  try {
    await repo().gaps.record(rows);
  } catch {
    // No storage (a test, a laptop without a database): the console line stands.
  }
}

/** The lines of a landing report that say something could not be done. */
export const REFUSED_LINE = /^(refused|could not be done): /;
