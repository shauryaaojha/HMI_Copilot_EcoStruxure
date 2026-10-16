/**
 * Turning store edits into StoreChange records, and records back into edits.
 *
 * Live co-editing sends what a store action did, not the whole project: one
 * record per part, per screen, per variable, per map entry. This module is the
 * whole algebra over those records, and it is deliberately pure - no zustand,
 * no React - so the browser (which diffs its own state after every action),
 * the server (which folds accepted changes into the stored snapshot) and the
 * tests all run exactly the same code.
 *
 * - `diff` compares two documents and lists the records that turn one into
 *   the other. Immer keeps every untouched subtree as the same object, so the
 *   comparison is by reference first and only falls back to JSON for the few
 *   things whose reference changed. A nudge of one part costs one JSON
 *   comparison of that part, not of the project.
 * - `apply` folds records into a document. Every record is idempotent - it
 *   carries the whole part or the whole record, never a delta - so a change
 *   that arrives twice (a retried POST, an echo of our own edit) does no harm.
 * - `invert` gives the records that undo a change, so undo can be sent to
 *   collaborators as an ordinary change rather than as a snapshot.
 * - `validStoreChange` is the server's structural guard on untrusted input.
 * - `compact` shortens a client's send queue (a drag is fifty setParts of one
 *   part) without changing what applying it does.
 *
 * Two things are knowingly not synced, and the functions below say so where
 * they matter:
 *
 * - The order of the record arrays (variables, alarms, bindings) on its own.
 *   A record that changed is sent at its new place, but an unchanged record
 *   that only moved is not: nobody reorders a tag list by hand, and sending
 *   every record of a shuffled list would overwrite concurrent edits to them.
 * - Duplicate keys in those arrays. Records are keyed (a variable by Name, a
 *   binding by target and property, an alarm by `alarmKeyOf`); if one array
 *   holds two records with the same key, the last one wins and the earlier
 *   ones cannot be addressed separately.
 */

import { produce, type Draft } from "immer";
import type { Alarm, Part, Screen, Variable } from "@/lib/ote/schema";
import type { Binding } from "@/store/types";
import type { Doc, EntryField, StoreChange, SyncedKey, ValueField } from "./types";

/* ---------------------------------------------------------------------- */
/* The synced slice                                                         */
/* ---------------------------------------------------------------------- */

/**
 * Every key of the shared document, in one list.
 *
 * `SyncedKey` is a type and disappears at runtime; this is the same set as a
 * value, so `docOf` can pick the slice out of a store state without listing
 * the keys a second time somewhere they could drift.
 */
export const SYNCED_KEYS: readonly SyncedKey[] = [
  "name",
  "target",
  "screens",
  "variables",
  "alarms",
  "bindings",
  "objectMeta",
  "screenPlacement",
  "handles",
  "handleSeq",
  "source",
  "sourceId",
  "layout",
  "foreign",
  "composites",
  "programs",
  "plant",
  "standards",
  "tagImport",
];

const ENTRY_FIELDS: readonly EntryField[] = [
  "objectMeta",
  "screenPlacement",
  "handles",
  "composites",
  "programs",
  "foreign",
];

const VALUE_FIELDS: readonly ValueField[] = [
  "name",
  "target",
  "standards",
  "plant",
  "tagImport",
  "source",
  "sourceId",
  "layout",
  "handleSeq",
];

const ARRAY_KEYS: readonly SyncedKey[] = ["screens", "variables", "alarms", "bindings"];

/**
 * The shared document out of a store state or a persisted snapshot.
 *
 * Both carry far more than collaborators share (selection, history, the
 * conversation), and older snapshots lack some maps entirely. Missing maps
 * become `{}` and missing arrays `[]`, so `diff` never has to tell "absent"
 * from "empty"; optional scalars that are absent stay absent. Values are taken
 * by reference, so a doc of an immer state shares every subtree with it.
 */
export function docOf(source: Partial<Record<SyncedKey, unknown>> & object): Doc {
  const doc: Record<string, unknown> = {};
  for (const key of SYNCED_KEYS) {
    const value = source[key];
    if (value !== undefined) {
      doc[key] = value;
    } else if ((ENTRY_FIELDS as readonly string[]).includes(key)) {
      doc[key] = {};
    } else if (ARRAY_KEYS.includes(key)) {
      doc[key] = [];
    }
  }
  return doc as unknown as Doc;
}

/* ---------------------------------------------------------------------- */
/* Keys                                                                     */
/* ---------------------------------------------------------------------- */

/**
 * The key an alarm is synced under.
 *
 * The formula is `alarmKey` from lib/ote/reader.ts - what trips it, at which
 * level, of which kind - re-implemented here rather than imported, because
 * reader.ts pulls in JSZip, sql.js and the packager at module load, and the
 * server's change route should not carry those for a string template. The
 * tests check the two agree.
 *
 * Alarms built by the generator and the demo fixture have no `Trigger` at all
 * although the schema says it is a string, so those fall back to the message:
 * stable across an edit of severity or value, which is what a key is for.
 */
