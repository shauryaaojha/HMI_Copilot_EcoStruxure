/**
 * The kinds of equipment a plant brief may contain.
 *
 * One entry per kind, in code, and the source of truth for both paths: the
 * rules read it to draft a brief from a sentence, and the model is given the
 * same list and may not name anything outside it. That is what stops a model
 * inventing a unit the plant does not have - not a sterner prompt, but a
 * vocabulary it cannot step outside of (docs/PLAN_FULL_ARCHITECTURE.md §5.4).
 *
 * These are the nine `draftByRules` already recognised, with the same prefixes
 * and the same signal sets, so a description that produced a tag list before
 * produces the same one through a brief. Widening the catalogue is a later
 * change, and the knowledge base is where the evidence for it will come from.
 *
 * An engineer is not limited to this list: a custom unit can be added to a
 * brief with its signals written out (see `Unit.kind === "custom"` in
 * ./brief.ts). The catalogue binds the model, not the person.
 */

import type { Variable } from "@/lib/ote/schema";

export interface CatalogueSignal {
  /** The suffix in `<PREFIX>_<NNN>_<SIGNAL>`. */
  id: string;
  type: Variable["DataType"];
  /** Goes into the tag's comment, after the unit's label. */
  what: string;
}

export interface Kind {
  id: string;
  label: string;
  /** The tag prefix: PMP_101_RUN. */
  prefix: string;
  /** Everything a unit of this kind may have. A brief picks a subset. */
  signals: CatalogueSignal[];
  /** Picked when the engineer has not said otherwise. */
  defaultSignals: string[];
  /** Of those, the ones that raise an alarm by default. */
  defaultAlarms: string[];
  /** What the rules match in a description. */
  pattern: RegExp;
}

const drive = (): CatalogueSignal[] => [
  { id: "RUN", type: "BOOL", what: "running" },
  { id: "FLT", type: "BOOL", what: "fault" },
  { id: "START", type: "BOOL", what: "start command" },
  { id: "STOP", type: "BOOL", what: "stop command" },
];

const transmitter = (limits: CatalogueSignal[]): CatalogueSignal[] => [
  { id: "PV", type: "REAL", what: "" },
  ...limits,
];

const HI: CatalogueSignal = { id: "HI", type: "BOOL", what: "high" };
const LO: CatalogueSignal = { id: "LO", type: "BOOL", what: "low" };

export const CATALOGUE: readonly Kind[] = [
  {
    id: "pump", label: "Pump", prefix: "PMP", pattern: /\bpumps?\b/i,
    signals: drive(), defaultSignals: ["RUN", "FLT", "START", "STOP"], defaultAlarms: ["FLT"],
  },
  {
    id: "motor", label: "Motor", prefix: "MTR", pattern: /\bmotors?\b/i,
    signals: drive(), defaultSignals: ["RUN", "FLT", "START", "STOP"], defaultAlarms: ["FLT"],
  },
  {
    id: "conveyor", label: "Conveyor", prefix: "CNV", pattern: /\bconveyors?\b/i,
    signals: drive(), defaultSignals: ["RUN", "FLT"], defaultAlarms: ["FLT"],
  },
  {
    id: "fan", label: "Fan", prefix: "FAN", pattern: /\bfans?\b/i,
    signals: drive(), defaultSignals: ["RUN", "FLT"], defaultAlarms: ["FLT"],
  },
  {
    id: "valve", label: "Valve", prefix: "XV", pattern: /\bvalves?\b/i,
    signals: [
      { id: "OPEN", type: "BOOL", what: "open" },
      { id: "CLOSED", type: "BOOL", what: "closed" },
      { id: "FLT", type: "BOOL", what: "fault" },
    ],
    defaultSignals: ["OPEN", "CLOSED", "FLT"], defaultAlarms: ["FLT"],
  },
  {
    id: "tank", label: "Tank level", prefix: "LT", pattern: /\btanks?\b|\bvessels?\b/i,
    signals: transmitter([HI, LO]), defaultSignals: ["PV", "HI", "LO"], defaultAlarms: ["HI", "LO"],
  },
  {
    id: "flow", label: "Flow", prefix: "FT", pattern: /\bflow\b/i,
    signals: transmitter([LO, HI]), defaultSignals: ["PV", "LO"], defaultAlarms: ["LO"],
  },
  {
    id: "pressure", label: "Pressure", prefix: "PT", pattern: /\bpressure\b/i,
    signals: transmitter([HI, LO]), defaultSignals: ["PV", "HI"], defaultAlarms: ["HI"],
  },
  {
    id: "temperature", label: "Temperature", prefix: "TT", pattern: /\btemperature\b|\btemp\b/i,
    signals: transmitter([HI, LO]), defaultSignals: ["PV", "HI"], defaultAlarms: ["HI"],
  },
];

export const KIND_IDS: readonly string[] = CATALOGUE.map((k) => k.id);

export const kindOf = (id: string): Kind | undefined => CATALOGUE.find((k) => k.id === id);

/** The signals a kind allows, for checking a brief row against the catalogue. */
export const signalsOf = (id: string): CatalogueSignal[] => kindOf(id)?.signals ?? [];

/**
 * The catalogue as one line per kind, for the model's prompt.
 *
 * Generated rather than written out again, so a kind added here reaches the
 * model without anybody remembering to update a string.
 */
export function catalogueForPrompt(): string {
  return CATALOGUE.map(
    (k) => `${k.id}: prefix ${k.prefix}, signals ${k.signals.map((s) => `${s.id} (${s.type})`).join(", ")}`,
  ).join("\n");
}
