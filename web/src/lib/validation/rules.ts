/**
 * Design-time validation.
 *
 * The point is the timing, not the cleverness: every one of these findings is
 * something that today surfaces at commissioning, on site, with the panel
 * mounted. Each carries the id of the object that caused it so the UI can put
 * the engineer in front of it.
 *
 * Phase 6 of docs/BUILD_PLAN.md.
 */

import type { PackageInput } from "@/lib/ote/packager";
import type { Part, Variable } from "@/lib/ote/schema";
import { checkName } from "./naming";

export type Severity = "error" | "warning" | "info";

export interface Finding {
  severity: Severity;
  /** Which rule fired, for grouping in the UI. */
  rule: string;
  message: string;
  /** UniqueId of the offending screen object, when there is one. */
  objectId?: string;
  /** Tag name, when the finding is about a variable. */
  tag?: string;
  suggestion?: string;
}

/** Properties that carry a live value, by part type. */
const VALUE_PROPERTY: Partial<Record<Part["Type"], string>> = {
  Lamp: "CurrentValue",
  NumericDisplay: "CurrentValue",
};

/** What a part can legitimately be driven by. */
const ACCEPTS: Partial<Record<Part["Type"], Variable["DataType"][]>> = {
  Lamp: ["BOOL"],
  NumericDisplay: ["INT", "DINT", "UINT", "UDINT", "WORD", "DWORD", "REAL", "LREAL"],
};

const isNumeric = (t: Variable["DataType"]) => t !== "BOOL" && t !== "STRING";

export interface ActualPanel {
  model: string;
  width: number;
  height: number;
}