export function alarmKeyOf(alarm: Pick<Alarm, "Message" | "AlarmType" | "AlarmRecordType"> & { Trigger?: unknown }): string {
  if (typeof alarm.Trigger === "string") {
    return `${alarm.Trigger.toLowerCase()}|${alarm.AlarmType}|${alarm.AlarmRecordType}`;
  }
  return `msg|${alarm.Message}|${alarm.AlarmType}|${alarm.AlarmRecordType}`;
}

const variableKey = (variable: Variable) => variable.Name;

const bindingKeyOf = (targetId: string, property: string) => `${targetId}\u0000${property}`;

const bindingKey = (binding: Binding) => bindingKeyOf(binding.targetId, binding.property);

/** The number in a handle (`o17` is 17), or undefined for a handle of another shape. */
function handleNumber(handle: unknown): number | undefined {
  if (typeof handle !== "string") return undefined;
  const match = /^[a-z]+(\d+)$/i.exec(handle);
  return match ? Number(match[1]) : undefined;
}

/* ---------------------------------------------------------------------- */
/* Small helpers                                                            */
/* ---------------------------------------------------------------------- */

/** Equal by reference, or failing that by JSON. Reference first is the point. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The root container of a screen, whose children are the parts. */
function rootOf<S extends { Children: readonly { Children: unknown[] }[] }>(screen: S): S["Children"][number] {
  return screen.Children[0];
}

function partsOf(screen: Screen): Part[] {
  return rootOf(screen).Children;
}

/** A screen with its parts taken out: what `setScreenProps` carries and compares. */
function withoutParts(screen: Screen): Screen {
  const roots = screen.Children.map((root) => ({ ...root, Children: [] }));
  return { ...screen, Children: roots as unknown as Screen["Children"] };
}

/** Everything about a screen that `setScreenProps` owns, for comparison. */
function propsKey(screen: Screen): string {
  return JSON.stringify({ ...withoutParts(screen), Name: "" });
}

function clampIndex(index: number | undefined, length: number): number {
  if (index === undefined || !Number.isFinite(index)) return length;
  return Math.max(0, Math.min(length, Math.floor(index)));
}

/** Index of the last item with this key: duplicates resolve to the last one. */
function lastIndexBy<T>(items: readonly T[], keyOf: (item: T) => string, key: string): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (keyOf(items[i]) === key) return i;
  }
  return -1;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

const idsOf = (items: readonly { UniqueId: string }[]) => items.map((item) => item.UniqueId);

/**
 * Positions (into `values`) of a heaviest strictly increasing subsequence.
 *
 * Used to find which common records kept their relative order: those are left
 * where they are, and only the ones outside it count as moved. Weighted, so
 * that among equally long choices the unchanged records are the ones kept -
 * a changed record is sent whole anyway, so moving it costs nothing, while an
 * unchanged record left outside would be a reorder that is not synced.
 *
 * `values` must be distinct integers in 0..values.length-1 (positions in the
 * other array, renumbered). A Fenwick tree over values keeps it n log n, so a
 * tag list of thousands stays cheap.
 */
function heaviestIncreasing(values: readonly number[], weights: readonly number[]): Set<number> {
  const size = values.length;
  const bestAt: number[] = new Array(size + 1).fill(-1);
  const score: number[] = new Array(size).fill(0);
  const previous: number[] = new Array(size).fill(-1);

  const better = (a: number, b: number) => (b === -1 ? a : a === -1 ? b : score[a] >= score[b] ? a : b);
  const query = (value: number) => {
    let best = -1;
    for (let k = value; k > 0; k -= k & -k) best = better(best, bestAt[k]);
    return best;
  };
  const update = (value: number, i: number) => {
    for (let k = value; k <= size; k += k & -k) bestAt[k] = better(bestAt[k], i);
  };

  let top = -1;
  for (let i = 0; i < size; i++) {
    // Strictly smaller values live at Fenwick slots 1..values[i].
    const before = query(values[i]);
    score[i] = weights[i] + (before === -1 ? 0 : score[before]);
    previous[i] = before;
    update(values[i] + 1, i);
    top = better(top, i);
  }

  const kept = new Set<number>();
  for (let at = top; at !== -1; at = previous[at]) kept.add(at);
  return kept;
}

/* ---------------------------------------------------------------------- */
/* diff                                                                     */
/* ---------------------------------------------------------------------- */

/**
 * The records that turn `before` into `after`.
 *
 * Called by the client after every store action, so it has to be cheap when
 * little changed: anything whose reference is unchanged is skipped without
 * being looked at, and JSON comparison is only reached for objects immer had
 * to copy. The result is emitted in an order that applies correctly:
 *
 *   1. parts leaving a surviving screen for good (or for a new screen)
 *   2. removed screens, then added screens at their index
 *   3. renames and screen properties
 *   4. new, changed and moved-in parts, in each screen's paint order
 *   5. screen order and paint order, only where 1-4 did not already produce it
 *   6. variables, alarms, bindings; then map entries; then whole-value fields
 *
 * A part that moved to another surviving screen is a single setPart on its new
 * screen - applying it takes the part off the old one.
 *
 * Not synced, by design: a pure reordering of variables, alarms or bindings,
 * and records sharing a key (the last wins). See the module comment.
 */
