/**
 * Compile one screen again, alone, from its recipe.
 *
 * The same stages the pipeline runs for a whole application (lib/ai/pipeline
 * .ts): the Plant Model and the equipment from the tags as they are now, the
 * shipped symbols, then compileProgram with a fresh Placer. What comes back is
 * a FreshScreen - parts keyed by the names the compiler asked for - for
 * lib/program/regenerate.ts to diff against the screen as it stands.
 *
 * No model is called. A screen's recipe was decided when it was planned; a
 * regeneration recompiles that decision against changed inputs (new tags, a
 * corrected range on the Plant page, a widened machine library) and lets the
 * engineer see the difference. Asking a model again would change the screen
 * for no reason anyone could review.
 *
 * Node only: symbolsFor reads the local graphics index.
 */

import { inferEquipment, type StructureHint } from "@/lib/ai/infer";
import { modelPlant, type PlantModel } from "@/lib/plant/model";
import { architectPrograms, ScreenProgram } from "@/lib/program/program";
import { compileProgram, specOf } from "@/lib/program/compile";
import { Placer, type LayoutUnit, type ScreenSpec } from "@/lib/ote/layout";
import { symbolsFor } from "@/lib/ote/symbols";
import type { Variable } from "@/lib/ote/schema";
import type { FreshScreen } from "./regenerate";

export interface RecompileInput {
  /** The screen being regenerated. */
  screenName: string;
  /** Its recipe, when it has one. */
  program?: ScreenProgram;
  /** Part names and types on it now, to reconstruct a recipe when it has none. */
  parts?: { name: string; type: string }[];
  /** Every screen in the application, for the navigation strip. */
  screens: { name: string; program?: ScreenProgram }[];
  variables: Variable[];
  structure?: StructureHint[];
  panel: { width: number; height: number };
  /** The engineer's corrected Plant Model, when there is one. */
  plant?: PlantModel;
}

export interface RecompileResult {
  fresh: FreshScreen;
  program: ScreenProgram;
  /** Set when the recipe had to be inferred from what is on the screen. */
  reconstructed: boolean;
}

const cardKey = (id: string) => id.replace(/[^A-Za-z0-9]/g, "");

/**
 * A recipe for a screen generated before recipes were kept: a process view by
 * its name, otherwise the units whose faceplates it carries (Card_, Tile_,
 * Detail_), at the level those faceplates imply, with the alarm banner if it
 * has one.
 */
export function reconstructProgram(
  screenName: string,
  parts: { name: string; type: string }[],
  plant: PlantModel,
  unitIds: string[],
): ScreenProgram | null {
  const process = architectPrograms(plant).find((p) => p.name.toLowerCase() === screenName.toLowerCase());
  if (process) return process;
  const names = new Set(parts.map((p) => p.name));
  const has = (prefix: string, id: string) => [...names].some((n) => n === `${prefix}_${cardKey(id)}` || n.startsWith(`${prefix}_${cardKey(id)}_`));
  const tiles = unitIds.filter((id) => has("Tile", id));
  const cards = unitIds.filter((id) => has("Card", id) || has("Detail", id));
  const include = tiles.length > cards.length ? tiles : cards;
  if (include.length === 0) return null;
  const level = tiles.length > cards.length ? 1 : unitIds.some((id) => has("Detail", id)) ? 3 : 2;
  const sections: ("status" | "process" | "alarms")[] = ["status"];
  if (parts.some((p) => p.name.includes("_Val") || p.type === "NumericDisplay")) sections.push("process");
  if (parts.some((p) => p.type === "AlarmSummary")) sections.push("alarms");
  return {
    name: screenName,
    title: screenName,
    level: level as 1 | 2 | 3,
    kpis: [],
    faceplates: include,
    sections,
    rationale: "reconstructed from the faceplates on the screen",
  };
}

export async function recompileScreen(input: RecompileInput): Promise<RecompileResult> {
  const plant = input.plant ?? modelPlant(input.variables, {}, input.structure);
  const roleOf = new Map(plant.equipment.flatMap((e) => e.roles.map((r) => [r.tag, r.role] as const)));
  const equipment = inferEquipment(input.variables, input.structure).map((unit) => ({
    ...unit,
    roles: unit.roles.map((r) => ({ ...r, role: roleOf.get(r.tag) ?? r.role })),
  }));

  let program = input.program ? ScreenProgram.parse(input.program) : undefined;
  let reconstructed = false;
  if (!program) {
    const rebuilt = reconstructProgram(input.screenName, input.parts ?? [], plant, equipment.map((u) => u.id));
    if (!rebuilt) {
      throw new Error(
        `${input.screenName} has no recipe and carries no generated faceplates, so there is nothing to regenerate it from. ` +
          "It was drawn by hand or imported; edit it directly.",
      );
    }
    program = rebuilt;
    reconstructed = true;
  }

  const graphics = await symbolsFor(equipment.map((u) => u.symbol));
  const drawn: LayoutUnit[] = equipment.map((unit) => ({
    ...unit,
    graphic: unit.symbol ? graphics.get(unit.symbol) : undefined,
    ranges: plant.equipment.find((e) => e.id === unit.id)?.ranges,
  }));
  const navigation: ScreenSpec[] = input.screens.map((s) =>
    s.name === input.screenName
      ? specOf(program!)
      : s.program
        ? specOf(ScreenProgram.parse(s.program))
        : { screenName: s.name, title: s.name, level: 2, include: [], sections: [] },
  );

  const laid = compileProgram(program, plant, input.panel, navigation, graphics, new Placer(), drawn);
  const keys = laid.keys ?? {};
  const keyOf = (id: string, name: string) => keys[id] ?? name;
  const fresh: FreshScreen = {
    parts: laid.parts,
    keys: Object.fromEntries(laid.parts.map((p) => [p.UniqueId, keyOf(p.UniqueId, p.Name)])),
    wires: laid.wires.map((w) => ({
      key: keyOf(w.part.UniqueId, w.part.Name),
      tag: w.tag,
      property: w.property,
      ...(w.converter ? { converter: w.converter } : {}),
    })),
    composites: laid.composites.map((c) => ({
      kind: c.kind,
      name: c.name,
      props: c.props,
      partKeys: c.partIds.map((id) => keyOf(id, laid.parts.find((p) => p.UniqueId === id)?.Name ?? id)),
    })),
    notes: laid.notes ?? [],
  };
  return { fresh, program, reconstructed };
}
