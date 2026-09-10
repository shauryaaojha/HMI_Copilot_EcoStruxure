"use client";

/**
 * The workspace route's client half: hydrate the store, then hand the four
 * regions to the shell.
 *
 * Until the generation pipeline lands (Phase 4), the project comes from
 * src/fixtures/ - our own output, lifted out of
 * demo_project/HMICopilot_PumpStation.eote, which is a file that opens in the
 * product. Building the chrome against that rather than against invented data
 * is what keeps the canvas honest before there is a backend to call.
 */

import { useEffect } from "react";
import { demoAlarms, demoBindings, demoScreen, demoVariables } from "@/fixtures";
import type { Screen } from "@/lib/ote/schema";
import { useProject, type Binding } from "@/store/project";
import { CanvasPane } from "@/components/canvas/CanvasPane";
import { Inspector } from "@/components/inspector/Inspector";
import { IntentPanel } from "@/components/intent/IntentPanel";
import { BuildTimeline } from "@/components/timeline/BuildTimeline";
import { WorkspaceShell } from "./WorkspaceShell";

/**
 * Flatten the project's Sources -> Bindings -> Targets graph into the flat list
 * the UI works in. The graph is the .eote's own shape; the flat list is ours.
 *
 * A binding's target is resolved back to a canvas object by Name rather than by
 * the graph's ObjectId, because that is the relation the packager itself uses
 * when it writes ObjectFullName - and because it keeps the click-through in the
 * binding map anchored to the object the engineer can actually see.
 */
function flattenBindings(graph: typeof demoBindings, screen: Screen): Binding[] {
  const sourceById = new Map(graph.Sources.map((s) => [s.ReferenceId, s]));
  const targetById = new Map(graph.Targets.map((t) => [t.ReferenceId, t]));
  const objectByName = new Map(
    screen.Children[0].Children.map((part) => [part.Name, part]),
  );

  return graph.Bindings.flatMap((b) => {
    const target = targetById.get(b.Target);
    if (!target) return [];
    const object = objectByName.get(target.ObjectFullName);
    // `Sources` is a comma-separated list of reference ids - usually one.
    return b.Sources.split(",")
      .map((raw) => sourceById.get(Number(raw.trim())))
      .filter((s) => s !== undefined)
      .map((s) => ({
        tag: s.ObjectFullName,
        targetId: object?.UniqueId ?? "",
        targetName: target.ObjectFullName,
        property: b.TargetProperty,
      }));
  });
}

export function Workspace({ projectId }: { projectId: string }) {
  const hydrate = useProject((s) => s.hydrate);

  useEffect(() => {
    hydrate({
      id: projectId,
      name: "Pump_Station_Demo",
      target: { model: "HMIGTO6310", width: 1024, height: 768 },
      screens: [demoScreen],
      activeScreenId: demoScreen.UniqueId,
      variables: demoVariables,
      alarms: demoAlarms,
      bindings: flattenBindings(demoBindings, demoScreen),
    });
  }, [hydrate, projectId]);

  return (
    <WorkspaceShell
      projectId={projectId}
      intent={<IntentPanel />}
      canvas={<CanvasPane />}
      inspector={<Inspector />}
      timeline={<BuildTimeline />}
    />
  );
}
