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

/** Mirrors lib/validation/rules.ts, which is what /api/validate returns. */
/**
 * Company standards. These are not decoration: the grid the canvas draws and
 * snaps to comes from here, and so does the colour set every part resolves its
 * palette indices through. Changing a standard changes the screens.
 */
export interface Standards {
  /** Canvas grid pitch in screen units, and the snap increment. */
  gridSize: number;
  showGrid: boolean;
  snap: boolean;
  /** Index into lib/ote/palette.ts COLOR_SETS. */
  colorSet: number;
  /** Enforced by lib/validation/naming.ts at import and at validation. */
  enforceNaming: boolean;
}

export const DEFAULT_STANDARDS: Standards = {
  gridSize: 8,
  showGrid: false,
  snap: true,
  colorSet: 4,
  enforceNaming: true,
};

/**
 * One point in the project's history - reference screen 10.
 *
 * A snapshot of everything a generation or an edit can change, so restoring one
 * puts the project back exactly, bindings and all. Not undo/redo: these are
 * versions the engineer can name and return to.
 */
export interface Version {
  at: number;
  description: string;
  author: string;
  screens: Screen[];
  variables: Variable[];
  alarms: Alarm[];
  bindings: Binding[];
}

export interface Finding {
  severity: "error" | "warning" | "info";
  /** Which rule fired, for grouping in the UI. */
  rule?: string;
  message: string;
  /** UniqueId of the offending screen object, when there is one. */
  objectId?: string;
  /** Tag name, when the finding is about a variable. */
  tag?: string;
  suggestion?: string;
}

/**
 * What an import of a tag export left behind, beyond the variables themselves.
 *
 * Corrections and skipped rows are kept rather than discarded because
 * lib/tags/parse.ts reports them instead of applying them silently, and an
 * import that quietly drops a bad row is the behaviour this product replaces.
 */
export interface TagImport {
  fileName: string;
  at: number;
  corrections: { from: string; to: string; reason: string }[];
  skipped: { row: number; value: string; reason: string }[];
  summary: { total: number } & Partial<Record<string, number>>;
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
  /**
   * Live is a mode, not a value: the values themselves come from the engine in
   * lib/sim, keyed by tag, and are projected onto objects through the project's
   * own bindings. Keeping a copy here would be a second source of truth.
   */
  simulating: boolean;

  tagImport?: TagImport;
  standards: Standards;
  versions: Version[];

  steps: Record<PipelineStep, StepState>;
  /** The engineering-language note under each step, e.g. "2 pumps detected". */
  stepDetail: Partial<Record<PipelineStep, string>>;
  /** UniqueIds each step produced, so a step can highlight its own output. */
  produced: Partial<Record<PipelineStep, string[]>>;
  /** Non-empty while a generation run is in flight. */
  generating: boolean;
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
  /**
   * Write one property, addressed the way the inspector's schema-derived
   * fields address them: ["Off", "Fill", "Color", "Value"]. Intermediate
   * objects are created, so setting an optional property that is absent works.
   */
  setProperty: (id: string, path: string[], value: unknown) => void;
  /** Move objects by a delta, which is what dragging on the canvas produces. */
  nudge: (ids: string[], dx: number, dy: number) => void;
  /** Set an object's box outright, which is what a resize handle produces. */
  setBox: (
    id: string,
    box: { left: number; top: number; width: number; height: number },
  ) => void;
  removeObjects: (ids: string[]) => void;
  importTags: (variables: Variable[], meta: TagImport) => void;
  setStandards: (patch: Partial<Standards>) => void;
  /** Record the current project as a version, for reference screen 10. */
  snapshot: (description: string) => void;
  restore: (at: number) => void;
  /**
   * Make sure a screen exists whose ViewBox has this id, so the first `object`
   * event of a run has somewhere to land. The event contract carries a
   * parentId but no "screen created" event, so the screen is implied by the
   * first object that names it.
   */
  ensureScreen: (viewBoxId: string, name: string) => void;
  /** Append into the ViewBox with this id, which is what `object` events name. */
  appendToView: (viewBoxId: string, part: Part) => void;
  setStep: (step: PipelineStep, state: StepState, detail?: string) => void;
  /** Record that a step produced an object, for click-to-highlight. */
  attribute: (step: PipelineStep, id: string) => void;
  setGenerating: (on: boolean) => void;
  addBinding: (binding: Binding) => void;
  addAlarm: (alarm: Alarm) => void;
  addFinding: (finding: Finding) => void;
  setEquipment: (equipment: Equipment[]) => void;
  log: (message: string) => void;
  /** Clear only what a generation run produces, leaving tags and settings. */
  resetRun: () => void;
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
  | "setProperty"
  | "nudge"
  | "setBox"
  | "removeObjects"
  | "importTags"
  | "setStandards"
  | "snapshot"
  | "restore"
  | "ensureScreen"
  | "appendToView"
  | "setStep"
  | "attribute"
  | "setGenerating"
  | "addBinding"
  | "addAlarm"
  | "addFinding"
  | "setEquipment"
  | "log"
  | "reset"
  | "resetRun"
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
    simulating: false,
    standards: DEFAULT_STANDARDS,
    versions: [],
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

