"use client";

/**
 * Building the project payload and asking /api/export for the bytes.
 *
 * The route is real and returns a genuine .eote - it was verified against a
 * production build, not just the dev server. It needs the project skeleton,
 * which is extracted per machine from a local EcoStruxure installation and is
 * deliberately never committed, so on a machine without one it answers 503.
 * That is a setup condition rather than a failure, and the UI says so, because
 * "export failed" would send someone hunting for a bug that is not there.
 *
 * Phase 7 of docs/BUILD_PLAN.md.
 */

import { useCallback, useState } from "react";
import type { Wire } from "@/lib/ote/bindings";
import type { Alarm } from "@/lib/ote/schema";
import { alarmTriggers } from "@/lib/sim/alarms";
import { useProject } from "@/store/project";
import { variablesCsv } from "./variablesCsv";

export interface Artifact {
  name: string;
  bytes: number;
  url: string;
  kind: "eote" | "csv" | "report";
}

export type ExportState =
  | { status: "idle" }
  | { status: "building" }
  | { status: "done" }
  | { status: "failed"; message: string; setup: boolean };

/** Everything /api/export and /api/validate need, from what the store holds. */
export function packageInput(state: ReturnType<typeof useProject.getState>) {
  // Keyed with the screen, not just the part: a Target carries ScreenId, so a
  // multi-screen project has to bind each object to the screen it is on.
  const byId = new Map(
    state.screens.flatMap((screen) =>
      screen.Children[0].Children.map(
        (part) => [part.UniqueId, { part, screenId: screen.UniqueId }] as const,
      ),
    ),
  );

  const wires: Wire[] = state.bindings.flatMap((binding) => {
    const found = byId.get(binding.targetId);
    return found
      ? [
          {
            part: found.part,
            tag: binding.tag,
            property: binding.property,
            screenId: found.screenId,
          },
        ]
      : [];
  });

  // The product stores an alarm's trigger as a binding, not a column, so it is
  // recovered from the bindings before the packager is asked to write it back.
  const triggers = alarmTriggers(state.bindings);
  const alarms: Alarm[] = state.alarms.map((alarm, i) => ({
    ...alarm,
    Trigger: alarm.Trigger || triggers.get(i + 1) || "",
  }));

  return {
    name: state.name,
    target: state.target,
    screens: state.screens,
    variables: state.variables,
    alarms,
    wires,
  };
}

export function useExport() {
  const [state, setState] = useState<ExportState>({ status: "idle" });
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const store = useProject;

  const build = useCallback(
    async (options: { eote: boolean; csv: boolean; report: boolean }) => {
      setState({ status: "building" });
      // Revoking first keeps a long session from leaking every previous build.
      for (const artifact of artifacts) URL.revokeObjectURL(artifact.url);
      setArtifacts([]);

      const s = store.getState();
      const made: Artifact[] = [];

      if (options.csv) {
        const csv = new Blob([variablesCsv(s.variables)], {
          type: "text/csv;charset=utf-8",
        });
        made.push({
          name: "Variables.csv",
          bytes: csv.size,
          url: URL.createObjectURL(csv),
          kind: "csv",
        });
      }

      if (options.eote) {
        try {
          const response = await fetch("/api/export", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(packageInput(s)),
          });

          if (!response.ok) {
            const data = (await response.json().catch(() => ({}))) as { error?: string };
            const message = data.error ?? `export failed (${response.status})`;
            setArtifacts(made);
            setState({ status: "failed", message, setup: response.status === 503 });
            s.log(`Export failed: ${message}`);
            return;
          }

          const blob = await response.blob();
          made.unshift({
            name: `${s.name.replace(/[^A-Za-z0-9._-]+/g, "_")}.eote`,
            bytes: blob.size,
            url: URL.createObjectURL(blob),
            kind: "eote",
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "export failed";
          setArtifacts(made);
          setState({ status: "failed", message, setup: false });
          return;
        }
      }

      if (options.report) {
        try {
          const response = await fetch("/api/export/report", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(packageInput(s)),
          });

          if (response.ok) {
            const blob = await response.blob();
            made.push({
              name: `${s.name.replace(/[^A-Za-z0-9._-]+/g, "_")}_validation.html`,
              bytes: blob.size,
              url: URL.createObjectURL(blob),
              kind: "report",
            });
          } else {
            // The report is supporting evidence, not the deliverable. Losing it
            // is worth a line in the log, not a failed export.
            s.log("Validation report could not be generated.");
          }
        } catch {
          s.log("Validation report could not be generated.");
        }
      }

      setArtifacts(made);
      setState({ status: "done" });
      s.log(`Export ready: ${made.map((a) => a.name).join(", ")}`);
    },
    [artifacts, store],
  );

  return { state, artifacts, build };
}
