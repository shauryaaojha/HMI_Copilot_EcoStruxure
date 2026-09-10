"use client";

/**
 * Running the project through /api/validate and keeping the findings.
 *
 * The route is real: lib/validation/rules.ts checks naming, binding integrity,
 * type mismatch, completeness and standards conformance, and every finding
 * carries the id of the object that caused it.
 *
 * The binding map and the validation list both read the findings this puts in
 * the store, which is what makes the Phase 6 exit criterion hold by
 * construction: delete a binding and the same finding turns the map row amber
 * and appears in the results, both pointing at the same object. Two independent
 * checks could disagree; one cannot.
 *
 * Phase 6 of docs/BUILD_PLAN.md.
 */

import { useCallback, useState } from "react";
import type { Wire } from "@/lib/ote/bindings";
import type { Alarm } from "@/lib/ote/schema";
import { alarmTriggers } from "@/lib/sim/alarms";
import { useProject, type Finding } from "@/store/project";

export interface Summary {
  all: number;
  errors: number;
  warnings: number;
  info: number;
}

export function summarise(findings: Finding[]): Summary {
  return {
    all: findings.length,
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
  };
}

export function useValidation() {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [ranAt, setRanAt] = useState<number>();
  const store = useProject;

  const validate = useCallback(async () => {
    setRunning(true);
    setError(undefined);

    const s = store.getState();
    const parts = s.screens.flatMap((screen) => screen.Children[0].Children);
    const byId = new Map(parts.map((part) => [part.UniqueId, part]));

    // Only bindings that resolve to a screen object are wires; the rest are the
    // alarm triggers, which the rules read off `alarms` instead.
    const wires: Wire[] = s.bindings.flatMap((binding) => {
      const part = byId.get(binding.targetId);
      return part ? [{ part, tag: binding.tag, property: binding.property }] : [];
    });

    // The fixture's alarms carry no Trigger, because the product stores an
    // alarm's trigger as a binding rather than as a column. Recovering it here
    // keeps the completeness rule from reporting omissions that are not real.
    const triggers = alarmTriggers(s.bindings);
    const alarms: Alarm[] = s.alarms.map((alarm, i) => ({
      ...alarm,
      Trigger: alarm.Trigger || triggers.get(i + 1) || "",
    }));

    try {
      const response = await fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: s.name,
          target: s.target,
          screens: s.screens,
          variables: s.variables,
          alarms,
          wires,
        }),
      });

      const data = (await response.json()) as { findings?: Finding[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? `validation failed (${response.status})`);

      store.getState().hydrate({ findings: data.findings ?? [] });
      setRanAt(Date.now());
      store
        .getState()
        .log(`Validation: ${summarise(data.findings ?? []).errors} errors, ` +
          `${summarise(data.findings ?? []).warnings} warnings`);
      return data.findings ?? [];
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "validation failed";
      setError(message);
      return null;
    } finally {
      setRunning(false);
    }
  }, [store]);

  return { validate, running, error, ranAt };
}