export function diff(before: Doc, after: Doc): StoreChange[] {
  if (before === after) return [];
  const ops: StoreChange[] = [];
  if (before.screens !== after.screens) {
    ops.push(...diffScreens(before, after));
  }
  if (before.variables !== after.variables) {
    ops.push(
      ...diffRecords(before.variables, after.variables, variableKey, {
        set: (variable, index) => ({ kind: "setVariable", variable, ...(index === undefined ? {} : { index }) }),
        remove: (name) => ({ kind: "removeVariable", name }),
      }),
    );
  }
  if (before.alarms !== after.alarms) {
    ops.push(
      ...diffRecords(before.alarms, after.alarms, alarmKeyOf, {
        set: (alarm, index) => ({ kind: "setAlarm", key: alarmKeyOf(alarm), alarm, ...(index === undefined ? {} : { index }) }),
        remove: (key) => ({ kind: "removeAlarm", key }),
      }),
    );
  }
  if (before.bindings !== after.bindings) {
    const byKey = new Map(before.bindings.map((binding) => [bindingKey(binding), binding]));
    ops.push(
      ...diffRecords(before.bindings, after.bindings, bindingKey, {
        set: (binding, index) => ({ kind: "setBinding", binding, ...(index === undefined ? {} : { index }) }),
        remove: (key) => {
          const gone = byKey.get(key)!;
          return { kind: "removeBinding", targetId: gone.targetId, property: gone.property };
        },
      }),
    );
  }
  const entryOps = diffEntries(before, after);
  ops.push(...entryOps);
  ops.push(...diffFields(before, after, entryOps));
  return ops;
}

function diffScreens(before: Doc, after: Doc): StoreChange[] {
  const beforeById = new Map(before.screens.map((screen) => [screen.UniqueId, screen]));
  const afterById = new Map(after.screens.map((screen) => [screen.UniqueId, screen]));

  // Only screens whose object changed can have gained or lost a part: an
  // unchanged screen holds exactly the parts it held, and ids are unique.
  const changedBefore = before.screens.filter((screen) => afterById.get(screen.UniqueId) !== screen);
  const changedAfter = after.screens.filter((screen) => beforeById.get(screen.UniqueId) !== screen);

  const beforeHolder = new Map<string, { screenId: string; part: Part }>();
  for (const screen of changedBefore) {
    for (const part of partsOf(screen)) beforeHolder.set(part.UniqueId, { screenId: screen.UniqueId, part });
  }
  const afterHolder = new Map<string, string>();
  for (const screen of changedAfter) {
    for (const part of partsOf(screen)) afterHolder.set(part.UniqueId, screen.UniqueId);
  }

  const structural: StoreChange[] = [];

  // 1. Parts leaving a surviving screen and not landing on another surviving
  // one. A part bound for a new screen arrives inside addScreen, so it has to
  // leave first or the project would briefly hold it twice.
  for (const screen of changedBefore) {
    if (!afterById.has(screen.UniqueId)) continue;
    for (const part of partsOf(screen)) {
      const goesTo = afterHolder.get(part.UniqueId);
      if (goesTo === undefined || !beforeById.has(goesTo)) {
        structural.push({ kind: "removePart", screenId: screen.UniqueId, partId: part.UniqueId });
      }
    }
  }

  // 2. Screens that went, then screens that arrived.
  for (const screen of before.screens) {
    if (!afterById.has(screen.UniqueId)) structural.push({ kind: "removeScreen", screenId: screen.UniqueId });
  }
  after.screens.forEach((screen, index) => {
    if (!beforeById.has(screen.UniqueId)) structural.push({ kind: "addScreen", screen, index });
  });

  // 3 and 4. What changed on the screens both sides have.
  for (const screen of changedAfter) {
    const old = beforeById.get(screen.UniqueId);
    if (!old) continue;
    if (old.Name !== screen.Name) {
      structural.push({ kind: "renameScreen", screenId: screen.UniqueId, name: screen.Name });
    }
    if (propsKey(old) !== propsKey(screen)) {
      structural.push({ kind: "setScreenProps", screenId: screen.UniqueId, screen: withoutParts(screen) });
    }
  }
  for (const screen of changedAfter) {
    const old = beforeById.get(screen.UniqueId);
    if (!old || partsOf(old) === partsOf(screen)) continue;
    partsOf(screen).forEach((part, index) => {
      const was = beforeHolder.get(part.UniqueId);
      const unchanged = was !== undefined && was.screenId === screen.UniqueId && same(was.part, part);
      if (!unchanged) structural.push({ kind: "setPart", screenId: screen.UniqueId, part, index });
    });
  }

  // 5. Order. Rather than reason about how inserts shift indices, apply what
  // we have to the screens alone and compare: a reorder is sent only where
  // the inserts did not already produce the right order.
  const simulated = apply(before, structural);
  const reorders: StoreChange[] = [];
  const afterOrder = idsOf(after.screens);
  if (!sameOrder(idsOf(simulated.screens), afterOrder)) {
    reorders.push({ kind: "reorderScreens", order: afterOrder });
  }
  const simulatedById = new Map(simulated.screens.map((screen) => [screen.UniqueId, screen]));
  for (const screen of changedAfter) {
    const got = simulatedById.get(screen.UniqueId);
    if (!got || !beforeById.has(screen.UniqueId)) continue;
    const wanted = idsOf(partsOf(screen));
    if (!sameOrder(idsOf(partsOf(got)), wanted)) {
      reorders.push({ kind: "reorderParts", screenId: screen.UniqueId, order: wanted });
    }
  }
  return [...structural, ...reorders];
}

