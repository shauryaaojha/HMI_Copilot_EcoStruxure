/**
 * The shape of a project in the store, and the types that describe editing it.
 *
 * Split out of project.ts so the slices can name the state they act on without
 * importing the store that composes them, which would be a cycle. Nothing here
 * runs: it is the vocabulary the slices and the store share.
 */


import type { ScreenProgram } from "@/lib/program/program";
import type { FreshScreen, RegenPlan } from "@/lib/program/regenerate";
import type { StateCreator } from "zustand";
import type { Alarm, Part, Screen, Variable } from "@/lib/ote/schema";
import type { Equipment, PipelineStep, StepState } from "@/types/events";
import {
  type AlignMode,
  type ZMove,
} from "./edits";
import { type CompositeKind } from "@/lib/composites";
import type { Box } from "@/lib/ote/parts";
import { type PlantModel } from "@/lib/plant/model";
import type { Range } from "@/lib/plant/units";
import type {
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
export interface EditSnapshot {
  label: string;
  screens: Screen[];
  objectMeta: Record<string, ObjectMeta>;
  screenPlacement: Record<string, ScreenPlacement>;
  activeScreenId?: string;
  selectedIds: string[];
  /**
   * Bindings and alarms too, since a conversational turn adds them alongside
   * the objects it creates and undoing the objects without the bindings left
   * references pointing at nothing.
   */
  bindings: Binding[];
  alarms: Alarm[];
  handles: Record<string, string>;
}

/**
 * What a dry run hands back to be committed as one step - docs/LLD.md F7.
 * The same slice `EditSnapshot` covers, minus the label.
 */
export type BatchPatch = Omit<EditSnapshot, "label"> & { handleSeq: number };

/** Deep enough to cover a session's editing, shallow enough to stay in memory. */
export const HISTORY_DEPTH = 60;

export interface ProjectState {
  id: string;
  name: string;
  target: { model: string; width: number; height: number };
  savedAt?: number;
  /**
   * The import id of the .eote this project was opened from, when it was.
   * Export writes back into that file's entries rather than the skeleton, so
   * everything the reader did not model survives. docs/PLAN_PHASE1.md.
   */
  source?: string;
  /** Original upload retained even when a legacy project exports by conversion. */
  sourceId?: string;
  layout?: "typed" | "struct";

  screens: Screen[];
  activeScreenId?: string;
  /**
   * Objects the reader carried rather than modelled, per screen id. Drawn as
   * placeholders, listed as carried, never edited; the packager puts the
   * originals back at export. docs/PLAN_PHASE2.md item 1.
   */
  foreign: Record<string, ForeignPart[]>;
  /** Composite instances by id (= the group id their parts carry). */
  composites: Record<string, CompositeInstance>;
  /**
   * The recipe each generated screen was compiled from, by screen UniqueId,
   * so it can be regenerated alone as a diff (lib/program/regenerate.ts).
   * A screen drawn by hand or imported has none.
   */
  programs: Record<string, ScreenProgram>;
  /** What the plant is. Built from the tags; corrected here. docs/ARCHITECTURE_SCREEN_QUALITY.md §3.1. */
  plant?: PlantModel;
  variables: Variable[];
  alarms: Alarm[];
  bindings: Binding[];
  equipment: Equipment[];
  findings: Finding[];
  /** Editing state the .eote has no field for, keyed by object UniqueId. */
  objectMeta: Record<string, ObjectMeta>;
  /** Where each screen has been dragged to on the board, keyed by screen id. */
  screenPlacement: Record<string, ScreenPlacement>;
  /**
   * Short stable handles - `o17` for an object, `s2` for a screen - keyed by
   * UniqueId. The conversation addresses things by these rather than by name,
   * because a name changes when it collides and a handle never does. Allocated
   * once, never reused. docs/LLD.md F2.
   */
  handles: Record<string, string>;
  handleSeq: number;

  selectedIds: string[];
  hoveredId?: string;
  simulating: boolean;
  /**
   * A pending conversational proposal, drawn as ghosts on the canvas: what
   * would be added, removed or moved if the engineer accepts. Never part of
   * the project; cleared on accept, discard or the next turn. docs/PLAN_PHASE1.md item 4.
   */
  preview?: Preview;

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
  setPreview: (preview?: Preview) => void;

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
  /**
   * Lift screens out of another project into this one. Fresh ids, unique
   * names, missing tags added, bindings re-pointed by tag name; a binding to
   * a tag neither project has is dropped and named in the report. One undo
   * step. docs/PLAN_PHASE2.md item 2.
   */
  importScreens: (incoming: ScreenImport) => ImportReport;
  /**
   * Bring one screen (the active one by default) onto the Standard pack:
   * every colour that is not a token becomes the token for its role, every
   * font rises to the floor. One undo step; returns the per-object diff.
   * docs/ARCHITECTURE_SCREEN_QUALITY.md §3.2.
   */
  applyStandard: (screenId?: string) => string[];

  /* --- composites ---------------------------------------------------- */
  /** Expand a composite onto a screen; its parts land grouped and bound. Returns the instance id. */
  addComposite: (screenId: string, kind: CompositeKind, props: Record<string, unknown>, box: Box, name?: string) => string;
  /** Change props and re-expand in place: same screen, same paint index, same box. */
  setCompositeProps: (id: string, patch: Record<string, unknown>) => void;
  /** Adopt parts already on a screen (the generator's) as a composite instance. */
  registerComposite: (instance: CompositeInstance) => void;

  /* --- regeneration --------------------------------------------------- */
  /** Keep the recipe a generated screen was compiled from. */
  setProgram: (viewBoxId: string, program: ScreenProgram) => void;
  /** Record that the generator placed this object, under this key. */
  markGenerated: (id: string, key: string) => void;
  /**
   * Apply the accepted units of a regeneration plan to one screen, as one
   * undoable step. Returns what happened.
   */
  applyRegeneration: (
    screenId: string,
    fresh: FreshScreen,
    plan: RegenPlan,
    accepted: string[],
    program: ScreenProgram,
  ) => { added: number; updated: number; removed: number };

  /* --- the plant model ---------------------------------------------- */
  setPlant: (model: PlantModel | undefined) => void;
  /** Answer the modeller's question; the model is rebuilt with the answer kept. */
  answerQuestion: (id: string, answer: string) => void;
  setRange: (equipmentId: string, tag: string, patch: Partial<Range>) => void;
  connect: (from: string, to: string) => void;
  disconnect: (from: string, to: string) => void;

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

  /**
   * Rebuild every generated navigation strip so it lists every screen. An
   * extension adds screens the older strips do not know about.
   */
  refreshNavigation: () => void;

  /* --- history ------------------------------------------------------- */
  undo: () => void;
  redo: () => void;
  /**
   * Replace the editable slice in one undoable step. This is how a
   * conversational turn lands: the ops ran on a scratch store, and the result
   * is committed whole, so a ten-op turn is one undo rather than ten.
   */
  commitBatch: (label: string, patch: BatchPatch) => void;

  importTags: (variables: Variable[], meta: TagImport) => void;
  /**
   * The real tags arrive in a project drawn against placeholders: each
   * placeholder in `renames` becomes its real tag everywhere it is used, and
   * the rest are unbound, their objects keeping the placeholder as an intent
   * for the binder. Not an undo step, like importTags: undo does not hold tags.
   */
  adoptTags: (variables: Variable[], meta: TagImport, renames: Record<string, string>) => void;
  setStandards: (patch: Partial<Standards>) => void;
  snapshot: (description: string) => number;
  restore: (at: number) => void;
  ensureScreen: (viewBoxId: string, name: string) => void;
  appendToView: (viewBoxId: string, part: Part) => void;
  setStep: (step: PipelineStep, state: StepState, detail?: string) => void;
  attribute: (step: PipelineStep, id: string) => void;
  setGenerating: (on: boolean) => void;
  addBinding: (binding: Binding) => void;
  /**
   * Bind one property of one object to a tag, replacing whatever drove it
   * before; null unbinds. One undo step, like any other edit - a binding is
   * part of the editable slice, so undo puts the old tag back.
   */
  setBinding: (targetId: string, property: string, tag: string | null) => void;
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

export const NO_STEPS = {} as Record<PipelineStep, StepState>;

export type ProjectActions = Pick<
  ProjectState,
  | "hydrate" | "rename" | "setTarget" | "markSaved" | "select" | "selectAll"
  | "hover" | "setSimulating" | "setPreview" | "addScreen" | "duplicateScreen" | "renameScreen"
  | "removeScreen" | "setActiveScreen" | "reorderScreens" | "placeScreen"
  | "tidyBoard" | "importScreens" | "applyStandard" | "addComposite" | "setCompositeProps"
  | "registerComposite" | "setProgram" | "markGenerated" | "applyRegeneration" | "setPlant" | "answerQuestion" | "setRange" | "connect" | "disconnect"
  | "appendObject"
  | "updateObject" | "setProperty" | "nudge" | "setBox" | "removeObjects"
  | "duplicateObjects" | "copyObjects" | "cutObjects" | "pasteObjects" | "align"
  | "spread" | "restackObjects" | "setMeta" | "group" | "ungroup" | "undo"
  | "redo" | "commitBatch" | "refreshNavigation" | "importTags" | "setStandards" | "snapshot" | "restore"
  | "ensureScreen" | "appendToView" | "setStep" | "attribute" | "setGenerating"
  | "addBinding" | "setBinding" | "addAlarm" | "addFinding" | "setEquipment" | "log"
  | "addMessage" | "patchMessage" | "clearChat" | "reset" | "resetRun"
>;


/** The immer draft every action receives. */
export type Draft = ProjectState;

/**
 * One domain's actions, as Zustand composes them.
 *
 * Each slice is a function of the same `set` and `get` the single store owns,
 * so the slices are a way of arranging one store's code rather than several
 * stores. Undo, collaboration and the op log still see one history, which is
 * the property docs/PLAN_SERVICE_SPLIT.md asks the split to preserve.
 */
export type SliceOf<T> = StateCreator<ProjectState, [["zustand/immer", never]], [], T>;
