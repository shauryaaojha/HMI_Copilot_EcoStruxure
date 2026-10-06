/**
 * Equipment inference from tag names.
 *
 * Deterministic and offline by design. Tag names follow ISA-5.1, so the
 * structure is genuinely there to be read: PMP_101_RUN, PMP_101_FLT and
 * FT_101_PV share loop 101 and therefore describe one pump and its
 * instrumentation. That is a parse, not a guess, and it must not depend on a
 * network call - if the model is unreachable mid-demo the screen still builds.
 *
 * Claude's job is the part this cannot do: reading the engineer's sentence and
 * deciding what to show. See plan.ts.
 *
 * Phase 4 of docs/BUILD_PLAN.md.
 */

import type { Variable } from "@/lib/ote/schema";
import type { Equipment } from "@/types/events";
import { classify, machineClass, MACHINE_CLASSES, roleIn } from "@/lib/library/machines";

/**
 * A DDT instance as the tag import reported it (lib/tags/controlExpert.ts):
 * equipment the PLC's type system declares, with the OTE variable each member
 * became. Optional everywhere - a flat CSV has none, and then inference is
 * exactly the name parse it always was.
 */
export interface StructureHint {
  instance: string;
  ddt: string;
  comment?: string;
  members: { path: string; variable: string }[];
}

/** ISA-5.1 first letter -> what is measured. */
const MEASURED: Record<string, string> = {
  F: "flow",
  L: "level",
  P: "pressure",
  T: "temperature",
  A: "analysis",
  S: "speed",
};

/** Equipment prefixes that name a machine rather than an instrument. */
const MACHINES: Record<string, { kind: string; symbol: string }> = {
  PMP: { kind: "pump", symbol: "Pumps/Pump01" },
  PUMP: { kind: "pump", symbol: "Pumps/Pump01" },
  P: { kind: "pump", symbol: "Pumps/Pump01" },
  MTR: { kind: "motor", symbol: "General/Motor01" },
  MOT: { kind: "motor", symbol: "General/Motor01" },
  FAN: { kind: "fan", symbol: "Fans/Fan01" },
  VLV: { kind: "valve", symbol: "Valves/Valve01" },
  VAL: { kind: "valve", symbol: "Valves/Valve01" },
  TNK: { kind: "tank", symbol: "Tanks/Tank01" },
  TK: { kind: "tank", symbol: "Tanks/Tank01" },
  CMP: { kind: "compressor", symbol: "Air Compressors/AirCompressor01" },
  // A chiller and an air compressor are both CMP to a naming convention that
  // has not thought about it, and a screen that calls one the other is wrong
  // in a way an operator notices. The shipped library has no chiller, so an
  // air conditioner is the honest match.
  CHL: { kind: "chiller", symbol: "Air Conditioners/AirConditioner01" },
  CH: { kind: "chiller", symbol: "Air Conditioners/AirConditioner01" },
  // A boiler is a fired heater and the shipped library has no boiler, so
  // Heater01 is the honest match rather than a tank that looks nothing like one.
  BLR: { kind: "boiler", symbol: "General/Heater01" },
  BOILER: { kind: "boiler", symbol: "General/Heater01" },
  HTR: { kind: "heater", symbol: "General/Heater01" },
  FIL: { kind: "filter", symbol: "General/Filter" },
  FLTR: { kind: "filter", symbol: "General/Filter" },
  CNV: { kind: "conveyor", symbol: "General/Conveyor01" },
  CONV: { kind: "conveyor", symbol: "General/Conveyor01" },
  RCT: { kind: "reactor", symbol: "Tanks/Tank01" },
  REA: { kind: "reactor", symbol: "Tanks/Tank01" },
  DOS: { kind: "doser", symbol: "Pumps/Pump01" },
};

/**
 * Machine prefixes the library knows and the table above does not: MIX, AGT,
 * HEX, AHU, CNC... Only prefixes of three letters or more that cannot be read
 * as an ISA-5.1 instrument code (FIT, LIC, TSH) are taken, so the library
 * widens what is recognised without changing how any existing tag is read.
 */
const ISA_LIKE = /^[FLPTAS](I?T|IC|I|S[HL]{1,2})$/;
const LIBRARY_PREFIXES: Record<string, { kind: string; symbol?: string }> = {};
for (const c of MACHINE_CLASSES) {
  for (const p of c.prefixes) {
    if (p.length < 3 || ISA_LIKE.test(p) || MACHINES[p] || LIBRARY_PREFIXES[p]) continue;
    LIBRARY_PREFIXES[p] = { kind: c.id, symbol: c.symbol };
  }
}
const machineFor = (prefix: string): { kind: string; symbol?: string } | undefined => MACHINES[prefix] ?? LIBRARY_PREFIXES[prefix];

