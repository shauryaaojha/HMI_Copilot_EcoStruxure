/**
 * EcoStruxure Operator Terminal Expert 4.4, behind the format seam.
 *
 * Nothing here is new. It is the packager and the reader we already have,
 * declared as a backend so that they are one implementation of an interface
 * rather than the only way the tool can write. The capabilities are facts read
 * out of the installation and the round trip, not a guess: `provisional` is
 * false, which is what earns it the right to write a file.
 */

import { PART_TYPES } from "@/lib/ote/schema";
import { packageProject } from "@/lib/ote/packager";
import { readProject } from "@/lib/ote/reader";
import type { Backend, Capabilities } from "./types";

/**
 * Colour is a palette index because that is the only kind of colour the
 * product's file can hold (lib/ote/palette.ts). Composites are ours, not the
 * file's, until `.co` compound objects land - which is why `nativeComposites`
 * is false and an opened project's indicators come back as grouped parts.
 */
const capabilities: Capabilities = {
  parts: PART_TYPES,
  colour: "palette",
  nativeComposites: false,
  masterScreens: false,
  folders: false,
  // Verified against the product's own reserved-word and length rules in
  // lib/validation/naming.ts.
  maxNameLength: 32,
  provisional: false,
};

export const OTE: Backend = {
  id: "eote",
  name: "EcoStruxure Operator Terminal Expert 4.4",
  extension: ".eote",
  capabilities,
  write: (input, preserved) => packageProject(input, undefined, preserved),
  read: (bytes) => readProject(bytes),
};
