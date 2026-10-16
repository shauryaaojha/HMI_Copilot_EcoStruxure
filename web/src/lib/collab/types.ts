/**
 * The vocabulary of live co-editing, shared by the browser and the server.
 *
 * A project is edited by several people at once through an operation log
 * (docs/COLLAB_PHASE_A.md, Phase C). Every edit travels as a `Change`: a small
 * batch of `StoreChange` records, each describing one store mutation at the
 * granularity of one part or one record. Whole parts and whole records are
 * sent rather than property paths, so applying a record twice gives the same
 * result as applying it once, and the conflict rule stays "last writer wins
 * per part or record".
 *
 * Kept in its own file, free of zustand and React, so the server route can
 * import it without pulling the editor into a function bundle.
 */

import type { Alarm, Part, Screen, Variable } from "@/lib/ote/schema";
import type { PersistedProject } from "@/store/persist";
import type { Binding } from "@/store/types";

/**
 * The part of a project that collaborators share.
 *
 * Everything in the persisted snapshot except what is personal to one person
 * or one device: the conversation, the in-app version list, the save stamp and
 * the active screen. Those stay in each browser's own cache.
 */
export type SyncedKey =
  | "name"
  | "target"
  | "screens"
  | "variables"
  | "alarms"
  | "bindings"
  | "objectMeta"
  | "screenPlacement"
  | "handles"
  | "handleSeq"
  | "source"
  | "sourceId"
  | "layout"
  | "foreign"
  | "composites"
  | "programs"
  | "plant"
  | "standards"
  | "tagImport";

/** The shared document: the synced slice of a snapshot or of the store. */
export type Doc = Pick<PersistedProject, SyncedKey>;

/** Keyed maps on the document, synced one entry at a time. */
export type EntryField = "objectMeta" | "screenPlacement" | "handles" | "composites" | "programs" | "foreign";

/** Whole-value fields on the document, synced as one value each. */
export type ValueField = "name" | "target" | "standards" | "plant" | "tagImport" | "source" | "sourceId" | "layout" | "handleSeq";

/**
 * One idempotent store mutation.
 *
 * `index` on an insert is a hint for where a new item goes; an existing item
 * keeps its place unless a reorder says otherwise.
 */
export type StoreChange =
  /** The whole part as it is after the edit, on the screen that holds it. */
  | { kind: "setPart"; screenId: string; part: Part; index?: number }
  | { kind: "removePart"; screenId: string; partId: string }
  /** Paint order of a screen's parts, by UniqueId. */
  | { kind: "reorderParts"; screenId: string; order: string[] }
  /** A new screen, with everything on it. */
  | { kind: "addScreen"; screen: Screen; index?: number }
  | { kind: "removeScreen"; screenId: string }
  | { kind: "renameScreen"; screenId: string; name: string }
  /** Everything about a screen except its name and its parts (the view's size, options). */
  | { kind: "setScreenProps"; screenId: string; screen: Screen }
  | { kind: "reorderScreens"; order: string[] }
  | { kind: "setVariable"; variable: Variable; index?: number }
  | { kind: "removeVariable"; name: string }
  /** Alarms are keyed by `alarmKeyOf` (alarmKey in lib/ote/reader.ts). */
  | { kind: "setAlarm"; key: string; alarm: Alarm; index?: number }
  | { kind: "removeAlarm"; key: string }
  /** Bindings are keyed by targetId + property. */
  | { kind: "setBinding"; binding: Binding; index?: number }
  | { kind: "removeBinding"; targetId: string; property: string }
  | { kind: "setEntry"; field: EntryField; key: string; value: unknown }
  | { kind: "removeEntry"; field: EntryField; key: string }
  | { kind: "setField"; field: ValueField; value: unknown };

export type StoreChangeKind = StoreChange["kind"];

/**
 * One committed edit as it travels: what one store action did, from one
 * author, against the revision the author had seen.
 */
export interface Change {
  /** Chosen by the client (a uuid), so a retried POST is recognised. */
  id: string;
  /** The last server revision the author had applied when making it. */
  base: number;
  /** User id, or `agent:<provider>:<model>` for the Copilot. */
  author: string;
  ops: StoreChange[];
  /** Set when an editor accepted an AI proposal: who decided. */
  acceptedBy?: string;
}

/** A change as the log holds it, once the server has given it a revision. */
export interface LoggedChange {
  rev: number;
  change: Change;
  author: string;
  at: number;
}

/** What POST /api/projects/[id]/changes answers. */
export interface ChangesResult {
  rev: number;
  accepted: string[];
  rejected: { id: string; reason: string }[];
}

/** One collaborator's whereabouts, as the presence route stores and streams it. */
export interface Presence {
  userId: string;
  name: string;
  screenId?: string;
  selection: string[];
  cursor?: { x: number; y: number };
  /** Milliseconds since the epoch at which this entry stops counting. */
  expiresAt: number;
}