/** Role suffixes, longest first so _FAULT wins over _F. */
const ROLES: [RegExp, string][] = [
  [/_(RUN|RUNNING|ON)$/i, "running"],
  [/_(FLT|FAULT|TRIP|ALM|ALARM)$/i, "fault"],
  [/_(CMD|START|STOP)$/i, "command"],
  [/_(SPD|SPEED)$/i, "speed"],
  [/_(PV|VALUE|VAL)$/i, "value"],
  // What a tag measures, when the name says so rather than an instrument
  // prefix: TNK_101_LEVEL is a level, PMP_102_HRS is running hours.
  [/_(LEVEL|LVL)$/i, "level"],
  [/_(FLOW|FLW)$/i, "flow"],
  [/_(PRESSURE|PRESS|PRES|PRS)$/i, "pressure"],
  [/_(TEMPERATURE|TEMP|TMP)$/i, "temperature"],
  [/_(VOL|VOLUME)$/i, "volume"],
  [/_(HRS|HOURS|RUNTIME)$/i, "hours"],
  [/_(CUR|CURRENT|AMPS)$/i, "current"],
  [/_(POS|POSITION)$/i, "position"],
  [/_(SP|SETPOINT)$/i, "setpoint"],
  [/_(HI|HIGH|HH)$/i, "high"],
  [/_(LO|LOW|LL)$/i, "low"],
  // Everything below was found by lib/critic/coverage.ts, which reads every
  // sample's tag list and reports a trailing word the table does not know.
  // Each of these was silently being read as a plain value, which is how a
  // valve's open limit ends up on a screen as "Value" with a 0-100 range.
  // --- states a machine reports (BOOL) ---
  [/_(OPENED|OPEN)$/i, "open"],
  [/_(CLOSED|CLOSE|SHUT)$/i, "closed"],
  [/_(AVAILABLE|AVAIL)$/i, "available"],
  [/_(READY)$/i, "ready"],
  [/_(HEALTHY|HEALTH)$/i, "healthy"],
  [/_(OCCUPIED|OCC)$/i, "occupied"],
  [/_(ACTIVE|ENABLED)$/i, "active"],
  [/_(FLAME)$/i, "flame"],
  // --- abnormal conditions: a fault by any other name raises an alarm ---
  [/_(ESTOP|EMERGENCYSTOP|EMSTOP)$/i, "estop"],
  [/_(JAMMED|JAM)$/i, "fault"],
  [/_(LOCKOUT|LOCKED)$/i, "fault"],
  // --- what a sequence or a selector is on (INT) ---
  [/_(MODE)$/i, "mode"],
  [/_(STEP|PHASE)$/i, "step"],
  [/_(ID|CIRCUIT|LEAD|SELECTED|SEL)$/i, "selection"],
  // --- counted and computed numbers ---
  [/_(REJECTS|REJECT|COUNT|CNT)$/i, "count"],
  [/_(TOTALISER|TOTALIZER|TOTAL)$/i, "total"],
  [/_(RATE)$/i, "rate"],
  [/_(EFFICIENCY|OEE|EFF)$/i, "efficiency"],
  [/_(FREQUENCY|FREQ|HZ)$/i, "frequency"],
  [/_(POWER|KW)$/i, "power"],
  [/_(FACTOR|PF)$/i, "factor"],
  [/_(MODULATION|MOD)$/i, "modulation"],
];

export interface TaggedRole {
  tag: string;
  role: string;
  dataType: Variable["DataType"];
  comment: string;
}

export interface InferredEquipment extends Equipment {
  /** The loop number the tags share, when they share one. */
  loop?: string;
  roles: TaggedRole[];
  /** The DDT this unit was declared as, when the tag import carried types. */
  ddt?: string;
  /** How sure the classification is, 0..1, and why (lib/library/machines.ts). */
  confidence?: number;
  evidence?: string[];
}

/**
 * Whether the role table recognised this name, as opposed to falling through
 * to "value". A tag that ends in a word nobody taught us is the defect the
 * critic caught as "two tags are not recognised", and the coverage rule in
 * lib/critic/coverage.ts reads this to catch the next one for nothing.
 */
export function roleMatched(name: string): boolean {
  return ROLES.some(([pattern]) => pattern.test(name));
}

function roleOf(name: string): string {
  for (const [pattern, role] of ROLES) {
    if (pattern.test(name)) return role;
  }
  return "value";
}

/**
 * Splits PMP_101_RUN into its prefix, loop and role. Returns null for a name
 * that carries no loop number, which is common in small machines and simply
 * means the tag groups by prefix alone.
 */
