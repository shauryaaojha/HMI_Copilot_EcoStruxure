/**
 * The Plant Model: what the plant is, as a document the screens are
 * projections of. docs/ARCHITECTURE_SCREEN_QUALITY.md §3.1, REENGINEERING.md §3.
 *
 * Site → Area → Unit → Equipment, each piece of equipment with a class, its
 * tags by role, a range for every reading, and the connections between
 * pieces. Everything carries a confidence and a source, and what the model
 * could not decide is either an assumption it states or a question it asks
 * - at most one question, the one worth asking; the rest are assumptions the
 * engineer can correct in the tree.
 *
 * This is the deterministic modeller: naming conventions and class defaults.
 * The agent (A1 in the architecture) edits the same document with the same
 * schema; nothing downstream knows which one wrote it.
 */

import { z } from "zod";
import type { Variable } from "@/lib/ote/schema";
import { inferEquipment, type InferredEquipment } from "@/lib/ai/infer";
import { rangeFor, type Range } from "./units";
import { measuredByClass } from "./classes";

export const RangeSchema = z.object({
  min: z.number(),
  max: z.number(),
  normalLow: z.number(),
  normalHigh: z.number(),
  units: z.string(),
  source: z.enum(["export", "class", "engineer"]),
  band: z.enum(["stated", "assumed"]).optional(),
});

