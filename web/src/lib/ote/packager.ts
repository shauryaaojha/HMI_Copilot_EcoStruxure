/**
 * Project tree -> .eote, in the browser's Node runtime.
 *
 * Two traps, both carried over from the Python reference implementation:
 *
 *  1. ZIP entry names use BACKSLASH separators, the way the product writes them.
 *     Python's zipfile silently rewrites them to forward slashes on construction.
 *     Verify jszip against the raw bytes - blob.includes("Screens\\") - never
 *     against the library's own name list, which may normalise on read.
 *
 *  2. Quote every SQL column. "Order" and "Value" are keywords, and SQLite
 *     returns an unknown double-quoted identifier as a STRING LITERAL rather
 *     than erroring, so a typo becomes silent bad data instead of a crash.
 *
 * Most databases (Recipe, Security, Language, ...) are copied verbatim from the
 * Blank.eote skeleton; only Variables.db and Alarm.db are written. The skeleton
 * is Schneider's, extracted locally by scripts/extract-skeleton.mjs and never
 * committed.
 *
 * Phase 1 of docs/BUILD_PLAN.md - the gate for everything downstream.
 */

import type { Alarm, Screen, Variable } from "@/lib/ote/schema";

export interface PackageInput {
  name: string;
  target: { model: string; width: number; height: number };
  screens: Screen[];
  variables: Variable[];
  alarms: Alarm[];
}

export async function packageProject(_input: PackageInput): Promise<Uint8Array> {
  // TODO Phase 1: port tools/make_project.py - write_variables, write_alarms,
  // write_screens, write_bindings, then repack with backslash entry names.
  throw new Error("not implemented - see docs/BUILD_PLAN.md Phase 1");
}
