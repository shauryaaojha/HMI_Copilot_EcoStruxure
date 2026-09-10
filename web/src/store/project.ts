/**
 * The project the workspace is editing. One JSON tree, cheap undo/redo.
 *
 * The store holds exactly what the packager needs and nothing else - if a field
 * is not in here, it does not reach the .eote. Phase 3 of docs/BUILD_PLAN.md.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Alarm, Part, Screen, Variable } from "@/lib/ote/schema";
import type { Equipment, PipelineStep, StepState } from "@/types/events";

export interface Binding {
  tag: string;
  targetId: string;
  targetName: string;
  property: string;
}

/** Everything a project supplies to the chrome. Nothing here is hardcoded in a
 *  component - the top bar reads it, so an empty store shows an empty top bar. */
export interface ProjectIdentity {
  id: string;
  name: string;
  target: { model: string; width: number; height: number };
}

export interface Finding {
  severity: "error" | "warning" | "info";
  message: string;
  objectId?: string;
  suggestion?: string;
}

interface ProjectState {
  id: string;
  name: string;
  target: { model: string; width: number; height: number };
  /** Epoch ms of the last autosave, or undefined when never saved. */
  savedAt?: number;

  screens: Screen[];
  activeScreenId?: string;
  variables: Variable[];
  alarms: Alarm[];
  bindings: Binding[];
  equipment: Equipment[];
  findings: Finding[];

  /** UniqueIds of the selected objects. Marquee select makes this plural. */
  selectedIds: string[];
  /** UniqueId under the pointer, for the canvas hover highlight. */
  hoveredId?: string;
  /** Live values by object name; empty means the design state. */
  values: Record<string, number | boolean>;
  simulating: boolean;

  steps: Record<PipelineStep, StepState>;
  logs: { at: string; message: string }[];

  /** Replace the whole project. The workspace calls this once on mount. */
  hydrate: (project: Partial<Omit<ProjectState, keyof ProjectActions>>) => void;
  rename: (name: string) => void;
  setTarget: (target: ProjectState["target"]) => void;
  markSaved: () => void;
  /** Replace the selection. `add` extends it instead, for shift-click. */
  select: (ids: string[], add?: boolean) => void;
  hover: (id?: string) => void;
  /** Live drives values from the simulator; design shows the authored state. */
  setSimulating: (on: boolean) => void;
  appendObject: (screenId: string, part: Part) => void;
  updateObject: (id: string, patch: Partial<Part>) => void;
  /** Move objects by a delta, which is what dragging on the canvas produces. */
  nudge: (ids: string[], dx: number, dy: number) => void;
  /** Set an object's box outright, which is what a resize handle produces. */
  setBox: (
    id: string,
    box: { left: number; top: number; width: number; height: number },
  ) => void;
  removeObjects: (ids: string[]) => void;
  setStep: (step: PipelineStep, state: StepState) => void;
  log: (message: string) => void;
  reset: () => void;
}

const NO_STEPS = {} as Record<PipelineStep, StepState>;

/** The action half of the store, so `hydrate` can exclude it by type. */
type ProjectActions = Pick<
  ProjectState,
  | "hydrate"
  | "rename"
  | "setTarget"
  | "markSaved"
  | "select"
  | "hover"
  | "setSimulating"
  | "appendObject"
  | "updateObject"
  | "nudge"
  | "setBox"
  | "removeObjects"
  | "setStep"
  | "log"
  | "reset"
>;

export const useProject = create<ProjectState>()(
  immer((set) => ({
    id: "",
    name: "Untitled",
    target: { model: "HMIGTO6310", width: 1024, height: 768 },
    screens: [],
    variables: [],
    alarms: [],
    bindings: [],
    equipment: [],
    findings: [],
    selectedIds: [],
    values: {},
    simulating: false,
    steps: NO_STEPS,
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

    markSaved: () =>
      set((s) => {
        s.savedAt = Date.now();
      }),

    select: (ids, add = false) =>
      set((s) => {
        if (!add) {
          s.selectedIds = ids;
          return;
        }
        // Shift-click toggles, so a second click on a selected object drops it.
        for (const id of ids) {
          const at = s.selectedIds.indexOf(id);
          if (at === -1) s.selectedIds.push(id);
          else s.selectedIds.splice(at, 1);
        }
      }),

    hover: (id) =>
      set((s) => {
        s.hoveredId = id;
      }),

    setSimulating: (on) =>
      set((s) => {
        s.simulating = on;
        if (!on) s.values = {};
      }),

    appendObject: (screenId, part) =>
      set((s) => {
        const screen = s.screens.find((x) => x.UniqueId === screenId);
        screen?.Children[0].Children.push(part);
      }),

    updateObject: (id, patch) =>
      set((s) => {
        for (const screen of s.screens) {
          const i = screen.Children[0].Children.findIndex((p) => p.UniqueId === id);
          if (i !== -1) {
            Object.assign(screen.Children[0].Children[i], patch);
            return;
          }
        }
      }),

    nudge: (ids, dx, dy) =>
      set((s) => {
        const wanted = new Set(ids);
        for (const screen of s.screens) {
          for (const part of screen.Children[0].Children) {
            if (!wanted.has(part.UniqueId)) continue;
            part.Location.Left += dx;
            part.Location.Top += dy;
          }
        }
      }),

    setBox: (id, box) =>
      set((s) => {
        for (const screen of s.screens) {
          const part = screen.Children[0].Children.find((p) => p.UniqueId === id);
          if (!part) continue;
          part.Location.Left = box.left;
          part.Location.Top = box.top;
          part.Width = box.width;
          part.Height = box.height;
          return;
        }
      }),

    removeObjects: (ids) =>
      set((s) => {
        const wanted = new Set(ids);
        for (const screen of s.screens) {
          screen.Children[0].Children = screen.Children[0].Children.filter(
            (p) => !wanted.has(p.UniqueId),
          );
        }
        s.selectedIds = s.selectedIds.filter((id) => !wanted.has(id));
      }),

    setStep: (step, state) =>
      set((s) => {
        s.steps[step] = state;
      }),

    log: (message) =>
      set((s) => {
        s.logs.push({
          at: new Date().toLocaleTimeString("en-GB", { hour12: false }),
          message,
        });
      }),

    reset: () =>
      set((s) => {
        s.screens = [];
        s.variables = [];
        s.alarms = [];
        s.bindings = [];
        s.equipment = [];
        s.findings = [];
        s.selectedIds = [];
        s.hoveredId = undefined;
        s.values = {};
        s.steps = {} as Record<PipelineStep, StepState>;
        s.logs = [];
      }),
  })),
);