interface RecordOps<T> {
  set: (item: T, index?: number) => StoreChange;
  remove: (key: string) => StoreChange;
}

/**
 * Sets and removes for one keyed record array.
 *
 * A changed record that also moved (the store's setBinding drops the old
 * binding and appends the new one) is sent as a remove and an insert at its
 * new index, which costs nothing extra in conflicts since the whole record is
 * sent anyway. An unchanged record that only moved is not sent at all.
 */
function diffRecords<T>(before: readonly T[], after: readonly T[], keyOf: (item: T) => string, make: RecordOps<T>): StoreChange[] {
  const beforeAt = new Map<string, number>();
  before.forEach((item, index) => beforeAt.set(keyOf(item), index));
  const afterAt = new Map<string, number>();
  after.forEach((item, index) => afterAt.set(keyOf(item), index));

  // The common records, in after's order, as their positions in before.
  const common: { key: string; afterIndex: number; beforeIndex: number }[] = [];
  after.forEach((item, afterIndex) => {
    const key = keyOf(item);
    if (afterAt.get(key) !== afterIndex) return;
    const beforeIndex = beforeAt.get(key);
    if (beforeIndex !== undefined) common.push({ key, afterIndex, beforeIndex });
  });
  const changed = common.map((entry) => !same(before[entry.beforeIndex], after[entry.afterIndex]));
  const rank = renumber(common.map((entry) => entry.beforeIndex));
  // An unchanged record outweighs every changed one put together.
  const weights = changed.map((isChanged) => (isChanged ? 1 : common.length + 1));
  const inPlace = heaviestIncreasing(rank, weights);
  const moved = new Set<string>();
  common.forEach((entry, position) => {
    if (!inPlace.has(position) && changed[position]) moved.add(entry.key);
  });

  const ops: StoreChange[] = [];
  before.forEach((item, index) => {
    const key = keyOf(item);
    if (beforeAt.get(key) !== index) return;
    if (!afterAt.has(key) || moved.has(key)) ops.push(make.remove(key));
  });
  after.forEach((item, index) => {
    const key = keyOf(item);
    if (afterAt.get(key) !== index) return;
    const beforeIndex = beforeAt.get(key);
    if (beforeIndex === undefined || moved.has(key)) {
      ops.push(make.set(item, index));
    } else if (!same(before[beforeIndex], item)) {
      ops.push(make.set(item));
    }
  });
  return ops;
}

/** Distinct numbers replaced by their rank, 0..n-1, keeping their order. */
function renumber(values: readonly number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const rankOf = new Map(sorted.map((value, rank) => [value, rank]));
  return values.map((value) => rankOf.get(value)!);
}

function entryMap(doc: Doc, field: EntryField): Record<string, unknown> {
  return (doc[field] as Record<string, unknown> | undefined) ?? {};
}

function diffEntries(before: Doc, after: Doc): StoreChange[] {
  const ops: StoreChange[] = [];
  for (const field of ENTRY_FIELDS) {
    const was = entryMap(before, field);
    const now = entryMap(after, field);
    if (was === now) continue;
    for (const [key, value] of Object.entries(now)) {
      if (!(key in was) || !same(was[key], value)) ops.push({ kind: "setEntry", field, key, value });
    }
    for (const key of Object.keys(was)) {
      if (!(key in now)) ops.push({ kind: "removeEntry", field, key });
    }
  }
  return ops;
}

/**
 * Whole-value fields. `handleSeq` is special: applying a handle entry raises
 * it, so it is compared against what the entries will have left it at rather
 * than against `before`.
 */
function diffFields(before: Doc, after: Doc, entryOps: StoreChange[]): StoreChange[] {
  const ops: StoreChange[] = [];
  for (const field of VALUE_FIELDS) {
    let was: unknown = before[field];
    if (field === "handleSeq") {
      for (const op of entryOps) {
        if (op.kind === "setEntry" && op.field === "handles") was = raisedSeq(was, op.value);
      }
    }
    const now = after[field];
    if (!same(was, now)) {
      ops.push({ kind: "setField", field, value: now });
    }
  }
  return ops;
}

/** What `handleSeq` becomes once this handle is set: never below its number. */
function raisedSeq(seq: unknown, handle: unknown): unknown {
  const n = handleNumber(handle);
  if (n === undefined) return seq;
  const current = typeof seq === "number" ? seq : 0;
  return Math.max(current, n);
}

/* ---------------------------------------------------------------------- */
/* apply                                                                    */
/* ---------------------------------------------------------------------- */

