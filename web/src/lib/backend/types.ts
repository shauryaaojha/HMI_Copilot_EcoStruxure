/**
 * The format seam. docs/PLAN_PHASE4.md §7, and the thing Schneider asked for
 * in answer 6: *"it would be beneficial if the solution is developed in a way
 * that allows it to be easily adapted for Vijeo Designer as well."*
 *
 * Everything above this line - tag inference, the Plant Model, the Screen
 * Program, the standard pack, the critic - is about what a good screen is, and
 * none of it knows what file the screen ends up in. Everything below is one
 * product's file format. A backend is the join, and adding a format means
 * writing one module and registering it.
 *
 * Two things live here that used to be assumed:
 *
 * - **Capabilities.** The canvas may only draw what the target can write. That
 *   rule was true of OTE by construction; with two formats it has to be asked
 *   rather than assumed, so a backend declares its part types and the lint
 *   reports a screen that uses one the target has never heard of.
 * - **Panels.** The panel was a constant in four places. It is now a profile
 *   with the formats that can target it, because Schneider's first answer was
 *   that the solution must not be specific to any panel.
 */

import type { PartType, Screen } from "@/lib/ote/schema";
import type { PackageInput } from "@/lib/ote/packager";
import type { ReadProject } from "@/lib/ote/reader";

export type FormatId = "eote" | "vijeo";

/**
 * What a format can hold. Everything here is something the generator or the
 * lint has to behave differently about - not a feature list for a brochure.
 */
export interface Capabilities {
  /** The part types the writer can emit. A screen may contain nothing else. */
  parts: readonly PartType[];
  /** Colour is an index into the project's colour set, or a direct value. */
  colour: "palette" | "rgb";
  /** Composites can be written as one object rather than as grouped parts. */
  nativeComposites: boolean;
  /** The frame can live on a master screen instead of on every screen. */
  masterScreens: boolean;
  /** Screens can be organised in folders. */
  folders: boolean;
  /** Longest screen or variable name the format accepts. */
  maxNameLength: number;
  /**
   * True while these values are read from a product's documentation rather
   * than from a file we have opened. A provisional backend may not write:
   * guessing at a format produces a file that opens and is wrong, which is
   * worse than no file.
   */
  provisional: boolean;
}

/** A panel the layout can be designed for, and the formats that can target it. */
export interface PanelProfile {
  model: string;
  width: number;
  height: number;
  /** Which formats can write a project for this panel. */
  formats: readonly FormatId[];
  /** Where it is mounted, which sets the font floor. */
  viewing: "touch" | "controlRoom";
  /** Set when the pairing above comes from a product page rather than a file. */
  provisional?: boolean;
}

export interface Backend {
  id: FormatId;
  /** What an engineer calls it. */
  name: string;
  /** The extension a written project carries, with its dot. */
  extension: string;
  capabilities: Capabilities;
  /**
   * Why this backend cannot write today, in a sentence an engineer can act on.
   * Undefined when it can.
   */
  unavailable?: string;
  write(input: PackageInput, preserved?: ReadProject["preserved"]): Promise<Uint8Array>;
  /** Present when the format can be opened as well as written. */
  read?(bytes: Uint8Array): Promise<ReadProject>;
}

/**
 * Parts on these screens that the target cannot write, by part type. The
 * generator asks this before it places anything, and the lint reports it
 * against the object so the engineer can see which one.
 */
export function unsupportedParts(
  screens: Screen[],
  backend: Backend,
): { screen: string; name: string; objectId: string; type: PartType }[] {
  const can = new Set<PartType>(backend.capabilities.parts);
  return screens.flatMap((screen) =>
    screen.Children[0].Children.filter((p) => !can.has(p.Type)).map((p) => ({
      screen: screen.Name,
      name: p.Name,
      objectId: p.UniqueId,
      type: p.Type,
    })),
  );
}
