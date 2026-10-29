/**
 * Draft helpers shared by the slices.
 *
 * `s` is always an immer draft, so anything that leaves the draft has to go
 * through current() first: a draft is a Proxy, and neither structuredClone nor
 * a second set() survives one. These were private to project.ts before the
 * split and are exported now only so the slices can use them.
 */


import { current } from "immer";
import { HISTORY_DEPTH, type Draft, type EditSnapshot } from "./state";
import type { Alarm, Part, Screen} from "@/lib/ote/schema";
/* ---------------------------------------------------------------------- */
/* Draft helpers. `s` is always an immer draft, so anything that leaves the  */
/* draft has to go through current() first - a draft is a Proxy, and neither  */
/* structuredClone nor a second set() survives one.                          */
/* ---------------------------------------------------------------------- */


/** The editable slice, detached from the draft. What undo and a batch move. */
export function editable_slice(s: Draft, label: string): EditSnapshot {
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

export function restoreSlice(s: Draft, from: EditSnapshot) {
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
export function remember(s: Draft, label: string) {
  s.past.push(editable_slice(s, label));
  if (s.past.length > HISTORY_DEPTH) s.past.shift();
  s.future.length = 0;
}

export const viewOf = (screen: Screen) => screen.Children[0];

/**
 * Every screen and object gets a handle the first time it is seen, and keeps
 * it. Called after anything that can create one, and on hydrate so a project
 * saved before handles existed gets them without a migration.
 */
export function ensureHandles(s: Draft) {
  for (const screen of s.screens) {
    if (!s.handles[screen.UniqueId]) s.handles[screen.UniqueId] = `s${++s.handleSeq}`;
    for (const part of viewOf(screen).Children) {
      if (!s.handles[part.UniqueId]) s.handles[part.UniqueId] = `o${++s.handleSeq}`;
    }
  }
}

export const activeScreen = (s: Draft) =>
  s.screens.find((x) => x.UniqueId === s.activeScreenId) ?? s.screens[0];

/** Every object name in use anywhere, because bindings resolve by name. */
export function takenNames(s: Draft): Set<string> {
  const names = new Set<string>();
  for (const screen of s.screens) {
    for (const part of viewOf(screen).Children) names.add(part.Name);
  }
  return names;
}

/** The screen an object lives on, since ids are unique across the project. */
export function screenHolding(s: Draft, id: string): Screen | undefined {
  return s.screens.find((screen) =>
    viewOf(screen).Children.some((p) => p.UniqueId === id),
  );
}

export function partsByIds(s: Draft, ids: string[]): Part[] {
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
export function detachedPartsByIds(s: Draft, ids: string[]): Part[] {
  const wanted = new Set(ids);
  return current(s.screens).flatMap((screen) =>
    screen.Children[0].Children.filter((p) => wanted.has(p.UniqueId)),
  );
}

/**
 * An edit by hand to something the generator placed: it becomes "edited", so
 * a regeneration keeps it unless the engineer says otherwise. Anything else
 * keeps the origin it has.
 */
export function touch(s: Draft, ids: Iterable<string>) {
  for (const id of ids) {
    const meta = s.objectMeta[id];
    if (meta?.origin === "generated") meta.origin = "edited";
  }
}

/** Locked objects ignore edits; that is the whole point of the lock. */
export const editable = (s: Draft, ids: string[]) =>
  ids.filter((id) => !s.objectMeta[id]?.locked);

/** The same alarm condition: a bit alarm on a tag, or a level alarm at one level of a tag. */
export function sameCondition(a: Alarm, b: Alarm): boolean {
  if (a.Trigger !== b.Trigger || a.AlarmRecordType !== b.AlarmRecordType) return false;
  return a.AlarmRecordType === 1 || a.AlarmType === b.AlarmType;
}

