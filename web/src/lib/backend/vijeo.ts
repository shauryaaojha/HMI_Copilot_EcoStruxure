/**
 * Vijeo Designer, declared but not yet writable.
 *
 * Schneider's answer 6: no migration tool wanted, but *"it would be beneficial
 * if the solution is developed in a way that allows it to be easily adapted for
 * Vijeo Designer as well."* This module is what that sentence means in code. It
 * exists so that the seam has two implementations rather than one - a seam with
 * a single implementation is not a seam, it is an interface nobody has tested -
 * and so that the differences between the formats are written down where the
 * generator and the lint can read them.
 *
 * It does not write. `provisional` is true and `unavailable` says why: we have
 * never opened a Vijeo Designer project. Guessing at a format produces a file
 * that opens and is quietly wrong, which is worse for an engineer than no file
 * at all, and it is the one thing that would cost us Schneider's trust.
 *
 * What is needed to finish it, in order:
 *   1. A Vijeo Designer project and a variable export, which we have asked for.
 *   2. The part-type mapping confirmed against that project, not against a
 *      product page - the seven parts left out below are the ones whose
 *      equivalent we will not claim until then.
 *   3. The target list from the installation, so panels.ts can pair the ST6 and
 *      STM6 families with this format instead of leaving them unpaired.
 */

import type { PartType } from "@/lib/ote/schema";
import type { Backend, Capabilities } from "./types";

/**
 * The part types whose equivalent is unambiguous in any HMI tool: a rectangle
 * is a rectangle, a bit lamp is a bit lamp. The seven we leave out - the bar
 * scale, the two trends, the pipe, the date and time display, the toggle and
 * the multi-state lamp - all carry configuration whose shape we would be
 * inventing. The capability lint reports a screen that uses one, which is the
 * point: the generator degrades instead of the writer lying.
 */
const PARTS: readonly PartType[] = [
  "Rectangle",
  "TextBox",
  "Lamp",
  "NumericDisplay",
  "StringDisplay",
  "Path",
  "Switch",
  "AlarmSummary",
];

const capabilities: Capabilities = {
  parts: PARTS,
  // Vijeo Designer is not built on OTE's colour-set indices, so a pack's
  // tokens would resolve to values rather than indices here. Until confirmed
  // this is the one capability most likely to be wrong, and the pack already
  // resolves a token to hex for the canvas, so the path exists.
  colour: "rgb",
  nativeComposites: false,
  masterScreens: false,
  folders: false,
  maxNameLength: 32,
  provisional: true,
};

export const VIJEO: Backend = {
  id: "vijeo",
  name: "Vijeo Designer",
  // Unconfirmed, like everything else here. Our own research (REENGINEERING.md
  // §1.5) records .zdat for a Vijeo Designer project; we have never held one.
  // It is written down so the real answer replaces a stated guess rather than
  // an invented fact - the first draft of this file said ".vdz", which came
  // from nowhere at all.
  extension: ".zdat",
  capabilities,
  unavailable:
    "Vijeo Designer export is declared but not implemented: we have never opened a Vijeo Designer project, " +
    "and writing a format from its documentation produces a file that opens and is wrong. " +
    "It needs one real project and one variable export to finish.",
  async write() {
    throw new Error(VIJEO.unavailable);
  },
};
