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
 * Every project opens on what it actually contains. There used to be one
 * special id that opened on a fixture, so that a first visit landed on a full
 * canvas - but a tool that shows you somebody else's pump station before you
 * have done anything is demonstrating itself, not helping. A new project opens
 * empty, and the start pane asks what to build.
 */

import { useEffect, useRef } from "react";
import type { Screen } from "@/lib/ote/schema";
import type { BindingGraph } from "@/lib/ote/bindings";
import { useProject } from "@/store/project";
import type { Binding } from "@/store/types";
import { loadProject, saveProject } from "@/store/persist";
import { loadProjects, touchProject } from "@/store/projects";
import { DEFAULT_PANEL } from "@/lib/backend/panels";

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
export function flattenBindings(graph: BindingGraph, screen: Screen): Binding[] {
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
        screenPlacement: saved.screenPlacement ?? {},
        handles: saved.handles ?? {},
        handleSeq: saved.handleSeq ?? 0,
        source: saved.source,
        foreign: saved.foreign ?? {},
        composites: saved.composites ?? {},
        programs: saved.programs ?? {},
        plant: saved.plant,
        standards: saved.standards,
        versions: saved.versions ?? [],
        chat: saved.chat ?? [],
        tagImport: saved.tagImport,
      });
      return;
    }


    // A new project: one empty screen and nothing else. Not zero screens -
    // the canvas, the layers panel and the packager all need somewhere to put
    // the first object, and "add a screen before you can draw" is a step that
    // exists for no reason.
    // One panel, stated once: the default profile until the server says what
    // the skeleton's Target.dat is for. "HMIGTO6310 at 1024x600" used to be
    // written here - a model at a resolution it does not have.
    const target = { model: DEFAULT_PANEL.model, width: DEFAULT_PANEL.width, height: DEFAULT_PANEL.height };
    hydrate({
      id: projectId,
      name: nameFor(projectId),
      target,
      screens: [blankScreen(target)],
      variables: [],
      alarms: [],
      bindings: [],
      objectMeta: {},
      screenPlacement: {},
      versions: [],
      chat: [],
    });
    // hydrate() cannot set activeScreenId before it knows the screen's id, so
    // it is read back from what was just written.
    const created = useProject.getState().screens[0];
    if (created) hydrate({ activeScreenId: created.UniqueId });

    // The exported file can only target the panel in the skeleton's Target.dat,
    // so a new project starts on that panel when this installation has one:
    // the layout, the label and the file then agree from the first object.
    // Only while the project is untouched - a panel chosen, or anything drawn,
    // is the engineer's and is never moved under them.
    fetch("/api/panel")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { panel?: { model: string; width: number; height: number } | null } | null) => {
        const panel = body?.panel;
        const s = useProject.getState();
        const untouched =
          s.id === projectId &&
          s.target.model === target.model &&
          s.target.width === target.width &&
          s.target.height === target.height &&
          s.screens.length === 1 &&
          s.screens[0].Children[0].Children.length === 0;
        if (!panel || !untouched) return;
        const screen = blankScreen(panel);
        hydrate({ target: { model: panel.model, width: panel.width, height: panel.height }, screens: [screen], activeScreenId: screen.UniqueId });
      })
      .catch(() => {
        // No skeleton, or no route: the default profile stands, and the top
        // bar does not claim a file panel it cannot confirm.
      });
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
          screenPlacement: s.screenPlacement,
          handles: s.handles,
          handleSeq: s.handleSeq,
          source: s.source,
          foreign: s.foreign,
          composites: s.composites,
          programs: s.programs,
          plant: s.plant,
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
        // keep claiming "0 screens" over a project with four. Everything here
        // is a count the project already knows - the card never has to load a
        // project to describe one.
        touchProject(s.id, {
          name: s.name,
          screens: s.screens.length,
          objects: s.screens.reduce(
            (n, screen) => n + screen.Children[0].Children.length,
            0,
          ),
          tags: s.variables.length,
          alarms: s.alarms.length,
          bindings: s.bindings.length,
          target: `${s.target.model} · ${s.target.width} × ${s.target.height}`,
          intent: s.chat.find((m) => m.role === "user")?.text.slice(0, 120),
        });
      }, AUTOSAVE_MS);
    });

    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [projectId]);
}
