"use client";

/**
 * Loading the project once, and keeping it.
 *
 * Two things used to lose work. The first was that "is a project loaded?" was
 * answered by `screens.length > 0`, and a generation run empties the screens
 * before it fills them - so mid-run this hook decided nothing was loaded and
 * seeded the demo fixture *underneath* the run. The second was that nothing
 * persisted, so leaving the workspace for /project/x/tags survived only because
 * zustand is module state, and a reload or a Fast Refresh did not survive at
 * all. Both are fixed here: a project is loaded when this hook says it loaded
 * one, and what it loads is written back to localStorage as it changes.
 *
 * It lives here rather than in the workspace because a hard load of
 * /project/x/validation has to find a project too, and two copies of this would
 * be two things to keep in step.
 *
 * One id is special. `demo` opens on the fixture lifted out of a real .eote,
 * because a landing page that opens on an empty grid demonstrates nothing.
 * Every other id opens blank - a new project that arrives carrying somebody
 * else's pump station is not a new project.
 */

import { useEffect, useRef } from "react";
import { demoAlarms, demoBindings, demoScreen, demoVariables } from "@/fixtures";
import type { Screen } from "@/lib/ote/schema";
import { useProject } from "@/store/project";
import type { Binding } from "@/store/types";
import { loadProject, saveProject } from "@/store/persist";
import { DEMO_ID, loadProjects, touchProject } from "@/store/projects";

/**
 * Which project id this module has already hydrated. Module scope, not state:
 * every route mounts its own copy of this hook, and the question "has the store
 * been filled?" has one answer per page load, not one per component.
 */
let hydratedFor: string | null = null;

/** Exported for tests, which need each case to start from nothing. */
export function forgetHydration() {
  hydratedFor = null;
}

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

/** The one empty screen a new project starts with. */
function blankScreen(target: { width: number; height: number }): Screen {
  return {
    Type: "Screen",
    UniqueId: crypto.randomUUID(),
    Name: "Screen1",
    Children: [
      {
        Type: "ViewBox",
        UniqueId: crypto.randomUUID(),
        Name: "ViewBox",
        Options: 108,
        Width: target.width,
        Height: target.height,
        Children: [],
      },
    ],
  };
}

/** The name the Projects page gave it, so the top bar agrees with the card. */
function nameFor(projectId: string): string {
  return (
    loadProjects().find((p) => p.id === projectId)?.name ?? "Untitled"
  );
}

/** Long enough that a drag writes once, short enough to survive a fast reload. */
const AUTOSAVE_MS = 600;

export function useProjectHydration(projectId: string) {
  const hydrate = useProject((s) => s.hydrate);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (hydratedFor === projectId) return;
    hydratedFor = projectId;

    const saved = loadProject(projectId);
    if (saved) {
      hydrate({
        id: saved.id,
        name: saved.name,
        target: saved.target,
        screens: saved.screens,
        activeScreenId: saved.activeScreenId ?? saved.screens[0]?.UniqueId,
        variables: saved.variables,
        alarms: saved.alarms,
        bindings: saved.bindings,
        objectMeta: saved.objectMeta ?? {},
        standards: saved.standards,
        versions: saved.versions ?? [],
        chat: saved.chat ?? [],
        tagImport: saved.tagImport,
      });
      return;
    }

    if (projectId === DEMO_ID) {
      // The demo opens on our own output, lifted out of
      // demo_project/HMICopilot_PumpStation.eote, which is a file the product
      // opens. A blank canvas is a worse first screen than a real one.
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
      return;
    }

    // A new project: one empty screen and nothing else. Not zero screens -
    // the canvas, the layers panel and the packager all need somewhere to put
    // the first object, and "add a screen before you can draw" is a step that
    // exists for no reason.
    const target = { model: "HMIGTO6310", width: 1024, height: 600 };
    hydrate({
      id: projectId,
      name: nameFor(projectId),
      target,
      screens: [blankScreen(target)],
      variables: [],
      alarms: [],
      bindings: [],
      objectMeta: {},
      versions: [],
      chat: [],
    });
    // hydrate() cannot set activeScreenId before it knows the screen's id, so
    // it is read back from what was just written.
    const created = useProject.getState().screens[0];
    if (created) hydrate({ activeScreenId: created.UniqueId });
  }, [projectId, hydrate]);

  /**
   * Autosave. Subscribing to the whole store and debouncing is deliberate:
   * every action is a candidate save, and picking which ones matter is the kind
   * of list that goes stale the moment someone adds an action.
   */
  useEffect(() => {
    // markSaved() is itself a store change, so without this the subscription
    // would feed itself a save every AUTOSAVE_MS forever. Comparing the payload
    // rather than tracking a dirty flag also means a change that cancels itself
    // out - drag away and back - costs nothing.
    let lastWritten = "";

    const unsubscribe = useProject.subscribe((state) => {
      if (state.id !== projectId || state.screens.length === 0) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const s = useProject.getState();
        const payload = {
          id: s.id,
          name: s.name,
          target: s.target,
          screens: s.screens,
          activeScreenId: s.activeScreenId,
          variables: s.variables,
          alarms: s.alarms,
          bindings: s.bindings,
          objectMeta: s.objectMeta,
          standards: s.standards,
          versions: s.versions,
          chat: s.chat,
          tagImport: s.tagImport,
        };
        const serialised = JSON.stringify(payload);
        if (serialised === lastWritten) return;
        lastWritten = serialised;
        s.markSaved(saveProject(payload));
        // The Projects page reads a separate index, so a card would otherwise
        // keep claiming "0 screens" over a project with four.
        touchProject(s.id, { name: s.name, screens: s.screens.length });
      }, AUTOSAVE_MS);
    });

    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [projectId]);
}
