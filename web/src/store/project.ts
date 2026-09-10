/**
 * The project the workspace is editing. One JSON tree, real undo, real history.
 *
 * The store holds exactly what the packager needs, plus the editing state the
 * .eote has no room for (selection, lock, hide, group) kept deliberately beside
 * the parts rather than inside them - see ObjectMeta in ./types. Phase 3 of
 * docs/BUILD_PLAN.md, extended for the editor phases.
 */

import { create } from "zustand";
import { current } from "immer";
import { immer } from "zustand/middleware/immer";
import type { Alarm, Part, Screen, Variable } from "@/lib/ote/schema";
import type { Equipment, PipelineStep, StepState } from "@/types/events";
import {
  alignTo,
  clonePartsInto,
  distribute,
  restack,
  uniqueName,
  type AlignMode,
  type ZMove,
} from "./edits";
import { DEFAULT_STANDARDS } from "./types";
import type {
  Binding,
  ChatMessage,
  Finding,
  ObjectMeta,
  ScreenPlacement,
  Standards,
  TagImport,
  Version,
} from "./types";

export { DEFAULT_STANDARDS } from "./types";
export type {
  Binding,
  ChatMessage,
  Finding,
  ObjectMeta,
  Requirement,
  ScreenPlacement,
  Standards,
  TagImport,
  Version,
} from "./types";

export interface ProjectIdentity {
  id: string;
  name: string;
  target: { model: string; width: number; height: number };
}

/** What undo restores. Only the parts of the project an edit can change. */
interface EditSnapshot {
  label: string;
  screens: Screen[];
  objectMeta: Record<string, ObjectMeta>;
  screenPlacement: Record<string, ScreenPlacement>;
  activeScreenId?: string;
  selectedIds: string[];
}

/** Deep enough to cover a session's editing, shallow enough to stay in memory. */
const HISTORY_DEPTH = 60;

interface ProjectState {
  id: string;
  name: string;
  target: { model: string; width: number; height: number };
  savedAt?: number;

  screens: Screen[];
  activeScreenId?: string;
  variables: Variable[];
  alarms: Alarm[];
  bindings: Binding[];
  equipment: Equipment[];
  findings: Finding[];
  /** Editing state the .eote has no field for, keyed by object UniqueId. */
  objectMeta: Record<string, ObjectMeta>;
  /** Where each screen has been dragged to on the board, keyed by screen id. */
  screenPlacement: Record<string, ScreenPlacement>;

  selectedIds: string[];
  hoveredId?: string;
  simulating: boolean;

  /** Cut or copied parts, waiting for a paste. Survives a screen change. */
  clipboard: Part[];
  past: EditSnapshot[];
  future: EditSnapshot[];

  tagImport?: TagImport;
  standards: Standards;
  versions: Version[];
  chat: ChatMessage[];

  steps: Record<PipelineStep, StepState>;
  stepDetail: Partial<Record<PipelineStep, string>>;
  produced: Partial<Record<PipelineStep, string[]>>;
  generating: boolean;
  logs: { at: string; message: string }[];

  hydrate: (project: Partial<Omit<ProjectState, keyof ProjectActions>>) => void;
  rename: (name: string) => void;
  setTarget: (target: ProjectState["target"]) => void;
  markSaved: (at?: number) => void;
  select: (ids: string[], add?: boolean) => void;
  selectAll: () => void;
  hover: (id?: string) => void;
  setSimulating: (on: boolean) => void;

  /* --- screens, as pages -------------------------------------------- */
  addScreen: (name?: string) => string;
  duplicateScreen: (id: string) => string | undefined;
  renameScreen: (id: string, name: string) => void;
  removeScreen: (id: string) => void;
  setActiveScreen: (id: string) => void;
  reorderScreens: (from: number, to: number) => void;
  /** Put a screen's frame somewhere on the board. Undoable, like any edit. */
  placeScreen: (id: string, at: ScreenPlacement) => void;
  /** Forget every hand placement, so the automatic grid takes over again. */
  tidyBoard: () => void;

