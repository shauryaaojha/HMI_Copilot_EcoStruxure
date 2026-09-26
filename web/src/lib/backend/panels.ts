/**
 * Panels, as data.
 *
 * Schneider's answer 1: *"the solution shouldn't be specific to any Panel."*
 * The panel used to be the string "HMIGTO6310" in four places. It is now a
 * profile with a resolution, a viewing distance and the formats that can target
 * it - so the layout is designed for a panel rather than for the panel, and
 * adding one is a row here.
 *
 * The exported file's panel still comes from the skeleton's Target.dat, which
 * the tool cannot change; choosing one here sets what the layout is designed
 * for, and the top bar flags a disagreement rather than showing a label the
 * file contradicts.
 *
 * Every row below is an OTE panel, read from the product. There are
 * deliberately no Vijeo Designer rows: the ST6 and STM6 families are that
 * product's, but pairing a model with a resolution from a product page rather
 * than from an installation's target list is how a layout ends up designed for
 * a screen that does not exist. They go in when we have the list.
 */

import type { FormatId, PanelProfile } from "./types";

export const PANELS: readonly PanelProfile[] = [
  { model: "HMIGTO6310", width: 1024, height: 768, formats: ["eote"], viewing: "touch" },
  { model: "HMIGTO5310", width: 800, height: 480, formats: ["eote"], viewing: "touch" },
  { model: "HMIGTO4310", width: 640, height: 480, formats: ["eote"], viewing: "touch" },
  { model: "HMISTU855", width: 320, height: 240, formats: ["eote"], viewing: "touch" },
];

export const DEFAULT_PANEL = PANELS[0];

/** The panels a format can target. Empty means the format has no list yet. */
export const panelsFor = (format: FormatId): readonly PanelProfile[] =>
  PANELS.filter((p) => p.formats.includes(format));

/** A panel by model name, for reading a stored project's target back. */
export const panelNamed = (model: string): PanelProfile | undefined =>
  PANELS.find((p) => p.model === model);

/**
 * The "model|width|height" string the UI has always used as an option value.
 * Kept because two representations of a panel would be two things to keep in
 * step, and this one is already in stored projects.
 */
export const panelValue = (p: PanelProfile) => `${p.model}|${p.width}|${p.height}`;

export function panelFromValue(value: string): PanelProfile | undefined {
  const [model, width, height] = value.split("|");
  const known = panelNamed(model);
  if (known) return known;
  const w = Number(width);
  const h = Number(height);
  if (!model || !Number.isFinite(w) || !Number.isFinite(h)) return undefined;
  // A panel the list does not hold - an opened file's target, most often. It is
  // still a panel the layout can be designed for.
  return { model, width: w, height: h, formats: ["eote"], viewing: "touch", provisional: true };
}