function split(name: string): { prefix: string; loop?: string } {
  const parts = name.split("_");
  // PMP101_RUN: the loop glued to the prefix is as common as PMP_101_RUN in
  // older panels. Read it as the same thing rather than as a prefix "PMP101"
  // nobody recognises.
  const glued = parts[0].match(/^([A-Za-z]{2,})(\d+[A-Za-z]?)$/);
  if (glued && (machineFor(glued[1].toUpperCase()) || MEASURED[glued[1][0].toUpperCase()])) {
    return { prefix: glued[1].toUpperCase(), loop: glued[2] };
  }
  if (parts.length === 1) return { prefix: parts[0] };
  const loop = parts.find((p) => /^\d+[A-Z]?$/i.test(p));
  return { prefix: parts[0].toUpperCase(), loop };
}

/** Role names the rest of the pipeline understands: the table's, plus "value". */
const KNOWN_ROLES = new Set([...ROLES.map(([, role]) => role), "value"]);

/**
 * A tag's role, with the class's own spellings as the fallback when the
 * suffix table says only "value": PMP_101_StartCmd is a command on a pump even
 * though no generic table lists STARTCMD. Only roles the pipeline already
 * knows are taken, so a library role never reaches a layout that has no slot
 * for it.
 */
function roleFor(name: string, klass?: string, memberPath?: string): string {
  const generic = roleOf(name);
  if (generic !== "value" || !klass) return generic;
  const c = machineClass(klass);
  const spec = c ? (roleIn(c, memberPath ?? name) ?? roleIn(c, name)) : null;
  return spec && KNOWN_ROLES.has(spec.role) ? spec.role : generic;
}

function label(kind: string, prefix: string, loop?: string): string {
  const name = kind === "instrument" ? prefix : kind[0].toUpperCase() + kind.slice(1);
  return loop ? `${name} ${loop}` : name;
}

/**
 * Groups variables into equipment.
 *
 * A machine prefix and a loop number make a unit; instruments that share that
 * loop are folded into it, because FT_101_PV measures what PMP_101 does.
 * Anything left over is grouped by prefix so nothing is silently dropped.
 */
export function inferEquipment(variables: Variable[], structure: StructureHint[] = []): InferredEquipment[] {
  const units = new Map<string, InferredEquipment>();

  // --- declared equipment first ---------------------------------------------
  // A DDT instance is one unit by construction, whatever its tags are called.
  // Its class comes from the type name, the member names and the comment,
  // scored by the library; the name parse below never sees its tags.
  const byName = new Map(variables.map((v) => [v.Name, v]));
  const claimed = new Set<string>();
  for (const s of structure) {
    const members = s.members.filter((m) => byName.has(m.variable));
    if (members.length === 0) continue;
    const [best] = classify({ name: s.instance, typeName: s.ddt, members: members.map((m) => m.path), comments: s.comment ? [s.comment] : [] });
    const klass = best && best.confidence >= 0.5 ? machineClass(best.classId) : undefined;
    const { prefix, loop } = split(s.instance);
    const number = loop ?? s.instance.match(/(\d+)/)?.[1];
    const kind = klass?.id ?? "instrument";
    const unit: InferredEquipment = {
      id: s.instance,
      kind,
      label: klass ? label(kind, prefix, number) : s.instance,
      tags: [],
      symbol: klass?.symbol,
      loop: number,
      roles: [],
      ddt: s.ddt,
      ...(best ? { confidence: best.confidence, evidence: best.evidence } : {}),
    };
    for (const m of members) {
      const v = byName.get(m.variable)!;
      unit.tags.push(v.Name);
      unit.roles.push({ tag: v.Name, role: roleFor(v.Name, klass?.id, m.path), dataType: v.DataType, comment: v.Comments });
      claimed.add(v.Name);
    }
    units.set(unit.id, unit);
  }

  const put = (key: string, kind: string, prefix: string, loop: string | undefined, tag: TaggedRole, symbol?: string) => {
    let unit = units.get(key);
    if (!unit) {
      unit = {
        id: key,
        kind,
        label: label(kind, prefix, loop),
        tags: [],
        symbol,
        loop,
        roles: [],
      };
      units.set(key, unit);
    }
    // A machine claiming a loop upgrades a group that started as instruments.
    if (symbol && !unit.symbol) {
      unit.symbol = symbol;
      unit.kind = kind;
      unit.label = label(kind, prefix, loop);
    }
    unit.tags.push(tag.tag);
    unit.roles.push(tag);
  };

  for (const variable of variables) {
    if (claimed.has(variable.Name)) continue;
    const { prefix, loop } = split(variable.Name);
    const machine = machineFor(prefix);
    const tagged: TaggedRole = {
      tag: variable.Name,
      role: roleFor(variable.Name, machine?.kind),
      dataType: variable.DataType,
      comment: variable.Comments,
    };

    if (machine && loop) {
      put(`${prefix}_${loop}`, machine.kind, prefix, loop, tagged, machine.symbol);
      continue;
    }
    if (machine) {
      put(prefix, machine.kind, prefix, undefined, tagged, machine.symbol);
      continue;
    }

    // An instrument: FT, LT, PT... Fold it into whatever owns its loop.
    const measured = MEASURED[prefix[0]];
    if (measured && loop && prefix.length <= 3) {
      // What the instrument measures only names the role when the suffix does
      // not already say something more specific. LT_101_HI is a high-level
      // switch, not a level reading - overwriting its role with "level" loses
      // the alarm it should raise, and our own validator would then flag the
      // gap we created.
      const role = tagged.role === "value" ? measured : tagged.role;
      const owner = [...units.keys()].find((k) => k.endsWith(`_${loop}`) && !units.get(k)!.ddt);
      if (owner) {
        const unit = units.get(owner)!;
        unit.tags.push(tagged.tag);
        unit.roles.push({ ...tagged, role });
        continue;
      }
      put(`${prefix}_${loop}`, "instrument", prefix, loop, { ...tagged, role });
      continue;
    }

    put(prefix, "instrument", prefix, loop, tagged);
  }

  // A second pass, because an instrument may have been seen before its machine.
  for (const [key, unit] of units) {
    if (unit.kind !== "instrument" || !unit.loop || unit.ddt) continue;
    const owner = [...units.values()].find(
      (u) => u !== unit && u.loop === unit.loop && u.kind !== "instrument" && !u.ddt,
    );
    if (owner) {
      owner.tags.push(...unit.tags);
      owner.roles.push(...unit.roles);
      units.delete(key);
    }
  }

  return [...units.values()];
}