  /* --- objects ------------------------------------------------------- */
  appendObject: (screenId: string, part: Part) => void;
  updateObject: (id: string, patch: Partial<Part>) => void;
  setProperty: (id: string, path: string[], value: unknown) => void;
  nudge: (ids: string[], dx: number, dy: number) => void;
  setBox: (
    id: string,
    box: { left: number; top: number; width: number; height: number },
  ) => void;
  removeObjects: (ids: string[]) => void;
  duplicateObjects: (ids: string[]) => void;
  copyObjects: (ids: string[]) => void;
  cutObjects: (ids: string[]) => void;
  pasteObjects: () => void;
  align: (ids: string[], mode: AlignMode) => void;
  spread: (ids: string[], axis: "horizontal" | "vertical") => void;
  restackObjects: (ids: string[], move: ZMove) => void;
  setMeta: (ids: string[], patch: ObjectMeta) => void;
  group: (ids: string[]) => void;
  ungroup: (ids: string[]) => void;

  /* --- history ------------------------------------------------------- */
  undo: () => void;
  redo: () => void;

  importTags: (variables: Variable[], meta: TagImport) => void;
  setStandards: (patch: Partial<Standards>) => void;
  snapshot: (description: string) => number;
  restore: (at: number) => void;
  ensureScreen: (viewBoxId: string, name: string) => void;
  appendToView: (viewBoxId: string, part: Part) => void;
  setStep: (step: PipelineStep, state: StepState, detail?: string) => void;
  attribute: (step: PipelineStep, id: string) => void;
  setGenerating: (on: boolean) => void;
  addBinding: (binding: Binding) => void;
  addAlarm: (alarm: Alarm) => void;
  addFinding: (finding: Finding) => void;
  setEquipment: (equipment: Equipment[]) => void;
  log: (message: string) => void;

  /* --- the conversation ---------------------------------------------- */
  addMessage: (message: ChatMessage) => void;
  patchMessage: (id: string, patch: Partial<ChatMessage>) => void;
  clearChat: () => void;

  resetRun: () => void;
  reset: () => void;
}

const NO_STEPS = {} as Record<PipelineStep, StepState>;

type ProjectActions = Pick<
  ProjectState,
  | "hydrate" | "rename" | "setTarget" | "markSaved" | "select" | "selectAll"
  | "hover" | "setSimulating" | "addScreen" | "duplicateScreen" | "renameScreen"
  | "removeScreen" | "setActiveScreen" | "reorderScreens" | "placeScreen"
  | "tidyBoard" | "appendObject"
  | "updateObject" | "setProperty" | "nudge" | "setBox" | "removeObjects"
  | "duplicateObjects" | "copyObjects" | "cutObjects" | "pasteObjects" | "align"
  | "spread" | "restackObjects" | "setMeta" | "group" | "ungroup" | "undo"
  | "redo" | "importTags" | "setStandards" | "snapshot" | "restore"
  | "ensureScreen" | "appendToView" | "setStep" | "attribute" | "setGenerating"
  | "addBinding" | "addAlarm" | "addFinding" | "setEquipment" | "log"
  | "addMessage" | "patchMessage" | "clearChat" | "reset" | "resetRun"
>;

/* ---------------------------------------------------------------------- */
/* Draft helpers. `s` is always an immer draft, so anything that leaves the  */
/* draft has to go through current() first - a draft is a Proxy, and neither  */
/* structuredClone nor a second set() survives one.                          */
/* ---------------------------------------------------------------------- */

type Draft = ProjectState;

/** Record the pre-edit state so undo has somewhere to go. Clears redo. */
function remember(s: Draft, label: string) {
  s.past.push({
    label,
    screens: current(s.screens),
    objectMeta: current(s.objectMeta),
    screenPlacement: current(s.screenPlacement),
    activeScreenId: s.activeScreenId,
    selectedIds: current(s.selectedIds),
  });
  if (s.past.length > HISTORY_DEPTH) s.past.shift();
  s.future.length = 0;
}

