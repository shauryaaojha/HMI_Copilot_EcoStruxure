/**
 * Panels the layout can target, for the top bar and the command palette.
 *
 * The list itself lives in `lib/backend/panels.ts` now, with the resolution,
 * the viewing distance and the formats that can write for each one - because
 * the panel is a property of the target, not of this dropdown, and Schneider's
 * first answer was that nothing should be specific to a panel. This module is
 * the option shape the two menus want, built from that one list.
 *
 * The exported file's panel is not one of these - it comes from Target.dat
 * inside the extracted skeleton, which the app cannot change. Choosing one here
 * sets what the layout is designed for; the top bar asks the server what the
 * file will actually say and flags a disagreement rather than showing a label
 * the .eote contradicts.
 */

import { PANELS, panelValue } from "@/lib/backend/panels";

export interface TargetOption {
  value: string;
  label: string;
}

export const TARGETS: TargetOption[] = PANELS.map((panel) => ({
  value: panelValue(panel),
  label: `${panel.model} · ${panel.width} × ${panel.height}`,
}));
