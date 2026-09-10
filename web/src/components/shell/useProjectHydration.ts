"use client";

/**
 * Loading the project into the store, once, for whichever route was opened
 * first.
 *
 * Until the generation pipeline and autosave land, the project *is*
 * src/fixtures - our own output, lifted out of
 * demo_project/HMICopilot_PumpStation.eote, which is a file that opens in the
 * product. Building against that rather than against invented data is what
 * keeps the UI honest before there is a backend to call.
 *
 * It lives here rather than in the workspace because a hard load of
 * /project/x/validation has to find a project too, and two copies of this would
 * be two things to keep in step.
 */

import { useEffect } from "react";
import { demoAlarms, demoBindings, demoScreen, demoVariables } from "@/fixtures";
import type { Screen } from "@/lib/ote/schema";
import { useProject, type Binding } from "@/store/project";

/**
 * Flatten the project's Sources -> Bindings -> Targets graph into the flat list
 * the UI works in. The graph is the .eote's own shape; the flat list is ours.
 *
 * A binding's target is resolved back to a canvas object by Name rather than by
 * the graph's ObjectId, because that is the relation the packager itself uses
 * when it writes ObjectFullName - and because it keeps the click-through in the
 * binding map anchored to the object the engineer can actually see. Alarm
 * targets resolve to no object, which is correct: they are not on the screen.
 */
export function flattenBindings(graph: typeof demoBindings, screen: Screen): Binding[] {
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

export function useProjectHydration(projectId: string) {
  const loaded = useProject((s) => s.screens.length > 0);
  const hydrate = useProject((s) => s.hydrate);

  useEffect(() => {
    if (loaded) {
      // Already in the store from an earlier route; only the id can differ.
      hydrate({ id: projectId });
      return;
    }
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
  }, [loaded, projectId, hydrate]);
}
