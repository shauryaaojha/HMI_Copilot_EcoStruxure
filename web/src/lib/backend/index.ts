/**
 * The format registry. Adding a format is a module and a row here.
 *
 * Node-safe only: the OTE backend reaches the packager, which loads sql.js.
 * The browser imports `./types` and `./panels`, which are data and pure
 * functions, never this file.
 */

import type { Backend, FormatId } from "./types";
import { OTE } from "./ote";
import { VIJEO } from "./vijeo";

export const BACKENDS: readonly Backend[] = [OTE, VIJEO];

export const DEFAULT_FORMAT: FormatId = "eote";

export function backendFor(format: FormatId = DEFAULT_FORMAT): Backend {
  const found = BACKENDS.find((b) => b.id === format);
  if (!found) throw new Error(`no backend for format "${format}"`);
  return found;
}

/** The formats that can actually write today, for a format picker. */
export const writableFormats = (): readonly Backend[] => BACKENDS.filter((b) => !b.unavailable);

export { OTE, VIJEO };
export * from "./types";
export * from "./panels";
