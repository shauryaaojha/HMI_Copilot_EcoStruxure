/**
 * The simulation engine: tag values that move, cross setpoints and fire alarms.
 *
 * The point of simulating at the desk is to prove the screen works before the
 * panel is mounted - every lamp reaches both states, every alarm the project
 * defines actually fires, every numeric moves through its range. So the engine
 * does not replay a recording. It builds a small process model per tag out of
 * what the project already declares, and runs it.
 *
 * Where the model comes from:
 *
 *   - a numeric tag that triggers level alarms is driven *through* their
 *     setpoints, because an alarm nobody can make fire is an alarm nobody has
 *     tested. The highest setpoint sets the target.
 *   - BOOL run tags for the same equipment group run lead/lag - one duty unit
 *     at a time, which is what a two-pump station actually does.
 *   - one fault is injected on a standby unit, deliberately, so the alarm path
 *     and the red lamp state are both exercised rather than assumed.
 *
 * Runs are reproducible: the noise comes from a seeded generator, so the same
 * project and seed give the same run every time, which is what makes a demo
 * safe to rehearse.
 *
 * Phase 8 of docs/BUILD_PLAN.md. Pure client, no format knowledge.
 */

import type { Alarm, Variable } from "@/lib/ote/schema";
import type { Binding } from "@/store/project";
import { alarmTriggers } from "./alarms";

export type TagValues = Record<string, number | boolean>;

/** mulberry32 - small, fast, and identical across runs for a given seed. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RUN = /(_RUN|_RUNNING|_ON|_CMD)$/i;
const FAULT = /(_FLT|_FAULT|_ALM|_ALARM|_TRIP)$/i;
/**
 * Two levels of grouping, and the difference matters.
 *
 *   PMP_101_RUN -> unit "PMP_101"   the individual pump
 *              -> family "PMP"      every pump in the station
 *
 * Lead/lag is a property of the family: one pump of the two runs. A fault is a
 * property of the unit: PMP_102 trips, not every PMP. Grouping by unit would
 * make every pump its own lead and start them all, which is not what a duty
 * standby station does.
 */
const UNIT = /^([A-Za-z]+_?\d+)/;
const FAMILY = /^([A-Za-z]+)/;

interface NumericModel {
  kind: "numeric";
  value: number;
  target: number;
  min: number;
  max: number;
  /** Fraction of the remaining gap closed per second. */
  rate: number;
  noise: number;
}

interface BoolModel {
  kind: "bool";
  value: boolean;
  /** Seconds after start at which the value flips to `then`. */
  at: number;
  then: boolean;
}

type Model = NumericModel | BoolModel;

export interface EngineOptions {
  variables: Variable[];
  alarms: Alarm[];
  /** Used to recover each alarm's trigger, which the product stores as a binding. */
  bindings: Binding[];
  seed?: number;
}

export interface Engine {
  /** Tag-keyed, which is what the alarms are keyed by. */
  readonly values: TagValues;
  readonly elapsed: number;
  /** Advance by `dt` seconds and return the new values. */
  tick(dt: number): TagValues;
  reset(): void;
}

const isNumeric = (v: Variable) => v.DataType !== "BOOL" && v.DataType !== "STRING";

export function createEngine({
  variables,
  alarms,
  bindings,
  seed = 1,
}: EngineOptions): Engine {
  const triggers = alarmTriggers(bindings);

  /** Level-alarm setpoints per tag, so the engine knows what to cross. */
  const setpoints = new Map<string, number[]>();
  alarms.forEach((alarm, i) => {
    if (alarm.AlarmRecordType !== 2) return;
    const tag = alarm.Trigger || triggers.get(i + 1);
    const value = Number(alarm.Value);
    if (!tag || !Number.isFinite(value)) return;
    setpoints.set(tag, [...(setpoints.get(tag) ?? []), value]);
  });

  /** Run tags per family, in declaration order - first is the duty unit. */
  const runsByFamily = new Map<string, string[]>();
  for (const variable of variables) {
    if (variable.DataType !== "BOOL" || !RUN.test(variable.Name)) continue;
    const family = FAMILY.exec(variable.Name)?.[1] ?? variable.Name;
    runsByFamily.set(family, [...(runsByFamily.get(family) ?? []), variable.Name]);
  }
  /** The duty unit of each family - the one that runs. */
  const lead = new Set([...runsByFamily.values()].map((names) => names[0]));
  /** Standby units; the first of them is where the fault is injected. */
  const standby = [...runsByFamily.values()].flatMap((names) => names.slice(1));
  const faultUnit = standby[0] ? UNIT.exec(standby[0])?.[1] : undefined;

  function build(): Map<string, Model> {
    const random = prng(seed);
    const models = new Map<string, Model>();

    for (const variable of variables) {
      if (isNumeric(variable)) {
        const levels = setpoints.get(variable.Name) ?? [];
        const highest = levels.length > 0 ? Math.max(...levels) : undefined;
        // A tag with alarms is driven past the highest of them; one without
        // settles mid-range, where it is visible but uneventful.
        const max = highest !== undefined ? Math.max(100, highest * 1.2) : 100;
        const target =
          highest !== undefined ? Math.min(max, highest * 1.08) : 40 + random() * 30;

        models.set(variable.Name, {
          kind: "numeric",
          value: 0,
          target,
          min: 0,
          max,
          rate: 0.55 + random() * 0.25,
          noise: target * 0.012,
        });
        continue;
      }

      if (variable.DataType !== "BOOL") continue;

      if (RUN.test(variable.Name)) {
        // The duty unit starts; the standby stays off, as lead/lag runs.
        const runs = lead.has(variable.Name);
        models.set(variable.Name, {
          kind: "bool",
          value: false,
          at: runs ? 1.2 : Infinity,
          then: true,
        });
        continue;
      }

      if (FAULT.test(variable.Name)) {
        const unit = UNIT.exec(variable.Name)?.[1];
        const injected = unit !== undefined && unit === faultUnit;
        models.set(variable.Name, {
          kind: "bool",
          value: false,
          at: injected ? 3.5 : Infinity,
          then: true,
        });
        continue;
      }

      // Anything else BOOL follows the lead unit, a beat later.
      models.set(variable.Name, { kind: "bool", value: false, at: 2.4, then: true });
    }

    return models;
  }

  let models = build();
  let random = prng(seed ^ 0x9e3779b9);
  let elapsed = 0;

  const snapshot = (): TagValues => {
    const out: TagValues = {};
    for (const [name, model] of models) {
      out[name] = model.kind === "numeric" ? round(model.value) : model.value;
    }
    return out;
  };

  let values = snapshot();

  return {
    get values() {
      return values;
    },
    get elapsed() {
      return elapsed;
    },

    tick(dt) {
      elapsed += dt;

      for (const model of models.values()) {
        if (model.kind === "bool") {
          if (elapsed >= model.at) model.value = model.then;
          continue;
        }
        // First-order lag toward the target, plus a little process noise, so a
        // level rises through its setpoint rather than jumping over it.
        const gap = model.target - model.value;
        const drift = gap * Math.min(1, model.rate * dt);
        const jitter = (random() - 0.5) * 2 * model.noise;
        model.value = clamp(model.value + drift + jitter, model.min, model.max);
      }

      values = snapshot();
      return values;
    },

    reset() {
      models = build();
      random = prng(seed ^ 0x9e3779b9);
      elapsed = 0;
      values = snapshot();
    },
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** One decimal is what a NumericDisplay shows; more would be false precision. */
const round = (n: number) => Math.round(n * 10) / 10;
