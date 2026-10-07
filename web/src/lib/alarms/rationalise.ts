/**
 * The alarm rationalisation table, drafted from the machine library.
 *
 * docs/REENGINEERING.md §1.4: under ISA-18.2 / IEC 62682 every alarm has a
 * documented priority, consequence and operator action, and the priority
 * distribution of a whole system should be roughly 80% low, 15% medium and
 * 5% high. An alarm with no defined response is not an alarm. The generator
 * proposes alarms per fault bit and level tag; this drafts the record each
 * one needs, from the standard alarm its machine class defines
 * (lib/library/machines.ts), and checks the table as a whole.
 *
 * Drafted, not decided: every row is a proposal for the engineer and the
 * plant to sign off, and a row the library cannot fill says so rather than
 * inventing a consequence. Pure and read-only - nothing here changes an alarm.
 */

import type { Alarm } from "@/lib/ote/schema";
import type { InferredEquipment } from "@/lib/ai/infer";
import { machineClass, severityOf, type AlarmTemplate, type Priority } from "@/lib/library/machines";

export interface RationalisedAlarm {
  trigger: string;
  message: string;
  /** "bit", or the limit: "hihi", "hi", "lo", "lolo". */
  on: AlarmTemplate["on"];
  priority: Priority;
  /** The OTE severity the alarm has now, and the one its priority implies. */
  severity: number;
  suggestedSeverity: number;
  consequence: string;
  action: string;
  /** Where the record came from: the class's standard alarm, or nowhere yet. */
  source: "library" | "none";
  /** The unit and class the trigger belongs to, when known. */
  unit?: string;
  klass?: string;
}

export interface RationaliseFinding {
  severity: "warning" | "info";
  message: string;
  trigger?: string;
}

export interface Rationalisation {
  rows: RationalisedAlarm[];
  distribution: Record<Priority, number> & { total: number; shares: Record<Priority, number> };
  findings: RationaliseFinding[];
}

const LIMIT: Record<number, AlarmTemplate["on"]> = { 1: "hihi", 2: "hi", 3: "lo", 4: "lolo" };

/** Below this many alarms a distribution says nothing; ISA-18.2's figures are for systems. */
export const DISTRIBUTION_MIN = 10;

const priorityOfSeverity = (s: number): Priority => (s >= 7 ? "high" : s >= 4 ? "medium" : "low");

export function rationalise(alarms: Alarm[], equipment: InferredEquipment[]): Rationalisation {
  const unitOf = new Map<string, { unit: InferredEquipment; role: string }>();
  for (const unit of equipment) for (const r of unit.roles) unitOf.set(r.tag.toLowerCase(), { unit, role: r.role });

  const findings: RationaliseFinding[] = [];
  const seen = new Map<string, number>();
  const rows: RationalisedAlarm[] = alarms.map((a) => {
    const on: AlarmTemplate["on"] = a.AlarmRecordType === 1 ? "bit" : LIMIT[a.AlarmType];
    const key = `${a.Trigger.toLowerCase()}|${on}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    const found = unitOf.get(a.Trigger.toLowerCase());
    const klass = found ? machineClass(found.unit.kind) : undefined;
    const roleAlarms = klass?.alarms.filter((t) => t.role === found!.role) ?? [];
    // The template for this role at this limit; a bit alarm on a role whose
    // template is a limit (or the reverse) is not the same alarm.
    const template = roleAlarms.find((t) => t.on === on) ?? (on === "bit" ? undefined : roleAlarms.find((t) => t.on !== "bit" && t.on.slice(-2) === on.slice(-2)));
    const priority = template?.priority ?? priorityOfSeverity(a.Severity);
    return {
      trigger: a.Trigger,
      message: a.Message,
      on,
      priority,
      severity: a.Severity,
      suggestedSeverity: severityOf(priority),
      consequence: template?.consequence ?? "",
      action: template?.action ?? "",
      source: template ? "library" : "none",
      ...(found ? { unit: found.unit.id, klass: found.unit.kind } : {}),
    };
  });

  for (const r of rows) {
    if (!r.action) {
      findings.push({
        severity: "warning",
        trigger: r.trigger,
        message: `"${r.message}" has no defined operator action. Under ISA-18.2 an alarm without a response should not be an alarm: write the action, or make it an event.`,
      });
    } else if (r.severity !== r.suggestedSeverity) {
      findings.push({
        severity: "info",
        trigger: r.trigger,
        message: `"${r.message}" is severity ${r.severity}; its ${r.priority}-priority consequence suggests ${r.suggestedSeverity}.`,
      });
    }
  }
  for (const [key, n] of seen) {
    if (n > 1) findings.push({ severity: "warning", trigger: key.split("|")[0], message: `${key.split("|")[0]} raises the same ${key.split("|")[1]} alarm ${n} times; one will do.` });
  }

  const count: Record<Priority, number> = { high: 0, medium: 0, low: 0 };
  for (const r of rows) count[r.priority]++;
  const total = rows.length;
  const share = (n: number) => (total ? Math.round((n / total) * 100) / 100 : 0);
  const shares = { high: share(count.high), medium: share(count.medium), low: share(count.low) };
  if (total >= DISTRIBUTION_MIN) {
    if (shares.high > 0.15) {
      findings.push({
        severity: "warning",
        message: `${Math.round(shares.high * 100)}% of alarms are high priority; ISA-18.2 practice is about 5%. When everything is urgent, nothing is - review which consequences really need an immediate response.`,
      });
    }
    if (shares.low < 0.5) {
      findings.push({
        severity: "info",
        message: `${Math.round(shares.low * 100)}% of alarms are low priority, against about 80% in ISA-18.2 practice.`,
      });
    }
  }
  return { rows, distribution: { ...count, total, shares }, findings };
}