export const PlantEquipment = z.object({
  id: z.string(),
  /** The class: pump, tank, valve, instrument... the key into the class catalogue. */
  class: z.string(),
  label: z.string(),
  unit: z.string(),
  roles: z.array(z.object({ role: z.string(), tag: z.string(), dataType: z.string() })),
  /** By tag, for every reading. */
  ranges: z.record(RangeSchema),
  symbol: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

export const Connection = z.object({
  from: z.string(),
  to: z.string(),
  confidence: z.number().min(0).max(1),
  source: z.enum(["naming", "engineer", "agent"]),
});

export const PlantUnit = z.object({ id: z.string(), name: z.string(), area: z.string(), equipment: z.array(z.string()) });
export const PlantArea = z.object({ id: z.string(), name: z.string() });

export const Question = z.object({
  id: z.string(),
  text: z.string(),
  /** What the answer decides: a connection into this unit, a class, a range. */
  kind: z.enum(["feeds", "class", "range"]),
  about: z.string(),
  options: z.array(z.string()),
});

export const PlantModel = z.object({
  version: z.literal(1),
  areas: z.array(PlantArea),
  units: z.array(PlantUnit),
  equipment: z.array(PlantEquipment),
  connections: z.array(Connection),
  questions: z.array(Question),
  assumptions: z.array(z.string()),
  /** Question id → the option chosen. Re-modelling with the same answers is stable. */
  answers: z.record(z.string()),
});

export type Range_ = Range;
export type PlantEquipment = z.infer<typeof PlantEquipment>;
export type Connection = z.infer<typeof Connection>;
export type PlantUnit = z.infer<typeof PlantUnit>;
export type Question = z.infer<typeof Question>;
export type PlantModel = z.infer<typeof PlantModel>;

/* ---------------------------------------------------------------------- */
/* Structure from names                                                    */
/* ---------------------------------------------------------------------- */

/** What flows into what, by class: a source feeds a mover feeds a conditioner. */
const STAGE: Record<string, number> = {
  tank: 0, reactor: 0, boiler: 0,
  pump: 1, doser: 1, compressor: 1, fan: 1, conveyor: 1,
  valve: 2, filter: 2, heater: 2, chiller: 2,
  instrument: 3, motor: 3,
};
const stageOf = (cls: string) => STAGE[cls] ?? 3;

const AREA_NAME: Record<string, string> = {
  tank: "Storage", reactor: "Reaction", boiler: "Boiler house", pump: "Pumping",
  compressor: "Compressed air", fan: "Ventilation", chiller: "Cooling", heater: "Heating",
  filter: "Filtration", conveyor: "Conveying", valve: "Valves", instrument: "Instruments", motor: "Drives",
};

/** The hundreds of a loop number: PMP_101 and TNK_104 are one unit, PMP_201 another. */
function unitKeyOf(unit: InferredEquipment): string {
  const loop = unit.loop?.match(/^(\d+)/)?.[1];
  if (!loop) return "general";
  const n = Number(loop);
  if (n >= 100) return `${Math.floor(n / 100)}xx`;
  return `${Math.floor(n / 10)}x`;
}

/** A tag that carries a number, as opposed to a state or a string. */
export const isReading = (dataType: string) => dataType !== "BOOL" && dataType !== "STRING";

/**
 * Confidence in an inference: a machine prefix with a loop number is a
 * convention; a bare prefix is a guess; an instrument nobody claimed is a
 * leftover.
 */
function confidenceOf(unit: InferredEquipment): number {
  if (unit.kind === "instrument") return unit.loop ? 0.5 : 0.35;
  return unit.loop ? 0.9 : 0.7;
}

export function modelPlant(variables: Variable[], answers: Record<string, string> = {}): PlantModel {
  const inferred = inferEquipment(variables);
  const assumptions: string[] = [];

  // --- equipment -----------------------------------------------------------
  const refined: string[] = [];
  const equipment: PlantEquipment[] = inferred.map((unit) => {
    // A bare process variable says nothing about what it measures; the class
    // does. VLV_202_PV is a valve's position, TNK_101_PV is a tank's level.
    // Read as the generic "value" both end up on a screen labelled "Value"
    // with no unit, which is the defect the critic caught on the pumps.
    const measured = measuredByClass(unit.kind);
    const roles = unit.roles.map((r) => {
      if (r.role !== "value" || !measured || !isReading(r.dataType)) return r;
      refined.push(`${r.tag} as a ${measured}`);
      return { ...r, role: measured };
    });

    const ranges: Record<string, Range> = {};
    for (const r of roles) {
      if (!isReading(r.dataType)) continue;
      ranges[r.tag] = rangeFor(r.comment, r.role);
    }
    return {
      id: unit.id,
      class: unit.kind,
      label: unit.label,
      unit: unitKeyOf(unit),
      roles: roles.map((r) => ({ role: r.role, tag: r.tag, dataType: r.dataType })),
      ranges,
      symbol: unit.symbol,
      confidence: confidenceOf(unit),
    };
  });
  if (refined.length > 0) {
    assumptions.push(
      `${refined.length} process variable${refined.length === 1 ? "" : "s"} read by equipment class because the name says only "PV": ${refined.slice(0, 4).join(", ")}${refined.length > 4 ? ", …" : ""}`,
    );
  }

  const classDefaults = equipment.flatMap((e) => Object.entries(e.ranges).filter(([, r]) => r.source === "class").map(([tag]) => tag));
  if (classDefaults.length > 0) {
    assumptions.push(
      `${classDefaults.length} reading${classDefaults.length === 1 ? "" : "s"} use class-default ranges because the export states none: ${classDefaults.slice(0, 4).join(", ")}${classDefaults.length > 4 ? ", …" : ""}`,
    );
  }
  // An export that states a range still never states the normal band, so a
  // range "from the export" carries a band nobody gave. Said once, here, so
  // the engineer does not read "export" on the Plant page as "all of it".
  const assumedBands = equipment.flatMap((e) => Object.entries(e.ranges).filter(([, r]) => r.source === "export" && r.band === "assumed").map(([tag]) => tag));
  if (assumedBands.length > 0) {
    assumptions.push(
      `${assumedBands.length} reading${assumedBands.length === 1 ? " has" : "s have"} a range from the export but an assumed normal band (20-90% of the span): ${assumedBands.slice(0, 4).join(", ")}${assumedBands.length > 4 ? ", …" : ""}`,
    );
  }

  // --- units and areas -------------------------------------------------------
  const unitIds = [...new Set(equipment.map((e) => e.unit))].sort();
  const units: PlantUnit[] = unitIds.map((id) => {
    const members = equipment.filter((e) => e.unit === id);
    const dominant = [...members].sort((a, b) => stageOf(a.class) - stageOf(b.class))[0]?.class ?? "instrument";
    const name = id === "general" ? "General" : `${AREA_NAME[dominant] ?? dominant} ${id}`;
    return { id, name, area: id === "general" ? "general" : `area-${id}`, equipment: members.map((e) => e.id) };
  });
  const areas = units.map((u) => ({ id: u.area, name: u.name.replace(/ \d+xx?$/, "") }));

  // --- connections from names ----------------------------------------------------
  const connections: Connection[] = [];
  const connect = (from: string, to: string, confidence: number, source: Connection["source"]) => {
    if (from === to || connections.some((c) => c.from === from && c.to === to)) return;
    connections.push({ from, to, confidence, source });
  };
  for (const unit of units) {
    const members = unit.equipment.map((id) => equipment.find((e) => e.id === id)!);
    const byStage = (n: number) => members.filter((m) => stageOf(m.class) === n);
    for (const source of byStage(0)) for (const mover of byStage(1)) connect(source.id, mover.id, 0.6, "naming");
    for (const mover of byStage(1)) for (const cond of byStage(2)) connect(mover.id, cond.id, 0.5, "naming");
    // No mover: sources feed conditioners directly (a tank with an outlet valve).
    if (byStage(1).length === 0) for (const source of byStage(0)) for (const cond of byStage(2)) connect(source.id, cond.id, 0.5, "naming");
  }
  // The same loop number is a stronger tie than the same hundred.
  for (const c of connections) {
    const a = inferred.find((u) => u.id === c.from)?.loop;
    const b = inferred.find((u) => u.id === c.to)?.loop;
    if (a && a === b) c.confidence = Math.max(c.confidence, 0.8);
  }

  // --- the one question ------------------------------------------------------------
  const questions: Question[] = [];
  const sources = equipment.filter((e) => stageOf(e.class) === 0);
  for (const unit of units) {
    const members = unit.equipment.map((id) => equipment.find((e) => e.id === id)!);
    const movers = members.filter((m) => stageOf(m.class) === 1);
    const hasSource = members.some((m) => stageOf(m.class) === 0);
    if (movers.length === 0 || hasSource) continue;
    const options = sources.filter((s) => s.unit !== unit.id).map((s) => s.id);
    if (options.length === 0) continue;
    const id = `feeds:${unit.id}`;
    const answer = answers[id];
    if (answer && options.includes(answer)) {
      for (const mover of movers) connect(answer, mover.id, 1, "engineer");
      continue;
    }
    if (questions.length === 0) {
      questions.push({
        id,
        text: `What feeds the ${movers.length === 1 ? movers[0].label : `${movers.length} ${movers[0].class}s`} in ${unit.name}?`,
        kind: "feeds",
        about: unit.id,
        options,
      });
    } else {
      assumptions.push(`${unit.name} has no source in its own loop range; nothing is drawn feeding it until you say what does.`);
    }
  }

  return { version: 1, areas, units, equipment, connections, questions, assumptions, answers };
}

/* ---------------------------------------------------------------------- */
/* Reading the model                                                       */
/* ---------------------------------------------------------------------- */

/** Every tag the model has a role for. */
export function coveredTags(model: PlantModel): Set<string> {
  return new Set(model.equipment.flatMap((e) => e.roles.map((r) => r.tag)));
}

/** True when no chain of connections comes back on itself. */
export function isAcyclic(model: PlantModel): boolean {
  const out = new Map<string, string[]>();
  for (const c of model.connections) out.set(c.from, [...(out.get(c.from) ?? []), c.to]);
  const state = new Map<string, 1 | 2>();
  const visit = (n: string): boolean => {
    const s = state.get(n);
    if (s === 1) return false;
    if (s === 2) return true;
    state.set(n, 1);
    for (const m of out.get(n) ?? []) if (!visit(m)) return false;
    state.set(n, 2);
    return true;
  };
  return model.equipment.every((e) => visit(e.id));
}

/** The range for a tag, whichever piece of equipment holds it. */
export function rangeOf(model: PlantModel | undefined, tag: string): Range | undefined {
  if (!model) return undefined;
  for (const e of model.equipment) if (e.ranges[tag]) return e.ranges[tag];
  return undefined;
}