/** Where a threshold alarm sits, as a share of the reading's range. */
export const LEVEL_ALARM_SHARE = { hi: 0.85, hihi: 0.95 } as const;

/**
 * Which tags deserve an alarm, and of what kind - as a proposal.
 *
 * This is not alarm configuration. Rationalisation (priority by consequence,
 * deadband, on-delay, shelving, operator response) is an engineering decision
 * the tag list cannot make, so every alarm here is a starting point the
 * engineer confirms. What it can get right is the arithmetic: a level alarm
 * sits at 85% and 95% of the reading's *range*, in the reading's own units,
 * not at the numbers 85 and 95 - which on a level read in metres, 0-6 m,
 * would be thresholds the value can never reach.
 */
export function proposeAlarms(
  equipment: InferredEquipment[],
  rangeOf: (tag: string) => { min: number; max: number } | undefined = () => undefined,
) {
  const proposals: {
    trigger: string;
    message: string;
    kind: "bit" | "level";
    level: 1 | 2;
    severity: number;
    value: string;
  }[] = [];

  for (const unit of equipment) {
    for (const role of unit.roles) {
      if (role.role === "fault" && role.dataType === "BOOL") {
        proposals.push({
          trigger: role.tag,
          message: role.comment || `${unit.label} fault`,
          kind: "bit",
          level: 1,
          severity: 5,
          value: "0",
        });
      }
      if (role.role === "high" && role.dataType === "BOOL") {
        proposals.push({
          trigger: role.tag,
          message: role.comment || `${unit.label} high`,
          kind: "bit",
          level: 1,
          severity: 3,
          value: "0",
        });
      }
      // A level reading gets the pair a tank always has: warn, then act.
      if (role.role === "level" && role.dataType !== "BOOL") {
        const range = rangeOf(role.tag) ?? { min: 0, max: 100 };
        const at = (share: number) => threshold(range.min + (range.max - range.min) * share);
        const what = levelSubject(unit, role);
        proposals.push(
          { trigger: role.tag, message: `${what} high`, kind: "level", level: 2, severity: 3, value: at(LEVEL_ALARM_SHARE.hi) },
          { trigger: role.tag, message: `${what} critically high`, kind: "level", level: 1, severity: 5, value: at(LEVEL_ALARM_SHARE.hihi) },
        );
      }
    }
  }

  return proposals;
}

/** Classes whose own level is the thing a level alarm is about. */
const VESSELS = new Set(["tank", "silo", "reactor", "boiler"]);

/**
 * What a level alarm names. On a vessel, the vessel: "Tank 101 level". On a
 * pump that an LT on its loop was folded into, not the pump - "Pump 101 level
 * high" names a machine that has no level. The transmitter's own comment says
 * what it measures ("Break tank level"); failing that, its tag does.
 */
function levelSubject(unit: InferredEquipment, role: TaggedRole): string {
  if (VESSELS.has(unit.kind)) return `${unit.label} level`;
  const comment = role.comment.trim();
  if (comment) return /level/i.test(comment) ? comment : `${comment} level`;
  const { prefix, loop } = split(role.tag);
  return `${prefix}${loop ? ` ${loop}` : ""} level`;
}

/** A threshold as the alarm table stores it: no float noise, no trailing zeros. */
const threshold = (n: number) => String(Number(n.toPrecision(6)));