const viewOf = (screen: Screen) => screen.Children[0];

const activeScreen = (s: Draft) =>
  s.screens.find((x) => x.UniqueId === s.activeScreenId) ?? s.screens[0];

/** Every object name in use anywhere, because bindings resolve by name. */
function takenNames(s: Draft): Set<string> {
  const names = new Set<string>();
  for (const screen of s.screens) {
    for (const part of viewOf(screen).Children) names.add(part.Name);
  }
  return names;
}

/** The screen an object lives on, since ids are unique across the project. */
function screenHolding(s: Draft, id: string): Screen | undefined {
  return s.screens.find((screen) =>
    viewOf(screen).Children.some((p) => p.UniqueId === id),
  );
}

function partsByIds(s: Draft, ids: string[]): Part[] {
  const wanted = new Set(ids);
  return s.screens.flatMap((screen) =>
    viewOf(screen).Children.filter((p) => wanted.has(p.UniqueId)),
  );
}

/**
 * The same parts, detached from the draft.
 *
 * current() takes a draft, and `filter` over a draft array returns a plain
 * array of drafts - which is not one. So the whole tree is detached first and
 * the selection taken from the result. Getting this wrong throws
 * "'current' expects a draft", from inside whatever called the action.
 */
function detachedPartsByIds(s: Draft, ids: string[]): Part[] {
  const wanted = new Set(ids);
  return current(s.screens).flatMap((screen) =>
    screen.Children[0].Children.filter((p) => wanted.has(p.UniqueId)),
  );
}

/** Locked objects ignore edits; that is the whole point of the lock. */
const editable = (s: Draft, ids: string[]) =>
  ids.filter((id) => !s.objectMeta[id]?.locked);

