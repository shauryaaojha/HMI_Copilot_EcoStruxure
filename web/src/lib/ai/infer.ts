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
};

/** Role suffixes, longest first so _FAULT wins over _F. */
const ROLES: [RegExp, string][] = [
  [/_(RUN|RUNNING|ON)$/i, "running"],
  [/_(FLT|FAULT|TRIP|ALM|ALARM)$/i, "fault"],
  [/_(CMD|START|STOP)$/i, "command"],
  [/_(SPD|SPEED)$/i, "speed"],
  [/_(PV|VALUE|VAL)$/i, "value"],
  [/_(SP|SETPOINT)$/i, "setpoint"],
  [/_(HI|HIGH|HH)$/i, "high"],
  [/_(LO|LOW|LL)$/i, "low"],
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
  if (parts.length === 1) return { prefix: parts[0] };
  const loop = parts.find((p) => /^\d+[A-Z]?$/i.test(p));
  return { prefix: parts[0].toUpperCase(), loop };
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
export function inferEquipment(variables: Variable[]): InferredEquipment[] {
  const units = new Map<string, InferredEquipment>();

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
    const { prefix, loop } = split(variable.Name);
    const tagged: TaggedRole = {
      tag: variable.Name,
      role: roleOf(variable.Name),
      dataType: variable.DataType,
      comment: variable.Comments,
    };

    const machine = MACHINES[prefix];
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
      const owner = [...units.keys()].find((k) => k.endsWith(`_${loop}`));
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
    if (unit.kind !== "instrument" || !unit.loop) continue;
    const owner = [...units.values()].find(
      (u) => u !== unit && u.loop === unit.loop && u.kind !== "instrument",
    );
    if (owner) {
      owner.tags.push(...unit.tags);
      owner.roles.push(...unit.roles);
      units.delete(key);
    }
  }

  return [...units.values()];
}

/** Which tags deserve an alarm, and of what kind. */
export function proposeAlarms(equipment: InferredEquipment[]) {
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
        proposals.push(
          { trigger: role.tag, message: `${unit.label} level high`, kind: "level", level: 2, severity: 3, value: "85" },
          { trigger: role.tag, message: `${unit.label} level critically high`, kind: "level", level: 1, severity: 5, value: "95" },
        );
      }
    }
  }

  return proposals;
}
