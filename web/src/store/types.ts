/**
 * The types the store holds, split out so persistence and the chat route can
 * import them without importing the store itself (and, in the route's case,
 * without pulling zustand into a server bundle).
 */

import type { Alarm, Part, Screen, Variable } from "@/lib/ote/schema";

export interface Binding {
  tag: string;
  targetId: string;
  targetName: string;
  property: string;
}

/**
 * What the editor knows about an object that the .eote does not.
 *
 * Locked, hidden and grouped are editing conveniences, not OTE properties -
 * Screen.dat has no field for any of them. Keeping them beside the parts rather
 * than inside them is what lets the packager keep writing exactly the JSON the
 * product accepts: the one rule in docs/BUILD_PLAN.md survives a layers panel.
 */
/**
 * Where a screen has been dragged to on the board.
 *
 * Board coordinates, in screen units, of the frame's top-left corner. Absent
 * for a screen that has never been moved, which then falls back to its place in
 * the automatic grid - so a project that nobody has rearranged still lays
 * itself out, and one that has been keeps the arrangement.
 *
 * Deliberately not on the Screen itself: Screen.dat has no field for it, and a
 * board position is a fact about this editor rather than about the project the
 * product opens.
 */
export interface ScreenPlacement {
  x: number;
  y: number;
}

export interface ObjectMeta {
  locked?: boolean;
  hidden?: boolean;
  /** Members of one group share this id. Groups are flat - no nesting. */
  groupId?: string;
}

/** Canvas grid, snapping and the colour set every part resolves through. */
export interface Standards {
  gridSize: number;
  showGrid: boolean;
  snap: boolean;
  /** Snap to other objects' edges and centres, not only to the grid. */
  smartGuides: boolean;
  showRulers: boolean;
  colorSet: number;
  enforceNaming: boolean;
}

export const DEFAULT_STANDARDS: Standards = {
  gridSize: 8,
  showGrid: false,
  snap: true,
  smartGuides: true,
  showRulers: false,
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
  rule?: string;
  message: string;
  objectId?: string;
  tag?: string;
  suggestion?: string;
}

export interface TagImport {
  fileName: string;
  at: number;
  corrections: { from: string; to: string; reason: string }[];
  skipped: { row: number; value: string; reason: string }[];
  summary: { total: number } & Partial<Record<string, number>>;
}

/* ---------------------------------------------------------------------- */
/* The conversation                                                        */
/* ---------------------------------------------------------------------- */

/**
 * One turn. The engineer keeps asking until the screen is right, so a turn is
 * not "a generation" - it is a request against the project as it stands, and
 * what it changed is recorded on the turn so the history reads as a build log
 * rather than as a chat transcript.
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  at: number;
  text: string;
  /** Set while the turn is still streaming. */
  pending?: boolean;
  /** The assistant is asking rather than building; these are its questions. */
  questions?: string[];
  /** What the turn actually did, in engineering language, for the history. */
  changes?: string[];
  /** The version stamp this turn produced, so History can jump back to it. */
  versionAt?: number;
  /** Which provider answered, or "local" when nothing was configured. */
  provider?: string;
  error?: string;
  /**
   * The structured record of an assistant turn - what applied, what was
   * rejected and why, what was renamed. This, not `text`, is what the model
   * is shown as its own history next turn. docs/LLD.md F4.
   */
  turn?: {
    mode: "clarify" | "build" | "extend" | "startOver" | "edit" | "answer";
    applied: string[];
    rejected: { op: string; reason: string }[];
    renamed: { asked: string; became: string; handle: string }[];
    decision?: "committed" | "proposed" | "accepted" | "discarded";
  };
  /**
   * A turn that could not be auto-committed - something was rejected, or
   * something would be deleted - waits here for the engineer. docs/LLD.md F7.
   */
  proposal?: {
    status: "pending" | "accepted" | "discarded" | "expired";
    applied: string[];
    rejected: string[];
    deleted: boolean;
  };
  /** Tokens for the debug line: in, of which cached, out. */
  usage?: { input: number; cached: number; output: number };
}

/**
 * An object the reader carried rather than modelled: a type the schema does
 * not know, kept verbatim in the file and put back at export. The canvas
 * draws it as a placeholder so the engineer does not place a lamp on top of
 * a Grid they cannot see. Read-only by construction - it has no editor, no
 * handle and no place in the undo history. docs/PLAN_PHASE2.md item 1.
 */
export interface ForeignPart {
  type: string;
  name: string;
  /** Null when the object is laid out by a grid and has no box of its own. */
  box: { left: number; top: number; width: number; height: number } | null;
}

/**
 * A composite instance: which parts on which screen were expanded from which
 * props. The parts are ordinary parts (the packager sees only them); this is
 * what lets the inspector edit "the indicator" and the store re-expand it.
 * docs/ARCHITECTURE_SCREEN_QUALITY.md §3.3.
 */
export interface CompositeInstance {
  /** Also the group id its parts carry in objectMeta. */
  id: string;
  kind: string;
  name: string;
  props: Record<string, unknown>;
  screenId: string;
  /** In paint order; the first is the frame the box is read from. */
  partIds: string[];
}

/** Screens lifted out of another project, as the import route returns them. */
export interface ScreenImport {
  screens: Screen[];
  variables: Variable[];
  bindings: Binding[];
  /** Carried objects per incoming screen id; they do not come along. */
  foreign?: Record<string, ForeignPart[]>;
}

/** What importing screens did, for the engineer to read before moving on. */
export interface ImportReport {
  screens: number;
  objects: number;
  tagsAdded: number;
  bindings: number;
  /** "Lamp_1 → PMP_101_RUN": the tag was not in either project. */
  droppedBindings: string[];
  /** Carried objects on the imported screens, which cannot come along. */
  carriedLeftBehind: number;
  /** Screen names that changed to stay unique, as "was → is". */
  renamed: string[];
}

/** What a pending proposal would do to one screen, for the canvas to ghost. */
export interface ScreenPreview {
  added: Part[];
  /** UniqueIds of objects that would be deleted. */
  removed: string[];
  moved: {
    id: string;
    from: { left: number; top: number; width: number; height: number };
    to: { left: number; top: number; width: number; height: number };
  }[];
}

export interface Preview {
  messageId: string;
  /** Keyed by screen UniqueId. */
  screens: Record<string, ScreenPreview>;
}

/** What the assistant needs before it will build rather than ask. */
export interface Requirement {
  id: string;
  label: string;
  /** Satisfied from the project itself, so the checklist is never a form. */
  met: boolean;
  detail: string;
}