export const useProject = create<ProjectState>()(
  immer((set, get) => ({
    id: "",
    name: "Untitled",
    target: { model: "HMIGTO6310", width: 1024, height: 768 },
    screens: [],
    variables: [],
    alarms: [],
    bindings: [],
    equipment: [],
    findings: [],
    objectMeta: {},
    screenPlacement: {},
    selectedIds: [],
    simulating: false,
    clipboard: [],
    past: [],
    future: [],
    standards: DEFAULT_STANDARDS,
    versions: [],
    chat: [],
    steps: NO_STEPS,
    stepDetail: {},
    produced: {},
    generating: false,
    logs: [],

    hydrate: (project) =>
      set((s) => {
        Object.assign(s, project);
        s.savedAt = Date.now();
      }),

    rename: (name) =>
      set((s) => {
        s.name = name;
      }),

    setTarget: (target) =>
      set((s) => {
        s.target = target;
      }),

    markSaved: (at) =>
      set((s) => {
        s.savedAt = at ?? Date.now();
      }),

    select: (ids, add = false) =>
      set((s) => {
        if (!add) {
          s.selectedIds = ids;
          return;
        }
        for (const id of ids) {
          const at = s.selectedIds.indexOf(id);
          if (at === -1) s.selectedIds.push(id);
          else s.selectedIds.splice(at, 1);
        }
      }),

    selectAll: () =>
      set((s) => {
        const screen = activeScreen(s);
        if (!screen) return;
        s.selectedIds = viewOf(screen)
          .Children.filter((p) => !s.objectMeta[p.UniqueId]?.hidden)
          .map((p) => p.UniqueId);
      }),

    hover: (id) =>
      set((s) => {
        s.hoveredId = id;
      }),

    setSimulating: (on) =>
      set((s) => {
        s.simulating = on;
      }),

    /* --- screens ------------------------------------------------------ */

    addScreen: (name) => {
      const id = crypto.randomUUID();
      set((s) => {
        remember(s, "Add screen");
        const taken = new Set(s.screens.map((x) => x.Name));
        s.screens.push({
          Type: "Screen",
          UniqueId: id,
          Name: uniqueName(taken, name?.trim() || `Screen${s.screens.length + 1}`),
          Children: [
            {
              Type: "ViewBox",
              UniqueId: crypto.randomUUID(),
              Name: "ViewBox",
              Options: 108,
              Width: s.target.width,
              Height: s.target.height,
              Children: [],
            },
          ],
        });
        s.activeScreenId = id;
        s.selectedIds = [];
      });
      return id;
    },

    duplicateScreen: (id) => {
      const source = get().screens.find((x) => x.UniqueId === id);
      if (!source) return undefined;
      const newId = crypto.randomUUID();
      set((s) => {
        remember(s, "Duplicate screen");
        const original = s.screens.find((x) => x.UniqueId === id)!;
        const view = current(viewOf(original));
        const copy: Screen = {
          Type: "Screen",
          UniqueId: newId,
          Name: uniqueName(new Set(s.screens.map((x) => x.Name)), original.Name),
          Children: [
            {
              ...view,
              UniqueId: crypto.randomUUID(),
              Children: clonePartsInto(view.Children, takenNames(s), { dx: 0, dy: 0 }),
            },
          ],
        };
        s.screens.splice(s.screens.indexOf(original) + 1, 0, copy);
        s.activeScreenId = newId;
        s.selectedIds = [];
      });
      return newId;
    },

    renameScreen: (id, name) =>
      set((s) => {
        const screen = s.screens.find((x) => x.UniqueId === id);
        if (!screen) return;
        remember(s, "Rename screen");
        screen.Name = uniqueName(
          new Set(s.screens.filter((x) => x.UniqueId !== id).map((x) => x.Name)),
          name.trim() || screen.Name,
        );
      }),

    removeScreen: (id) =>
      set((s) => {
        // A project with no screen cannot be packaged, so the last one stays.
        if (s.screens.length <= 1) return;
        const at = s.screens.findIndex((x) => x.UniqueId === id);
        if (at === -1) return;
        remember(s, "Delete screen");
        const [gone] = s.screens.splice(at, 1);
        for (const part of viewOf(gone).Children) delete s.objectMeta[part.UniqueId];
        delete s.screenPlacement[gone.UniqueId];
        if (s.activeScreenId === id) {
          s.activeScreenId = s.screens[Math.min(at, s.screens.length - 1)].UniqueId;
        }
        s.selectedIds = [];
      }),

    setActiveScreen: (id) =>
      set((s) => {
        if (!s.screens.some((x) => x.UniqueId === id)) return;
        s.activeScreenId = id;
        s.selectedIds = [];
        s.hoveredId = undefined;
      }),

    placeScreen: (id, at) =>
      set((s) => {
        if (!s.screens.some((x) => x.UniqueId === id)) return;
        remember(s, "Move screen");
        s.screenPlacement[id] = { x: Math.round(at.x), y: Math.round(at.y) };
      }),

    tidyBoard: () =>
      set((s) => {
        if (Object.keys(s.screenPlacement).length === 0) return;
        remember(s, "Tidy board");
        s.screenPlacement = {};
      }),

    reorderScreens: (from, to) =>
      set((s) => {
        if (from === to || from < 0 || to < 0) return;
        if (from >= s.screens.length || to >= s.screens.length) return;
        remember(s, "Reorder screens");
        const [moved] = s.screens.splice(from, 1);
        s.screens.splice(to, 0, moved);
      }),

    /* --- objects ------------------------------------------------------ */

    appendObject: (screenId, part) =>
      set((s) => {
        const screen = s.screens.find((x) => x.UniqueId === screenId);
        if (!screen) return;
        remember(s, `Add ${part.Type}`);
        part.Name = uniqueName(takenNames(s), part.Name);
        viewOf(screen).Children.push(part);
      }),

    updateObject: (id, patch) =>
      set((s) => {
        const screen = screenHolding(s, id);
        if (!screen || s.objectMeta[id]?.locked) return;
        remember(s, "Edit object");
        const parts = viewOf(screen).Children;
        Object.assign(parts[parts.findIndex((p) => p.UniqueId === id)], patch);
      }),

    setProperty: (id, path, value) =>
      set((s) => {
        if (path.length === 0) return;
        const screen = screenHolding(s, id);
        if (!screen || s.objectMeta[id]?.locked) return;
        remember(s, `Set ${path.join(".")}`);
        const part = viewOf(screen).Children.find((p) => p.UniqueId === id)!;
        let node = part as unknown as Record<string, unknown>;
        for (const step of path.slice(0, -1)) {
          if (typeof node[step] !== "object" || node[step] === null) node[step] = {};
          node = node[step] as Record<string, unknown>;
        }
        node[path[path.length - 1]] = value;
      }),

    nudge: (ids, dx, dy) =>
      set((s) => {
        const wanted = new Set(editable(s, ids));
        if (wanted.size === 0) return;
        remember(s, "Move");
        for (const screen of s.screens) {
          for (const part of viewOf(screen).Children) {
            if (!wanted.has(part.UniqueId)) continue;
            part.Location.Left += dx;
            part.Location.Top += dy;
          }
        }
      }),

    setBox: (id, box) =>
      set((s) => {
        const screen = screenHolding(s, id);
        if (!screen || s.objectMeta[id]?.locked) return;
        remember(s, "Resize");
        const part = viewOf(screen).Children.find((p) => p.UniqueId === id)!;
        part.Location.Left = box.left;
        part.Location.Top = box.top;
        part.Width = box.width;
        part.Height = box.height;
      }),

    removeObjects: (ids) =>
      set((s) => {
        const wanted = new Set(editable(s, ids));
        if (wanted.size === 0) return;
        remember(s, "Delete");
        for (const screen of s.screens) {
          viewOf(screen).Children = viewOf(screen).Children.filter(
            (p) => !wanted.has(p.UniqueId),
          );
        }
        for (const id of wanted) delete s.objectMeta[id];
        s.selectedIds = s.selectedIds.filter((id) => !wanted.has(id));
        // A binding whose target is gone would export as a dangling reference.
        s.bindings = s.bindings.filter((b) => !wanted.has(b.targetId));
      }),

    duplicateObjects: (ids) =>
      set((s) => {
        const screen = activeScreen(s);
        if (!screen) return;
        const wanted = new Set(ids);
        const source = current(viewOf(screen)).Children.filter((p) =>
          wanted.has(p.UniqueId),
        );
        if (source.length === 0) return;
        remember(s, "Duplicate");
        const copies = clonePartsInto(source, takenNames(s), {
          dx: s.standards.gridSize * 2,
          dy: s.standards.gridSize * 2,
        });
        viewOf(screen).Children.push(...copies);
        s.selectedIds = copies.map((p) => p.UniqueId);
      }),

    copyObjects: (ids) =>
      set((s) => {
        const parts = detachedPartsByIds(s, ids);
        if (parts.length > 0) s.clipboard = parts;
      }),

    cutObjects: (ids) => {
      get().copyObjects(ids);
      get().removeObjects(ids);
    },

    pasteObjects: () =>
      set((s) => {
        const screen = activeScreen(s);
        if (!screen || s.clipboard.length === 0) return;
        remember(s, "Paste");
        const copies = clonePartsInto(current(s.clipboard), takenNames(s), {
          dx: s.standards.gridSize * 2,
          dy: s.standards.gridSize * 2,
        });
        viewOf(screen).Children.push(...copies);
        s.selectedIds = copies.map((p) => p.UniqueId);
      }),

    align: (ids, mode) =>
      set((s) => {
        const wanted = editable(s, ids);
        const parts = partsByIds(s, wanted);
        const screen = activeScreen(s);
        if (parts.length === 0 || !screen) return;
        remember(s, `Align ${mode}`);
        const moves = alignTo(detachedPartsByIds(s, wanted), mode, {
          width: viewOf(screen).Width,
          height: viewOf(screen).Height,
        });
        for (const part of parts) {
          const to = moves.get(part.UniqueId);
          if (!to) continue;
          part.Location.Left = to.left;
          part.Location.Top = to.top;
        }
      }),

    spread: (ids, axis) =>
      set((s) => {
        const wanted = editable(s, ids);
        const parts = partsByIds(s, wanted);
        if (parts.length < 3) return;
        remember(s, `Distribute ${axis}`);
        const moves = distribute(detachedPartsByIds(s, wanted), axis);
        for (const part of parts) {
          const to = moves.get(part.UniqueId);
          if (!to) continue;
          part.Location.Left = to.left;
          part.Location.Top = to.top;
        }
      }),

    restackObjects: (ids, move) =>
      set((s) => {
        const screen = activeScreen(s);
        if (!screen || ids.length === 0) return;
        remember(s, `Send ${move}`);
        viewOf(screen).Children = restack(current(viewOf(screen)).Children, ids, move);
      }),

    setMeta: (ids, patch) =>
      set((s) => {
        if (ids.length === 0) return;
        remember(s, "Object state");
        for (const id of ids) {
          const meta = (s.objectMeta[id] ??= {});
          Object.assign(meta, patch);
          // An empty record is noise in the save file.
          if (!meta.locked && !meta.hidden && !meta.groupId) delete s.objectMeta[id];
        }
      }),

    group: (ids) =>
      set((s) => {
        if (ids.length < 2) return;
        remember(s, "Group");
        const groupId = crypto.randomUUID();
        for (const id of ids) (s.objectMeta[id] ??= {}).groupId = groupId;
      }),

    ungroup: (ids) =>
      set((s) => {
        const groups = new Set(
          ids.map((id) => s.objectMeta[id]?.groupId).filter(Boolean) as string[],
        );
        if (groups.size === 0) return;
        remember(s, "Ungroup");
        for (const [id, meta] of Object.entries(s.objectMeta)) {
          if (!meta.groupId || !groups.has(meta.groupId)) continue;
          delete meta.groupId;
          if (!meta.locked && !meta.hidden) delete s.objectMeta[id];
        }
      }),

    /* --- history ------------------------------------------------------ */

    undo: () =>
      set((s) => {
        const previous = s.past.pop();
        if (!previous) return;
        s.future.push({
          label: previous.label,
          screens: current(s.screens),
          objectMeta: current(s.objectMeta),
          screenPlacement: current(s.screenPlacement),
          activeScreenId: s.activeScreenId,
          selectedIds: current(s.selectedIds),
        });
        s.screens = previous.screens;
        s.objectMeta = previous.objectMeta;
        s.screenPlacement = previous.screenPlacement;
        s.activeScreenId = previous.activeScreenId;
        s.selectedIds = previous.selectedIds;
      }),

    redo: () =>
      set((s) => {
        const next = s.future.pop();
        if (!next) return;
        s.past.push({
          label: next.label,
          screens: current(s.screens),
          objectMeta: current(s.objectMeta),
          screenPlacement: current(s.screenPlacement),
          activeScreenId: s.activeScreenId,
          selectedIds: current(s.selectedIds),
        });
        s.screens = next.screens;
        s.objectMeta = next.objectMeta;
        s.screenPlacement = next.screenPlacement;
        s.activeScreenId = next.activeScreenId;
        s.selectedIds = next.selectedIds;
      }),

    importTags: (variables, meta) =>
      set((s) => {
        s.variables = variables;
        s.tagImport = meta;
      }),

    setStandards: (patch) =>
      set((s) => {
        Object.assign(s.standards, patch);
      }),

    snapshot: (description) => {
      const at = Date.now();
      set((s) => {
        // current() before copying, because `s` is an immer draft and a draft
        // is a Proxy - structuredClone throws "could not be cloned" on one, and
        // it throws from inside whatever applied the event, which is a long way
        // from where it reads. current() returns a detached plain snapshot, so
        // the version cannot follow later edits either.
        s.versions.unshift({
          at,
          description,
          author: "You",
          screens: current(s.screens),
          variables: current(s.variables),
          alarms: current(s.alarms),
          bindings: current(s.bindings),
        });
        if (s.versions.length > 20) s.versions.length = 20;
      });
      return at;
    },

    restore: (at) =>
      set((s) => {
        const version = s.versions.find((v) => v.at === at);
        if (!version) return;
        remember(s, "Restore version");
        // Same reason: `version` is read out of the draft, so its arrays are
        // drafts too. current() detaches them before they become live state.
        s.screens = current(version.screens);
        s.variables = current(version.variables);
        s.alarms = current(version.alarms);
        s.bindings = current(version.bindings);
        s.activeScreenId = s.screens[0]?.UniqueId;
        s.selectedIds = [];
        s.findings = [];
      }),

    ensureScreen: (viewBoxId, name) =>
      set((s) => {
        if (s.screens.some((screen) => viewOf(screen).UniqueId === viewBoxId)) return;
        const screen: Screen = {
          Type: "Screen",
          UniqueId: crypto.randomUUID(),
          Name: uniqueName(new Set(s.screens.map((x) => x.Name)), name),
          Children: [
            {
              Type: "ViewBox",
              UniqueId: viewBoxId,
              Name: name,
              Width: s.target.width,
              Height: s.target.height,
              Children: [],
            },
          ],
        };
        s.screens.push(screen);
        s.activeScreenId = screen.UniqueId;
      }),

    appendToView: (viewBoxId, part) =>
      set((s) => {
        for (const screen of s.screens) {
          if (viewOf(screen).UniqueId !== viewBoxId) continue;
          viewOf(screen).Children.push(part);
          return;
        }
      }),

    setStep: (step, state, detail) =>
      set((s) => {
        s.steps[step] = state;
        if (detail !== undefined) s.stepDetail[step] = detail;
      }),

    attribute: (step, id) =>
      set((s) => {
        (s.produced[step] ??= []).push(id);
      }),

    setGenerating: (on) =>
      set((s) => {
        s.generating = on;
      }),

    addBinding: (binding) =>
      set((s) => {
        s.bindings.push(binding);
      }),

    addAlarm: (alarm) =>
      set((s) => {
        s.alarms.push(alarm);
      }),

    addFinding: (finding) =>
      set((s) => {
        s.findings.push(finding);
      }),

    setEquipment: (equipment) =>
      set((s) => {
        s.equipment = equipment;
      }),

    log: (message) =>
      set((s) => {
        s.logs.push({
          at: new Date().toLocaleTimeString("en-GB", { hour12: false }),
          message,
        });
      }),

    /* --- the conversation --------------------------------------------- */

    addMessage: (message) =>
      set((s) => {
        s.chat.push(message);
      }),

    patchMessage: (id, patch) =>
      set((s) => {
        const message = s.chat.find((m) => m.id === id);
        if (message) Object.assign(message, patch);
      }),

    clearChat: () =>
      set((s) => {
        s.chat = [];
      }),

    /**
     * A new build replaces the generated project but keeps the tags, the
     * conversation and the versions - those are the engineer's, not the run's.
     */
    resetRun: () =>
      set((s) => {
        s.screens = [];
        s.activeScreenId = undefined;
        s.alarms = [];
        s.bindings = [];
        s.equipment = [];
        s.findings = [];
        s.objectMeta = {};
        s.screenPlacement = {};
        s.selectedIds = [];
        s.hoveredId = undefined;
        s.steps = {} as Record<PipelineStep, StepState>;
        s.stepDetail = {};
        s.produced = {};
        s.logs = [];
        s.past = [];
        s.future = [];
      }),

    reset: () =>
      set((s) => {
        s.screens = [];
        s.variables = [];
        s.alarms = [];
        s.bindings = [];
        s.equipment = [];
        s.findings = [];
        s.objectMeta = {};
        s.screenPlacement = {};
        s.selectedIds = [];
        s.hoveredId = undefined;
        s.clipboard = [];
        s.past = [];
        s.future = [];
        s.steps = {} as Record<PipelineStep, StepState>;
        s.stepDetail = {};
        s.produced = {};
        s.generating = false;
        s.tagImport = undefined;
        s.versions = [];
        s.chat = [];
        s.logs = [];
      }),
  })),
);