/**
 * Why a record could not be applied. Only `setPart` refuses (onto a screen
 * that does not exist); every other record is a no-op when its target is
 * gone, because "already deleted" is the normal outcome of a concurrent edit.
 */
export class CollabApplyError extends Error {
  constructor(public reason: string) {
    super(`Cannot apply change: ${reason}`);
    this.name = "CollabApplyError";
  }
}

type DraftDoc = Draft<Doc>;

/**
 * One record folded into a document.
 *
 * Pure and structurally shared (immer), idempotent, and safe against the
 * caller: immer freezes whatever payload ends up in the result, so a later
 * attempt to mutate the op throws instead of silently changing the document.
 * Returns `doc` itself when the record changes nothing.
 */
export function applyChange(doc: Doc, op: StoreChange): Doc {
  if (op.kind === "setPart" && !doc.screens.some((screen) => screen.UniqueId === op.screenId)) {
    throw new CollabApplyError("screen-missing");
  }
  return produce(doc, (draft) => {
    applyToDraft(draft, op);
  });
}

/** A list of records folded in order. What the server and a receiving client both run. */
export function apply(doc: Doc, ops: StoreChange[]): Doc {
  let result = doc;
  for (const op of ops) result = applyChange(result, op);
  return result;
}

function applyToDraft(d: DraftDoc, op: StoreChange): void {
  switch (op.kind) {
    case "setPart":
      return setPartIn(d, op.screenId, op.part, op.index);
    case "removePart":
      for (const screen of d.screens) removeById(rootOf(screen).Children, op.partId);
      return;
    case "reorderParts": {
      const screen = d.screens.find((s) => s.UniqueId === op.screenId);
      if (screen) reorderById(rootOf(screen).Children, op.order);
      return;
    }
    case "addScreen": {
      const at = d.screens.findIndex((s) => s.UniqueId === op.screen.UniqueId);
      const screen = op.screen as Draft<Screen>;
      if (at >= 0) d.screens[at] = screen;
      else d.screens.splice(clampIndex(op.index, d.screens.length), 0, screen);
      return;
    }
    case "removeScreen":
      removeById(d.screens, op.screenId);
      return;
    case "renameScreen": {
      const screen = d.screens.find((s) => s.UniqueId === op.screenId);
      if (screen) screen.Name = op.name;
      return;
    }
    case "setScreenProps":
      return setScreenPropsIn(d, op.screenId, op.screen);
    case "reorderScreens":
      reorderById(d.screens, op.order);
      return;
    case "setVariable":
      setRecord(d.variables as Variable[], variableKey, op.variable.Name, op.variable, op.index);
      return;
    case "removeVariable":
      removeRecords(d.variables as Variable[], variableKey, op.name);
      return;
    case "setAlarm": {
      // Looked up by the op's key, and by the alarm's own in case they differ,
      // so a second application finds what the first one inserted.
      const alarms = d.alarms as Alarm[];
      const key = lastIndexBy(alarms, alarmKeyOf, op.key) >= 0 ? op.key : alarmKeyOf(op.alarm);
      setRecord(alarms, alarmKeyOf, key, op.alarm, op.index);
      return;
    }
    case "removeAlarm":
      removeRecords(d.alarms as Alarm[], alarmKeyOf, op.key);
      return;
    case "setBinding":
      setRecord(d.bindings as Binding[], bindingKey, bindingKey(op.binding), op.binding, op.index);
      return;
    case "removeBinding":
      removeRecords(d.bindings as Binding[], bindingKey, bindingKeyOf(op.targetId, op.property));
      return;
    case "setEntry": {
      const target = d as unknown as Record<string, Record<string, unknown> | undefined>;
      const map = (target[op.field] ??= {});
      map[op.key] = op.value;
      if (op.field === "handles") {
        const raised = raisedSeq(d.handleSeq, op.value);
        if (raised !== d.handleSeq) d.handleSeq = raised as number;
      }
      return;
    }
    case "removeEntry": {
      const map = (d as unknown as Record<string, Record<string, unknown> | undefined>)[op.field];
      if (map && op.key in map) delete map[op.key];
      return;
    }
    case "setField": {
      const target = d as unknown as Record<string, unknown>;
      if (op.value === undefined) delete target[op.field];
      else target[op.field] = op.value;
      return;
    }
  }
}

function setPartIn(d: DraftDoc, screenId: string, part: Part, index: number | undefined): void {
  const screen = d.screens.find((s) => s.UniqueId === screenId)!;
  const here = rootOf(screen).Children as Part[];
  const at = here.findIndex((p) => p.UniqueId === part.UniqueId);
  if (at >= 0) {
    here[at] = part;
    return;
  }
  for (const other of d.screens) {
    if (other !== screen) removeById(rootOf(other).Children, part.UniqueId);
  }
  here.splice(clampIndex(index, here.length), 0, part);
}

