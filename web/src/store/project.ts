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
import { applyPack } from "@/lib/standard/apply";
import { expandComposite, propsFor, unionBox, type CompositeKind } from "@/lib/composites";
import type { Box } from "@/lib/ote/parts";
import { modelPlant, type PlantModel } from "@/lib/plant/model";
import type { Range } from "@/lib/plant/units";
import { refreshNavigation as refreshNavigationParts } from "@/lib/ote/layout";
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
interface EditSnapshot {
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
const HISTORY_DEPTH = 60;

interface ProjectState {
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

const NO_STEPS = {} as Record<PipelineStep, StepState>;

type ProjectActions = Pick<
  ProjectState,
  | "hydrate" | "rename" | "setTarget" | "markSaved" | "select" | "selectAll"
  | "hover" | "setSimulating" | "setPreview" | "addScreen" | "duplicateScreen" | "renameScreen"
  | "removeScreen" | "setActiveScreen" | "reorderScreens" | "placeScreen"
  | "tidyBoard" | "importScreens" | "applyStandard" | "addComposite" | "setCompositeProps"
  | "registerComposite" | "setPlant" | "answerQuestion" | "setRange" | "connect" | "disconnect"
  | "appendObject"
  | "updateObject" | "setProperty" | "nudge" | "setBox" | "removeObjects"
  | "duplicateObjects" | "copyObjects" | "cutObjects" | "pasteObjects" | "align"
  | "spread" | "restackObjects" | "setMeta" | "group" | "ungroup" | "undo"
  | "redo" | "commitBatch" | "refreshNavigation" | "importTags" | "setStandards" | "snapshot" | "restore"
  | "ensureScreen" | "appendToView" | "setStep" | "attribute" | "setGenerating"
  | "addBinding" | "setBinding" | "addAlarm" | "addFinding" | "setEquipment" | "log"
  | "addMessage" | "patchMessage" | "clearChat" | "reset" | "resetRun"
>;

/* ---------------------------------------------------------------------- */
/* Draft helpers. `s` is always an immer draft, so anything that leaves the  */
/* draft has to go through current() first - a draft is a Proxy, and neither  */
/* structuredClone nor a second set() survives one.                          */
/* ---------------------------------------------------------------------- */

type Draft = ProjectState;

/** The editable slice, detached from the draft. What undo and a batch move. */
function editable_slice(s: Draft, label: string): EditSnapshot {
  return {
    label,
    screens: current(s.screens),
    objectMeta: current(s.objectMeta),
    screenPlacement: current(s.screenPlacement),
    activeScreenId: s.activeScreenId,
    selectedIds: current(s.selectedIds),
    bindings: current(s.bindings),
    alarms: current(s.alarms),
    handles: current(s.handles),
  };
}

function restoreSlice(s: Draft, from: EditSnapshot) {
  s.screens = from.screens;
  s.objectMeta = from.objectMeta;
  s.screenPlacement = from.screenPlacement;
  s.activeScreenId = from.activeScreenId;
  s.selectedIds = from.selectedIds;
  s.bindings = from.bindings;
  s.alarms = from.alarms;
  s.handles = from.handles;
}

/** Record the pre-edit state so undo has somewhere to go. Clears redo. */
function remember(s: Draft, label: string) {
  s.past.push(editable_slice(s, label));
  if (s.past.length > HISTORY_DEPTH) s.past.shift();
  s.future.length = 0;
}

const viewOf = (screen: Screen) => screen.Children[0];

/**
 * Every screen and object gets a handle the first time it is seen, and keeps
 * it. Called after anything that can create one, and on hydrate so a project
 * saved before handles existed gets them without a migration.
 */
function ensureHandles(s: Draft) {
  for (const screen of s.screens) {
    if (!s.handles[screen.UniqueId]) s.handles[screen.UniqueId] = `s${++s.handleSeq}`;
    for (const part of viewOf(screen).Children) {
      if (!s.handles[part.UniqueId]) s.handles[part.UniqueId] = `o${++s.handleSeq}`;
    }
  }
}

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

/**
 * A factory rather than a singleton, so a conversational turn can run its ops
 * on a scratch instance and commit the result whole. The application uses the
 * one instance exported below; docs/LLD.md F7 uses a second.
 */
export function createProjectStore() {
  return create<ProjectState>()(
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
    handles: {},
    handleSeq: 0,
    foreign: {},
    composites: {},
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

    addComposite: (screenId, kind, props, box, name) => {
      const id = crypto.randomUUID();
      set((s) => {
        const screen = s.screens.find((x) => x.UniqueId === screenId);
        if (!screen) return;
        remember(s, `Add ${kind}`);
        const parsed = propsFor(kind, props);
        const stem = uniqueName(takenNames(s), name ?? kind);
        const { parts, wires } = expandComposite(kind, parsed, box, stem);
        const taken = takenNames(s);
        for (const part of parts) {
          part.Name = uniqueName(taken, part.Name);
          taken.add(part.Name);
        }
        viewOf(screen).Children.push(...parts);
        for (const part of parts) (s.objectMeta[part.UniqueId] ??= {}).groupId = id;
        for (const w of wires) {
          const part = parts[w.index];
          if (part) s.bindings.push({ tag: w.tag, targetId: part.UniqueId, targetName: part.Name, property: w.property });
        }
        s.composites[id] = { id, kind, name: stem, props: parsed, screenId, partIds: parts.map((p) => p.UniqueId) };
        s.selectedIds = parts.map((p) => p.UniqueId);
        ensureHandles(s);
      });
      return id;
    },

    setCompositeProps: (id, patch) =>
      set((s) => {
        const instance = s.composites[id];
        if (!instance) return;
        const screen = s.screens.find((x) => x.UniqueId === instance.screenId);
        if (!screen) return;
        const children = viewOf(screen).Children;
        const own = new Set(instance.partIds);
        const oldParts = current(children).filter((p) => own.has(p.UniqueId));
        const box = unionBox(oldParts);
        if (!box) return;
        const first = children.findIndex((p) => own.has(p.UniqueId));
        remember(s, `Edit ${instance.kind}`);

        const props = propsFor(instance.kind as CompositeKind, { ...instance.props, ...patch });
        // Names are freed before the new parts claim them, so a re-expansion
        // keeps its own names rather than gaining a _2.
        const others = new Set(takenNames(s));
        for (const p of oldParts) others.delete(p.Name);
        const { parts, wires } = expandComposite(instance.kind as CompositeKind, props, box, instance.name);
        for (const part of parts) {
          part.Name = uniqueName(others, part.Name);
          others.add(part.Name);
        }

        viewOf(screen).Children = [
          ...children.slice(0, first).filter((p) => !own.has(p.UniqueId)),
          ...parts,
          ...children.slice(first).filter((p) => !own.has(p.UniqueId)),
        ];
        for (const oldId of own) delete s.objectMeta[oldId];
        s.bindings = s.bindings.filter((b) => !own.has(b.targetId));
        for (const part of parts) (s.objectMeta[part.UniqueId] ??= {}).groupId = id;
        for (const w of wires) {
          const part = parts[w.index];
          if (part) s.bindings.push({ tag: w.tag, targetId: part.UniqueId, targetName: part.Name, property: w.property });
        }
        s.composites[id] = { ...instance, props, partIds: parts.map((p) => p.UniqueId) };
        s.selectedIds = parts.map((p) => p.UniqueId);
        ensureHandles(s);
      }),

    registerComposite: (instance) =>
      set((s) => {
        for (const partId of instance.partIds) (s.objectMeta[partId] ??= {}).groupId = instance.id;
        s.composites[instance.id] = instance;
      }),

    setPlant: (model) =>
      set((s) => {
        s.plant = model;
      }),

    answerQuestion: (id, answer) =>
      set((s) => {
        if (!s.plant) return;
        const answers = { ...s.plant.answers, [id]: answer };
        const engineerRanges = s.plant.equipment.flatMap((e) =>
          Object.entries(e.ranges).filter(([, r]) => r.source === "engineer").map(([tag, r]) => [e.id, tag, r] as const),
        );
        const rebuilt = modelPlant(s.variables, answers);
        // Ranges the engineer typed survive a rebuild; class defaults do not need to.
        for (const [eid, tag, r] of engineerRanges) {
          const e = rebuilt.equipment.find((x) => x.id === eid);
          if (e && e.ranges[tag]) e.ranges[tag] = r;
        }
        const kept = s.plant.connections.filter((c) => c.source === "engineer");
        for (const c of kept) if (!rebuilt.connections.some((x) => x.from === c.from && x.to === c.to)) rebuilt.connections.push(c);
        s.plant = rebuilt;
      }),

    setRange: (equipmentId, tag, patch) =>
      set((s) => {
        const e = s.plant?.equipment.find((x) => x.id === equipmentId);
        if (!e || !e.ranges[tag]) return;
        e.ranges[tag] = { ...e.ranges[tag], ...patch, source: "engineer" };
      }),

    connect: (from, to) =>
      set((s) => {
        if (!s.plant || from === to) return;
        if (!s.plant.equipment.some((e) => e.id === from) || !s.plant.equipment.some((e) => e.id === to)) return;
        const existing = s.plant.connections.find((c) => c.from === from && c.to === to);
        if (existing) {
          existing.confidence = 1;
          existing.source = "engineer";
          return;
        }
        s.plant.connections.push({ from, to, confidence: 1, source: "engineer" });
      }),

    disconnect: (from, to) =>
      set((s) => {
        if (!s.plant) return;
        s.plant.connections = s.plant.connections.filter((c) => !(c.from === from && c.to === to));
      }),

    applyStandard: (screenId) => {
      const target = get().screens.find((x) => x.UniqueId === (screenId ?? get().activeScreenId)) ?? get().screens[0];
      if (!target) return [];
      const view = viewOf(target);
      // get() hands back plain state, not a draft; applyPack clones what it is given.
      const { parts, changes } = applyPack(view.Children, undefined, { width: view.Width, height: view.Height });
      if (changes.length === 0) return [];
      set((s) => {
        remember(s, `Apply the Standard to ${target.Name}`);
        const screen = s.screens.find((x) => x.UniqueId === target.UniqueId)!;
        viewOf(screen).Children = parts;
      });
      return changes;
    },

    importScreens: (incoming) => {
      const report: ImportReport = {
        screens: 0,
        objects: 0,
        tagsAdded: 0,
        bindings: 0,
        droppedBindings: [],
        carriedLeftBehind: 0,
        renamed: [],
      };
      if (incoming.screens.length === 0) return report;
      let firstId: string | undefined;
      set((s) => {
        remember(s, `Import ${incoming.screens.length} screen${incoming.screens.length === 1 ? "" : "s"}`);

        // Tags first, so a binding can be re-pointed at one that just arrived.
        const have = new Set(s.variables.map((v) => v.Name));
        for (const v of incoming.variables) {
          if (have.has(v.Name)) continue;
          have.add(v.Name);
          s.variables.push(structuredClone(v));
          report.tagsAdded += 1;
        }

        const screenNames = new Set(s.screens.map((x) => x.Name));
        const partNames = takenNames(s);
        /** Incoming object id -> the id it has here, for the bindings. */
        const idMap = new Map<string, string>();

        for (const source of incoming.screens) {
          const view = source.Children[0];
          const parts: Part[] = view.Children.map((part) => {
            const name = uniqueName(partNames, part.Name);
            partNames.add(name);
            const id = crypto.randomUUID();
            idMap.set(part.UniqueId, id);
            return { ...structuredClone(part), UniqueId: id, Name: name };
          });
          const name = uniqueName(screenNames, source.Name);
          screenNames.add(name);
          if (name !== source.Name) report.renamed.push(`${source.Name} → ${name}`);
          const id = crypto.randomUUID();
          firstId ??= id;
          s.screens.push({
            Type: "Screen",
            UniqueId: id,
            Name: name,
            Children: [{ ...structuredClone(view), UniqueId: crypto.randomUUID(), Children: parts }],
          });
          report.screens += 1;
          report.objects += parts.length;
          report.carriedLeftBehind += incoming.foreign?.[source.UniqueId]?.length ?? 0;
        }

        for (const b of incoming.bindings) {
          const targetId = idMap.get(b.targetId);
          if (!targetId) continue;
          const part = s.screens.flatMap((x) => viewOf(x).Children).find((p) => p.UniqueId === targetId)!;
          if (!have.has(b.tag)) {
            report.droppedBindings.push(`${part.Name} → ${b.tag}`);
            continue;
          }
          s.bindings.push({ tag: b.tag, targetId, targetName: part.Name, property: b.property });
          report.bindings += 1;
        }

        s.activeScreenId = firstId;
        s.selectedIds = [];
        ensureHandles(s);
      });
      return report;
    },

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
        ensureHandles(s);
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
        ensureHandles(s);
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
        s.handles[part.UniqueId] ??= `o${++s.handleSeq}`;
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
        // A composite that lost any of its parts is no longer one: what is
        // left is ordinary parts, still grouped, and no longer re-expandable.
        for (const [cid, instance] of Object.entries(s.composites)) {
          if (instance.partIds.some((pid) => wanted.has(pid))) delete s.composites[cid];
        }
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
        ensureHandles(s);
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
        ensureHandles(s);
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
        // Ungrouping a composite makes it ordinary parts, by choice.
        for (const gid of groups) delete s.composites[gid];
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

    refreshNavigation: () =>
      set((s) => {
        const next = refreshNavigationParts(current(s.screens), {
          width: s.target.width,
          height: s.target.height,
        });
        if (!next.changed) return;
        remember(s, "Refresh navigation");
        s.screens = next.screens;
        ensureHandles(s);
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
        ensureHandles(s);
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
        ensureHandles(s);
      }),

    appendToView: (viewBoxId, part) =>
      set((s) => {
        for (const screen of s.screens) {
          if (viewOf(screen).UniqueId !== viewBoxId) continue;
          viewOf(screen).Children.push(part);
          s.handles[part.UniqueId] ??= `o${++s.handleSeq}`;
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

    setBinding: (targetId, property, tag) =>
      set((s) => {
        const screen = screenHolding(s, targetId);
        if (!screen) return;
        const part = viewOf(screen).Children.find((p) => p.UniqueId === targetId);
        if (!part) return;
        const had = s.bindings.find((b) => b.targetId === targetId && b.property === property);
        if ((had?.tag ?? null) === tag) return;
        remember(s, tag ? `Bind ${part.Name} to ${tag}` : `Unbind ${part.Name}`);
        s.bindings = s.bindings.filter((b) => !(b.targetId === targetId && b.property === property));
        if (tag) s.bindings.push({ tag, targetId, targetName: part.Name, property });
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
        s.source = undefined;
        s.screens = [];
        s.foreign = {};
        s.composites = {};
        s.plant = undefined;
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
}

export type ProjectStore = ReturnType<typeof createProjectStore>;

/** The application's one project. Everything on screen reads from here. */
export const useProject = createProjectStore();
