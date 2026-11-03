/**
 * The project the workspace is editing. One JSON tree, real undo, real history.
 *
 * The store holds exactly what the packager needs, plus the editing state the
 * .eote has no room for (selection, lock, hide, group) kept deliberately beside
 * the parts rather than inside them - see ObjectMeta in ./types. Phase 3 of
 * docs/BUILD_PLAN.md, extended for the editor phases.
 *
 * The actions live in ./slices, one file per domain, and are composed here into
 * **one** store. That matters: undo is a stack on this state, collaboration is
 * a diff of this state, and the op log is an ordering over it. Five stores
 * would need all three shared over a seam; five slices of one store do not.
 * docs/PLAN_SERVICE_SPLIT.md, "Store split".
 *
 * What stays here is what no single domain owns: the project's identity, the
 * selection, the undo stack, and the state defaults every slice acts on.
 */


import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { PipelineStep, StepState } from "@/types/events";
import { DEFAULT_STANDARDS} from "./types";
import { DEFAULT_PANEL } from "@/lib/backend/panels";


import {
  NO_STEPS,
  type ProjectState,
} from "./state";
import {
  activeScreen,
  editable_slice,
  ensureHandles,
  remember,
  restoreSlice,
  viewOf,
} from "./internals";
import { createScreensSlice } from "./slices/screens";
import { createObjectsSlice } from "./slices/objects";
import { createTagsSlice } from "./slices/tags";
import { createAlarmsSlice } from "./slices/alarms";
import { createCollabSlice } from "./slices/collab";

export { DEFAULT_STANDARDS } from "./types";
export { sameCondition } from "./internals";
export type { BatchPatch, ProjectIdentity, ProjectState } from "./state";
export type {
  Binding,
  ChatMessage,
  CompositeInstance,
  Finding,
  ForeignPart,
  ImportReport,
  ObjectMeta,
  Preview,
  ScreenImport,
  ScreenPlacement,
  Standards,
  TagImport,
  Version,
} from "./types";

/**
 * A factory rather than a singleton, so a conversational turn can run its ops
 * on a scratch instance and commit the result whole. The application uses the
 * one instance exported below; docs/LLD.md F7 uses a second.
 */
export function createProjectStore() {
  return create<ProjectState>()(
  immer((set, get, store) => ({
    id: "",
    name: "Untitled",
    target: { model: DEFAULT_PANEL.model, width: DEFAULT_PANEL.width, height: DEFAULT_PANEL.height },
    screens: [],
    variables: [],
    alarms: [],
    bindings: [],
    equipment: [],
    findings: [],
    objectMeta: {},
    screenPlacement: {},
    handles: {},
    handleSeq: 0,
    foreign: {},
    composites: {},
    programs: {},
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

    ...createScreensSlice(set, get, store),
    ...createObjectsSlice(set, get, store),
    ...createTagsSlice(set, get, store),
    ...createAlarmsSlice(set, get, store),
    ...createCollabSlice(set, get, store),

    hydrate: (project) =>
      set((s) => {
        Object.assign(s, project);
        s.savedAt = Date.now();
        ensureHandles(s);
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

    setPreview: (preview) =>
      set((s) => {
        s.preview = preview;
      }),

    /* --- screens ------------------------------------------------------ */

    undo: () =>
      set((s) => {
        const previous = s.past.pop();
        if (!previous) return;
        s.future.push(editable_slice(s, previous.label));
        restoreSlice(s, previous);
      }),

    redo: () =>
      set((s) => {
        const next = s.future.pop();
        if (!next) return;
        s.past.push(editable_slice(s, next.label));
        restoreSlice(s, next);
      }),

    commitBatch: (label, patch) =>
      set((s) => {
        remember(s, label);
        restoreSlice(s, { label, ...patch });
        s.handleSeq = Math.max(s.handleSeq, patch.handleSeq);
        ensureHandles(s);
      }),

    setStandards: (patch) =>
      set((s) => {
        Object.assign(s.standards, patch);
      }),

    reset: () =>
      set((s) => {
        s.source = undefined;
        s.sourceId = undefined;
        s.layout = undefined;
        s.screens = [];
        s.foreign = {};
        s.composites = {};
        s.programs = {};
        s.plant = undefined;
        s.variables = [];
        s.alarms = [];
        s.bindings = [];
        s.equipment = [];
        s.findings = [];
        s.objectMeta = {};
        s.programs = {};
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
}

export type ProjectStore = ReturnType<typeof createProjectStore>;

/** The application's one project. Everything on screen reads from here. */
export const useProject = createProjectStore();