    setProperty: (id, path, value) =>
      set((s) => {
        if (path.length === 0) return;
        for (const screen of s.screens) {
          const part = screen.Children[0].Children.find((p) => p.UniqueId === id);
          if (!part) continue;
          let node = part as unknown as Record<string, unknown>;
          for (const step of path.slice(0, -1)) {
            if (typeof node[step] !== "object" || node[step] === null) node[step] = {};
            node = node[step] as Record<string, unknown>;
          }
          node[path[path.length - 1]] = value;
          return;
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

    importTags: (variables, meta) =>
      set((s) => {
        s.variables = variables;
        s.tagImport = meta;
      }),

    setStandards: (patch) =>
      set((s) => {
        Object.assign(s.standards, patch);
      }),

    snapshot: (description) =>
      set((s) => {
        // Structured clone rather than a reference: the store is mutable under
        // immer, so a shallow copy would follow every later edit.
        s.versions.unshift({
          at: Date.now(),
          description,
          author: "You",
          screens: structuredClone(s.screens),
          variables: structuredClone(s.variables),
          alarms: structuredClone(s.alarms),
          bindings: structuredClone(s.bindings),
        });
        // Twenty is enough to demo with and cheap enough to keep in memory.
        if (s.versions.length > 20) s.versions.length = 20;
      }),

    restore: (at) =>
      set((s) => {
        const version = s.versions.find((v) => v.at === at);
        if (!version) return;
        s.screens = structuredClone(version.screens);
        s.variables = structuredClone(version.variables);
        s.alarms = structuredClone(version.alarms);
        s.bindings = structuredClone(version.bindings);
        s.activeScreenId = s.screens[0]?.UniqueId;
        s.selectedIds = [];
        s.findings = [];
      }),

    ensureScreen: (viewBoxId, name) =>
      set((s) => {
        if (s.screens.some((screen) => screen.Children[0].UniqueId === viewBoxId)) return;
        const screen: Screen = {
          Type: "Screen",
          UniqueId: crypto.randomUUID(),
          Name: name,
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
          if (screen.Children[0].UniqueId !== viewBoxId) continue;
          screen.Children[0].Children.push(part);
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

    /** A new run replaces the generated project but keeps the imported tags. */
    resetRun: () =>
      set((s) => {
        s.screens = [];
        s.activeScreenId = undefined;
        s.alarms = [];
        s.bindings = [];
        s.equipment = [];
        s.findings = [];
        s.selectedIds = [];
        s.hoveredId = undefined;
        s.steps = {} as Record<PipelineStep, StepState>;
        s.stepDetail = {};
        s.produced = {};
        s.logs = [];
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
        s.steps = {} as Record<PipelineStep, StepState>;
        s.stepDetail = {};
        s.produced = {};
        s.generating = false;
        s.tagImport = undefined;
        s.versions = [];
        s.logs = [];
      }),
  })),
);