export function validateProject(
  project: PackageInput,
  /** The panel Target.dat declares, when the caller knows it. */
  actualPanel?: ActualPanel | null,
): Finding[] {
  const findings: Finding[] = [];
  const parts = project.screens.flatMap((s) => s.Children[0].Children);
  const byName = new Map(project.variables.map((v) => [v.Name, v]));

  // --- naming conventions -------------------------------------------------
  for (const variable of project.variables) {
    const check = checkName(variable.Name);
    if (!check.ok) {
      findings.push({
        severity: "error",
        rule: "naming",
        tag: variable.Name,
        message: `Tag ${variable.Name}: ${check.message}`,
        suggestion: check.suggestion,
      });
    } else if (check.problem === "script-keyword") {
      findings.push({
        severity: "info",
        rule: "naming",
        tag: variable.Name,
        message: check.message ?? "",
      });
    }
  }

  const duplicates = new Set<string>();
  const seen = new Set<string>();
  for (const v of project.variables) {
    if (seen.has(v.Name)) duplicates.add(v.Name);
    seen.add(v.Name);
  }
  for (const name of duplicates) {
    findings.push({
      severity: "error",
      rule: "naming",
      tag: name,
      message: `Tag ${name} is declared more than once`,
    });
  }

  for (const part of parts) {
    const check = checkName(part.Name);
    if (!check.ok) {
      findings.push({
        severity: "error",
        rule: "naming",
        objectId: part.UniqueId,
        message: `Object ${part.Name}: ${check.message}`,
        suggestion: check.suggestion,
      });
    }
  }

  // --- binding integrity --------------------------------------------------
  const wiredParts = new Set(project.wires.map((w) => w.part.UniqueId));

  for (const wire of project.wires) {
    const variable = byName.get(wire.tag);
    if (!variable) {
      findings.push({
        severity: "error",
        rule: "binding",
        objectId: wire.part.UniqueId,
        message: `${wire.part.Name} is bound to ${wire.tag}, which is not declared`,
      });
      continue;
    }

    const accepts = ACCEPTS[wire.part.Type];
    if (accepts && !accepts.includes(variable.DataType)) {
      findings.push({
        severity: "error",
        rule: "type-mismatch",
        objectId: wire.part.UniqueId,
        tag: wire.tag,
        message:
          `${wire.part.Name} is a ${wire.part.Type} but ${wire.tag} is ` +
          `${variable.DataType}; it accepts ${accepts.join(", ")}`,
      });
    }
  }

  // A part that displays a value but is driven by nothing shows a constant.
  for (const part of parts) {
    if (VALUE_PROPERTY[part.Type] && !wiredParts.has(part.UniqueId)) {
      findings.push({
        severity: "warning",
        rule: "binding",
        objectId: part.UniqueId,
        message: `${part.Name} displays a value but is not bound to any tag`,
      });
    }
  }

  const usedTags = new Set([
    ...project.wires.map((w) => w.tag),
    ...project.alarms.map((a) => a.Trigger),
  ]);
  for (const variable of project.variables) {
    if (!usedTags.has(variable.Name)) {
      findings.push({
        severity: "info",
        rule: "unused-tag",
        tag: variable.Name,
        message: `${variable.Name} is declared but nothing on the screen uses it`,
      });
    }
  }

  // --- alarms -------------------------------------------------------------
  for (const alarm of project.alarms) {
    const variable = byName.get(alarm.Trigger);
    if (!variable) {
      findings.push({
        severity: "error",
        rule: "alarm",
        tag: alarm.Trigger,
        message: `Alarm "${alarm.Message}" is triggered by ${alarm.Trigger}, which is not declared`,
      });
      continue;
    }
    // AlarmRecordType 1 = bit (a BOOL going true), 2 = level (a threshold).
    if (alarm.AlarmRecordType === 1 && variable.DataType !== "BOOL") {
      findings.push({
        severity: "error",
        rule: "alarm",
        tag: alarm.Trigger,
        message: `Alarm "${alarm.Message}" is a bit alarm but ${alarm.Trigger} is ${variable.DataType}`,
      });
    }
    if (alarm.AlarmRecordType === 2) {
      if (!isNumeric(variable.DataType)) {
        findings.push({
          severity: "error",
          rule: "alarm",
          tag: alarm.Trigger,
          message: `Alarm "${alarm.Message}" is a level alarm but ${alarm.Trigger} is ${variable.DataType}`,
        });
      }
      if (alarm.Value.trim() === "" || Number.isNaN(Number(alarm.Value))) {
        findings.push({
          severity: "error",
          rule: "alarm",
          tag: alarm.Trigger,
          message: `Alarm "${alarm.Message}" is a level alarm with no numeric setpoint`,
        });
      }
    }
  }

  // --- completeness -------------------------------------------------------
  // Equipment knowledge, encoded: a fault tag that raises no alarm is the
  // classic omission, because the lamp on screen looks like it is doing the job.
  const alarmTriggers = new Set(project.alarms.map((a) => a.Trigger));
  for (const variable of project.variables) {
    if (/(_FLT|_FAULT|_ALM|_ALARM|_TRIP)$/i.test(variable.Name) && !alarmTriggers.has(variable.Name)) {
      findings.push({
        severity: "warning",
        rule: "completeness",
        tag: variable.Name,
        message: `${variable.Name} looks like a fault tag but raises no alarm`,
        suggestion: `Add a bit alarm triggered by ${variable.Name}`,
      });
    }
  }

  if (project.screens.length === 0) {
    findings.push({
      severity: "error",
      rule: "completeness",
      message: "The project has no screens",
    });
  }

  // --- standards conformance ----------------------------------------------
  // The declared panel is a label; Target.dat inside the skeleton is the
  // authority. A caption that disagrees with the file is exactly the kind of
  // small untruth the "preview cannot lie" claim cannot afford, so it is
  // reported here rather than failing the export.
  if (actualPanel) {
    if (
      actualPanel.width !== project.target.width ||
      actualPanel.height !== project.target.height ||
      (actualPanel.model && actualPanel.model !== project.target.model)
    ) {
      findings.push({
        severity: "warning",
        rule: "standards",
        message:
          `Project is labelled ${project.target.model} ` +
          `${project.target.width}x${project.target.height}, but the file targets ` +
          `${actualPanel.model} ${actualPanel.width}x${actualPanel.height}`,
        suggestion: `Show ${actualPanel.model} ${actualPanel.width}x${actualPanel.height}`,
      });
    }
  }

  for (const screen of project.screens) {
    const view = screen.Children[0];
    if (view.Width > project.target.width || view.Height > project.target.height) {
      findings.push({
        severity: "error",
        rule: "standards",
        message:
          `Screen ${screen.Name} is ${view.Width}x${view.Height}, larger than the ` +
          `${project.target.model} panel at ${project.target.width}x${project.target.height}`,
      });
    } else if (view.Width !== project.target.width || view.Height !== project.target.height) {
      findings.push({
        severity: "warning",
        rule: "standards",
        message:
          `Screen ${screen.Name} is ${view.Width}x${view.Height} on a ` +
          `${project.target.width}x${project.target.height} panel, leaving unused area`,
      });
    }

    for (const part of view.Children) {
      const right = part.Location.Left + part.Width;
      const bottom = part.Location.Top + part.Height;
      if (part.Location.Left < 0 || part.Location.Top < 0 || right > view.Width || bottom > view.Height) {
        findings.push({
          severity: "warning",
          rule: "standards",
          objectId: part.UniqueId,
          message: `${part.Name} falls outside the screen area`,
        });
      }
    }
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function summarise(findings: Finding[]) {
  return {
    all: findings.length,
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
  };
}