function setScreenPropsIn(d: DraftDoc, screenId: string, props: Screen): void {
  const at = d.screens.findIndex((s) => s.UniqueId === screenId);
  if (at < 0) return;
  const current = d.screens[at];
  // Name and parts are not this record's to change: they travel as
  // renameScreen and setPart, and a concurrent edit to either must survive.
  const roots = props.Children.map((root, i) => ({
    ...root,
    Children: current.Children[i]?.Children ?? [],
  }));
  d.screens[at] = {
    ...(props as Draft<Screen>),
    UniqueId: screenId,
    Name: current.Name,
    Children: roots as unknown as Draft<Screen>["Children"],
  };
}

function removeById(items: { UniqueId: string }[], id: string): void {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].UniqueId === id) items.splice(i, 1);
  }
}

/**
 * Stable reorder: the listed ids that are present take the slots the listed
 * ids occupy now, in the listed order; everything unlisted stays put. So a
 * reorder that names a part a collaborator just deleted, or misses one they
 * just added, still does the sensible thing - and doing it twice is the same
 * as doing it once.
 */
function reorderById<T extends { UniqueId: string }>(items: T[], order: readonly string[]): void {
  const listed = new Set(order);
  const slots: number[] = [];
  const byId = new Map<string, T>();
  items.forEach((item, index) => {
    if (listed.has(item.UniqueId) && !byId.has(item.UniqueId)) {
      slots.push(index);
      byId.set(item.UniqueId, item);
    }
  });
  const seen = new Set<string>();
  const sequence: T[] = [];
  for (const id of order) {
    const item = byId.get(id);
    if (item && !seen.has(id)) {
      seen.add(id);
      sequence.push(item);
    }
  }
  slots.forEach((slot, i) => {
    if (items[slot] !== sequence[i]) items[slot] = sequence[i];
  });
}

function setRecord<T>(items: T[], keyOf: (item: T) => string, key: string, value: T, index: number | undefined): void {
  const at = lastIndexBy(items, keyOf, key);
  if (at >= 0) items[at] = value;
  else items.splice(clampIndex(index, items.length), 0, value);
}

function removeRecords<T>(items: T[], keyOf: (item: T) => string, key: string): void {
  for (let i = items.length - 1; i >= 0; i--) {
    if (keyOf(items[i]) === key) items.splice(i, 1);
  }
}

/* ---------------------------------------------------------------------- */
/* invert                                                                   */
/* ---------------------------------------------------------------------- */

/**
 * The records that undo `ops`, to be applied to `apply(before, ops)`.
 *
 * Undo in a shared project cannot restore a snapshot - that would wipe out
 * whatever collaborators did since - so it is sent as a change like any other:
 * the old part, the old name, the old entry. Each op's inverse is computed
 * against the document as it stood just before that op, and the inverses are
 * returned last op first.
 *
 * Exact for the synced slice, with two documented limits: a record array
 * holding duplicate keys cannot have every duplicate restored, and removing an
 * entry from a map that did not exist leaves an empty map behind.
 */
export function invert(before: Doc, ops: StoreChange[]): StoreChange[] {
  const undo: StoreChange[][] = [];
  let doc = before;
  for (const op of ops) {
    const inverse = inverseOf(doc, op);
    const next = applyChange(doc, op);
    // Restoring a handle entry can raise the sequence again; put it back.
    if ((op.kind === "setEntry" || op.kind === "removeEntry") && op.field === "handles") {
      const restored = apply(next, inverse);
      if (restored.handleSeq !== doc.handleSeq) {
        inverse.push({ kind: "setField", field: "handleSeq", value: doc.handleSeq });
      }
    }
    undo.push(inverse);
    doc = next;
  }
  return undo.reverse().flat();
}

function findPart(doc: Doc, partId: string): { screenId: string; part: Part; index: number } | undefined {
  for (const screen of doc.screens) {
    const index = partsOf(screen).findIndex((p) => p.UniqueId === partId);
    if (index >= 0) return { screenId: screen.UniqueId, part: partsOf(screen)[index], index };
  }
  return undefined;
}

