/**
 * Which alarms are active, given what the tags are reading.
 *
 * The product does not store an alarm's trigger as a column - it stores a
 * binding from the alarm to a variable, which is why Alarm.db has no trigger
 * field and why src/fixtures/pump-station.project.json carries no Trigger
 * either. So the trigger is recovered the way the runtime recovers it: from the
 * binding list, by the alarm's own AlarmGroup name.
 *
 * Doing it this way rather than asking FORMAT to widen the fixture keeps the
 * evaluation honest - unbind an alarm in the binding map and it stops firing
 * here too, because there is no longer a binding to find.
 *
 * Phase 8 of docs/BUILD_PLAN.md. Pure client: it knows the shapes lib/ote
 * defines and nothing at all about the file format.
 */

import type { Alarm } from "@/lib/ote/schema";
import type { Binding } from "@/store/project";
import type { AlarmRow } from "@/components/canvas/parts";

/** The packager names alarm targets "AlarmGroup1.Alarm4.Hi". */
const ALARM_TARGET = /\.Alarm(\d+)\./;

/**
 * Alarm ordinal (1-based, as the packager numbers them) -> the variable bound
 * to it. A Lamp bound to the same tag is not a trigger, so only bindings whose
 * target names an alarm are considered.
 */
export function alarmTriggers(bindings: Binding[]): Map<number, string> {
  const triggers = new Map<number, string>();
  for (const binding of bindings) {
    const ordinal = Number(ALARM_TARGET.exec(binding.targetName)?.[1]);
    if (Number.isFinite(ordinal)) triggers.set(ordinal, binding.tag);
  }
  return triggers;
}

/**
 * Screen objects carry live values keyed by object name; alarms are keyed by
 * variable. The bindings are the translation, so this walks the same edges the
 * runtime would rather than assuming the two names match.
 */
export function tagValues(
  bindings: Binding[],
  objectValues: Record<string, number | boolean>,
): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  for (const binding of bindings) {
    if (ALARM_TARGET.test(binding.targetName)) continue;
    const value = objectValues[binding.targetName];
    if (value !== undefined) out[binding.tag] = value;
  }
  return out;
}

/**
 * AlarmRecordType 1 is a bit alarm - raised while the bit is set.
 * AlarmRecordType 2 is a level alarm - compared against its setpoint, above for
 * HiHi and Hi, below for Lo and LoLo.
 */
export function isRaised(alarm: Alarm, value: number | boolean | undefined): boolean {
  if (value === undefined) return false;

  if (alarm.AlarmRecordType === 1) {
    return typeof value === "boolean" ? value : Number(value) !== 0;
  }

  const reading = Number(value);
  const setpoint = Number(alarm.Value);
  if (!Number.isFinite(reading) || !Number.isFinite(setpoint)) return false;

  // 1 HiHi and 2 Hi rise into alarm; 3 Lo and 4 LoLo fall into it.
  return alarm.AlarmType <= 2 ? reading >= setpoint : reading <= setpoint;
}

/** The rows the AlarmSummary part should list, most severe first. */
export function activeAlarms(
  alarms: Alarm[],
  bindings: Binding[],
  objectValues: Record<string, number | boolean>,
  at = new Date(),
): AlarmRow[] {
  const triggers = alarmTriggers(bindings);
  const values = tagValues(bindings, objectValues);
  const time = at.toLocaleTimeString("en-GB", { hour12: false });

  return alarms
    .map((alarm, i) => ({ alarm, trigger: alarm.Trigger || triggers.get(i + 1) }))
    .filter(
      (row): row is { alarm: Alarm; trigger: string } =>
        row.trigger !== undefined && isRaised(row.alarm, values[row.trigger]),
    )
    .sort((a, b) => b.alarm.Severity - a.alarm.Severity)
    .map(({ alarm, trigger }) => ({
      time,
      variable: trigger,
      message: alarm.Message,
      severity: String(alarm.Severity),
      state: "ACTIVE",
    }));
}
