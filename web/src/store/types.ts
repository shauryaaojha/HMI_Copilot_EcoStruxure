/**
 * The types the store holds, split out so persistence and the chat route can
 * import them without importing the store itself (and, in the route's case,
 * without pulling zustand into a server bundle).
 */

import type { Alarm, Screen, Variable } from "@/lib/ote/schema";

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
}

/** What the assistant needs before it will build rather than ask. */
export interface Requirement {
  id: string;
  label: string;
  /** Satisfied from the project itself, so the checklist is never a form. */
  met: boolean;
  detail: string;
}