function inverseOf(doc: Doc, op: StoreChange): StoreChange[] {
  const screenAt = (id: string) => doc.screens.findIndex((s) => s.UniqueId === id);
  switch (op.kind) {
    case "setPart": {
      const was = findPart(doc, op.part.UniqueId);
      if (!was) return [{ kind: "removePart", screenId: op.screenId, partId: op.part.UniqueId }];
      return [{ kind: "setPart", screenId: was.screenId, part: was.part, index: was.index }];
    }
    case "removePart": {
      const was = findPart(doc, op.partId);
      return was ? [{ kind: "setPart", screenId: was.screenId, part: was.part, index: was.index }] : [];
    }
    case "reorderParts": {
      const at = screenAt(op.screenId);
      if (at < 0) return [];
      return [{ kind: "reorderParts", screenId: op.screenId, order: idsOf(partsOf(doc.screens[at])) }];
    }
    case "addScreen": {
      const at = screenAt(op.screen.UniqueId);
      if (at < 0) return [{ kind: "removeScreen", screenId: op.screen.UniqueId }];
      return [{ kind: "addScreen", screen: doc.screens[at], index: at }];
    }
    case "removeScreen": {
      const at = screenAt(op.screenId);
      return at < 0 ? [] : [{ kind: "addScreen", screen: doc.screens[at], index: at }];
    }
    case "renameScreen": {
      const at = screenAt(op.screenId);
      return at < 0 ? [] : [{ kind: "renameScreen", screenId: op.screenId, name: doc.screens[at].Name }];
    }
    case "setScreenProps": {
      const at = screenAt(op.screenId);
      if (at < 0) return [];
      return [{ kind: "setScreenProps", screenId: op.screenId, screen: withoutParts(doc.screens[at]) }];
    }
    case "reorderScreens":
      return [{ kind: "reorderScreens", order: idsOf(doc.screens) }];
    case "setVariable":
      return inverseOfSet(doc.variables, variableKey, op.variable.Name, {
        set: (variable, index) => ({ kind: "setVariable", variable, ...(index === undefined ? {} : { index }) }),
        remove: (name) => ({ kind: "removeVariable", name }),
      });
    case "removeVariable":
      return inverseOfRemove(doc.variables, variableKey, op.name, (variable, index) => ({
        kind: "setVariable",
        variable,
        index,
      }));
    case "setAlarm": {
      const key = lastIndexBy(doc.alarms, alarmKeyOf, op.key) >= 0 ? op.key : alarmKeyOf(op.alarm);
      return inverseOfSet(doc.alarms, alarmKeyOf, key, {
        set: (alarm, index) => ({ kind: "setAlarm", key: alarmKeyOf(alarm), alarm, ...(index === undefined ? {} : { index }) }),
        remove: (k) => ({ kind: "removeAlarm", key: k }),
      });
    }
    case "removeAlarm":
      return inverseOfRemove(doc.alarms, alarmKeyOf, op.key, (alarm, index) => ({
        kind: "setAlarm",
        key: alarmKeyOf(alarm),
        alarm,
        index,
      }));
    case "setBinding":
      return inverseOfSet(doc.bindings, bindingKey, bindingKey(op.binding), {
        set: (binding, index) => ({ kind: "setBinding", binding, ...(index === undefined ? {} : { index }) }),
        remove: () => ({ kind: "removeBinding", targetId: op.binding.targetId, property: op.binding.property }),
      });
    case "removeBinding":
      return inverseOfRemove(doc.bindings, bindingKey, bindingKeyOf(op.targetId, op.property), (binding, index) => ({
        kind: "setBinding",
        binding,
        index,
      }));
    case "setEntry":
    case "removeEntry": {
      const map = entryMap(doc, op.field);
      if (op.key in map) return [{ kind: "setEntry", field: op.field, key: op.key, value: map[op.key] }];
      return op.kind === "setEntry" ? [{ kind: "removeEntry", field: op.field, key: op.key }] : [];
    }
    case "setField":
      return [{ kind: "setField", field: op.field, value: doc[op.field] }];
  }
}

function inverseOfSet<T>(items: readonly T[], keyOf: (item: T) => string, key: string, make: RecordOps<T>): StoreChange[] {
  const at = lastIndexBy(items, keyOf, key);
  return at >= 0 ? [make.set(items[at], at)] : [make.remove(key)];
}

function inverseOfRemove<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  key: string,
  set: (item: T, index: number) => StoreChange,
): StoreChange[] {
  // With duplicates every copy goes; only the last can be put back.
  const at = lastIndexBy(items, keyOf, key);
  if (at < 0) return [];
  const earlier = items.slice(0, at).filter((item) => keyOf(item) === key).length;
  return [set(items[at], at - earlier)];
}

/* ---------------------------------------------------------------------- */
/* validStoreChange                                                         */
/* ---------------------------------------------------------------------- */

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);

const isIndex = (value: unknown) => value === undefined || (Number.isInteger(value) && (value as number) >= 0);

const isEntryField = (value: unknown): value is EntryField => (ENTRY_FIELDS as readonly unknown[]).includes(value);

const isValueField = (value: unknown): value is ValueField => (VALUE_FIELDS as readonly unknown[]).includes(value);

/** A part or screen-shaped object with the id the store keys it by. */
const hasUniqueId = (value: unknown) => isObject(value) && isString(value.UniqueId) && isString(value.Type);

function isScreenShaped(value: unknown): boolean {
  if (!hasUniqueId(value)) return false;
  const screen = value as Record<string, unknown>;
  if (!isString(screen.Name) || !Array.isArray(screen.Children) || screen.Children.length === 0) return false;
  return screen.Children.every((root) => isObject(root) && Array.isArray(root.Children) && root.Children.every(hasUniqueId));
}

/**
 * The server's structural guard on a record from the network.
 *
 * Not a schema validation - a part is checked to be an object with a string
 * UniqueId and Type, not to be a valid Lamp - but enough that `apply` cannot
 * be made to throw on a missing field or to write outside the synced slice.
 * Anything it lets through either applies or is a no-op, except setPart onto
 * a missing screen, which `apply` reports as CollabApplyError.
 */
export function validStoreChange(value: unknown): value is StoreChange {
  if (!isObject(value) || !isString(value.kind)) return false;
  const v = value;
  switch (v.kind) {
    case "setPart":
      return isString(v.screenId) && hasUniqueId(v.part) && isIndex(v.index);
    case "removePart":
      return isString(v.screenId) && isString(v.partId);
    case "reorderParts":
      return isString(v.screenId) && isStringArray(v.order);
    case "addScreen":
      return isScreenShaped(v.screen) && isIndex(v.index);
    case "removeScreen":
      return isString(v.screenId);
    case "renameScreen":
      return isString(v.screenId) && isString(v.name);
    case "setScreenProps":
      return isString(v.screenId) && isScreenShaped(v.screen);
    case "reorderScreens":
      return isStringArray(v.order);
    case "setVariable":
      return isObject(v.variable) && isString(v.variable.Name) && isIndex(v.index);
    case "removeVariable":
      return isString(v.name);
    case "setAlarm":
      return (
        isString(v.key) &&
        isObject(v.alarm) &&
        isString(v.alarm.Message) &&
        alarmKeyOf(v.alarm as unknown as Alarm) === v.key &&
        isIndex(v.index)
      );
    case "removeAlarm":
      return isString(v.key);
    case "setBinding":
      return (
        isObject(v.binding) &&
        isString(v.binding.targetId) &&
        isString(v.binding.property) &&
        isString(v.binding.tag) &&
        isIndex(v.index)
      );
    case "removeBinding":
      return isString(v.targetId) && isString(v.property);
    case "setEntry":
      return isEntryField(v.field) && isString(v.key) && "value" in v && v.value !== undefined;
    case "removeEntry":
      return isEntryField(v.field) && isString(v.key);
    case "setField":
      return isValueField(v.field);
    default:
      return false;
  }
}

/* ---------------------------------------------------------------------- */
/* compact                                                                  */
/* ---------------------------------------------------------------------- */

const PART_OR_SCREEN_KINDS = new Set<StoreChange["kind"]>([
  "setPart",
  "removePart",
  "reorderParts",
  "addScreen",
  "removeScreen",
  "renameScreen",
  "setScreenProps",
  "reorderScreens",
]);

/**
 * A client's send queue, with records a later record fully supersedes dropped.
 *
 * Dragging a part produces a setPart per pointer move; while offline the queue
 * would otherwise grow by the hundred. Only the cases that are obviously safe
 * are collapsed, and an earlier op is dropped only when a later one of the same
 * kind on the same target makes it irrelevant:
 *
 * - setPart: same part, same screen, same index, and no part or screen record
 *   in between (any of those could shift where an insert lands).
 * - setVariable / setAlarm / setBinding: same key, same index, and no record
 *   of that array in between, for the same reason.
 * - setEntry: same field and key, except `handles`, whose entries also raise
 *   `handleSeq` and so are never dropped.
 * - setField: same field; the last value wins whatever came between.
 *
 * Applying the compacted list always gives the same document as the original.
 */
export function compact(ops: StoreChange[]): StoreChange[] {
  return ops.filter((op, i) => !supersededLater(op, ops, i));
}

function supersededLater(op: StoreChange, ops: StoreChange[], at: number): boolean {
  for (let j = at + 1; j < ops.length; j++) {
    const later = ops[j];
    const verdict = compare(op, later);
    if (verdict === "superseded") return true;
    if (verdict === "blocked") return false;
  }
  return false;
}

type Verdict = "superseded" | "blocked" | "independent";

function compare(op: StoreChange, later: StoreChange): Verdict {
  switch (op.kind) {
    case "setPart":
      if (
        later.kind === "setPart" &&
        later.part.UniqueId === op.part.UniqueId &&
        later.screenId === op.screenId &&
        later.index === op.index
      ) {
        return "superseded";
      }
      return PART_OR_SCREEN_KINDS.has(later.kind) ? "blocked" : "independent";
    case "setVariable":
      if (later.kind === "setVariable" && later.variable.Name === op.variable.Name && later.index === op.index) {
        return "superseded";
      }
      return later.kind === "setVariable" || later.kind === "removeVariable" ? "blocked" : "independent";
    case "setAlarm":
      if (
        later.kind === "setAlarm" &&
        later.key === op.key &&
        later.index === op.index &&
        alarmKeyOf(op.alarm) === op.key &&
        alarmKeyOf(later.alarm) === later.key
      ) {
        return "superseded";
      }
      return later.kind === "setAlarm" || later.kind === "removeAlarm" ? "blocked" : "independent";
    case "setBinding":
      if (later.kind === "setBinding" && bindingKey(later.binding) === bindingKey(op.binding) && later.index === op.index) {
        return "superseded";
      }
      return later.kind === "setBinding" || later.kind === "removeBinding" ? "blocked" : "independent";
    case "setEntry":
      if (op.field === "handles") return "blocked";
      if (later.kind === "setEntry" && later.field === op.field && later.key === op.key) return "superseded";
      if (later.kind === "removeEntry" && later.field === op.field && later.key === op.key) return "blocked";
      return "independent";
    case "setField":
      return later.kind === "setField" && later.field === op.field ? "superseded" : "independent";
    default:
      return "blocked";
  }
}
