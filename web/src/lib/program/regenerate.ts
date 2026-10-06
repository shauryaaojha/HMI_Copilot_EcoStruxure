/**
 * Regenerate one screen as a reviewable diff, never by delete-and-recreate.
 *
 * docs/AUDIT_2026-10.md §5 is the argument. Deleting a screen and generating
 * it again gives every object a new UniqueId - which Bindings.dat, navigation
 * and Lua scripts refer to - and throws away every hand edit. So instead:
 *
 * - the screen is compiled again from its recipe (its ScreenProgram) against
 *   the tags, Plant Model and library as they are now;
 * - each fresh part carries a stable key (the name the compiler asked for),
 *   and so does each part it placed before (ObjectMeta.key), so old and new
 *   are matched by key, not by position or by final name;
 * - what changed is grouped into units an engineer can judge - a whole
 *   composite (a faceplate card) is one unit, a lone part is one unit - and
 *   each unit is added, updated or removed only if the engineer ticks it;
 * - a matched object keeps its UniqueId and its name, so its bindings and
 *   everything outside the screen that names it keep working;
 * - provenance decides the defaults: an object the generator placed and
 *   nobody touched is replaced by default; one the engineer edited, placed,
 *   imported, locked or hid is kept by default, and is listed so the
 *   engineer can choose. Objects without a key are never touched at all.
 *
 * Pure: plain data in, plain data out, no store and no network, so every
 * rule here is a test.
 */

import type { Part } from "@/lib/ote/schema";
import type { Scale } from "@/lib/ote/converters";
import type { Binding, CompositeInstance, ObjectMeta } from "@/store/types";

/** A screen compiled again, as the regenerate route returns it. */
export interface FreshScreen {
  parts: Part[];
  /** Part UniqueId (fresh) -> stable key. */
  keys: Record<string, string>;
  wires: { key: string; tag: string; property: string; converter?: Scale }[];
  composites: { kind: string; name: string; props: Record<string, unknown>; partKeys: string[] }[];
  notes: string[];
}

/** The screen as it stands, with what the store knows about its objects. */
export interface CurrentScreen {
  parts: Part[];
  meta: Record<string, ObjectMeta>;
  /** Bindings whose target is on this screen. */
  bindings: Binding[];
  /** Composite instances on this screen. */
  composites: CompositeInstance[];
}

export type UnitKind = "add" | "update" | "remove";

export interface RegenUnit {
  /** The unit's key: the composite's stem key, or the lone part's key. */
  id: string;
  kind: UnitKind;
  /** Whether the engineer's work is in the way: edited, manual, imported, locked, hidden or unknown. */
  protected: boolean;
  /** Ticked when the dialog opens. */
  defaultAccept: boolean;
  /** What it is, for the list: "FaceplateCard Card_PMP101", "TextBox Title". */
  label: string;
  /** Why it is listed, in a phrase. */
  reason: string;
  /** What differs, for an update: "position", "size", "text", "binding", "style", "parts". */
  changes: string[];
  /** Current part UniqueIds in the unit. */
  current: string[];
  /** Fresh keys in the unit. */
  fresh: string[];
}

export interface RegenPlan {
  units: RegenUnit[];
  /** Keyed units that compiled to exactly what is there. */
  unchanged: number;
  /** Objects on the screen the generator never placed (no key): never touched. */
  untouched: number;
}

/* ------------------------------------------------------------- matching */

/** Everything about a part except its identity. */
function body(p: Part): string {
  const { UniqueId: _u, Name: _n, ...rest } = p as Part & Record<string, unknown>;
  void _u;
  void _n;
  return JSON.stringify(rest);
}

/**
 * A binding as what it means: property, tag, and a converter's range. The
 * generation event carries only a scale's min and max, so a scale is compared
 * on those and nothing else.
 */
const bindingSig = (bs: { property: string; tag: string; converter?: Scale }[]) =>
  bs.map((b) => `${b.property}|${b.tag}|${b.converter ? `${b.converter.min}..${b.converter.max}` : ""}`).sort().join(";");

/** Why the engineer's hand may be on an object. */
function guard(meta: ObjectMeta | undefined): string | null {
  if (meta?.locked) return "locked";
  if (meta?.hidden) return "hidden";
  switch (meta?.origin) {
    case "generated":
      return null;
    case "edited":
      return "edited by hand";
    case "manual":
      return "placed by hand";
    case "imported":
      return "imported";
    default:
      return "origin unknown";
  }
}

/**
 * Current part UniqueId by key. Parts with a recorded key match on it. A part
 * from before keys were recorded may still match by name - `Title` or
 * `Title_3` for key `Title` - but it counts as protected, since nobody can say
 * whether it was edited.
 */
function matchCurrent(current: CurrentScreen, freshKeys: Set<string>): Map<string, string> {
  const byKey = new Map<string, string>();
  for (const p of current.parts) {
    const key = current.meta[p.UniqueId]?.key;
    if (key && !byKey.has(key)) byKey.set(key, p.UniqueId);
  }
  for (const p of current.parts) {
    if (current.meta[p.UniqueId]?.key) continue;
    for (const k of [p.Name, p.Name.replace(/_\d+$/, "")]) {
      if (freshKeys.has(k) && !byKey.has(k)) {
        byKey.set(k, p.UniqueId);
        break;
      }
    }
  }
  return byKey;
}

const keyOfPart = (fresh: FreshScreen) => (p: Part) => fresh.keys[p.UniqueId] ?? p.Name;

/* --------------------------------------------------------------- planning */

export function planRegeneration(current: CurrentScreen, fresh: FreshScreen): RegenPlan {
  const freshKey = keyOfPart(fresh);
  const freshByKey = new Map(fresh.parts.map((p) => [freshKey(p), p]));
  const byKey = matchCurrent(current, new Set(freshByKey.keys()));
  const idToKey = new Map([...byKey.entries()].map(([k, id]) => [id, k]));
  const partById = new Map(current.parts.map((p) => [p.UniqueId, p]));
  const wiresByKey = new Map<string, FreshScreen["wires"]>();
  for (const w of fresh.wires) (wiresByKey.get(w.key) ?? wiresByKey.set(w.key, []).get(w.key)!).push(w);
  const bindingsById = new Map<string, Binding[]>();
  for (const b of current.bindings) (bindingsById.get(b.targetId) ?? bindingsById.set(b.targetId, []).get(b.targetId)!).push(b);

  // Fresh units: each composite, then each lone part.
  const inComposite = new Set(fresh.composites.flatMap((c) => c.partKeys));
  const freshUnits: { id: string; keys: string[]; label: string }[] = [
    ...fresh.composites.map((c) => ({ id: c.partKeys[0] ?? c.name, keys: c.partKeys, label: `${c.kind} ${c.partKeys[0] ?? c.name}` })),
    ...fresh.parts.filter((p) => !inComposite.has(freshKey(p))).map((p) => ({ id: freshKey(p), keys: [freshKey(p)], label: `${p.Type} ${freshKey(p)}` })),
  ];

  const units: RegenUnit[] = [];
  let unchanged = 0;
  const claimed = new Set<string>();

  for (const u of freshUnits) {
    const ids = u.keys.map((k) => byKey.get(k)).filter((x): x is string => !!x);
    ids.forEach((id) => claimed.add(id));
    if (ids.length === 0) {
      units.push({ id: u.id, kind: "add", protected: false, defaultAccept: true, label: u.label, reason: "new in this compile", changes: [], current: [], fresh: u.keys });
      continue;
    }
    const changes = new Set<string>();
    if (ids.length !== u.keys.length) changes.add("parts");
    for (const k of u.keys) {
      const id = byKey.get(k);
      const f = freshByKey.get(k)!;
      if (!id) continue;
      const c = partById.get(id)!;
      if (body(c) !== body(f)) {
        if (c.Location?.Left !== f.Location?.Left || c.Location?.Top !== f.Location?.Top) changes.add("position");
        if (c.Width !== f.Width || c.Height !== f.Height) changes.add("size");
        const text = (p: Part) => JSON.stringify((p as unknown as Record<string, unknown>).Text ?? (p as unknown as Record<string, unknown>).Texts ?? null);
        if (text(c) !== text(f)) changes.add("text");
        const { Location: _a, Width: _b, Height: _c, ...cs } = c as Part & Record<string, unknown>;
        const { Location: _d, Width: _e, Height: _f, ...fs } = f as Part & Record<string, unknown>;
        void _a; void _b; void _c; void _d; void _e; void _f;
        const strip = (o: Record<string, unknown>) => JSON.stringify({ ...o, UniqueId: 0, Name: 0, Text: 0, Texts: 0 });
        if (strip(cs) !== strip(fs)) changes.add("style");
      }
      if (bindingSig(bindingsById.get(id) ?? []) !== bindingSig(wiresByKey.get(k) ?? [])) changes.add("binding");
    }
    if (changes.size === 0) {
      unchanged++;
      continue;
    }
    const why = ids.map((id) => guard(current.meta[id])).find((g) => g !== null) ?? null;
    units.push({
      id: u.id,
      kind: "update",
      protected: why !== null,
      defaultAccept: why === null,
      label: u.label,
      reason: why ? `kept: ${why}` : "compiles differently now",
      changes: [...changes],
      current: ids,
      fresh: u.keys,
    });
  }

  // Keyed parts the new compile no longer places: removals, one unit per
  // current composite where they belong to one.
  const orphans = current.parts.filter((p) => idToKey.has(p.UniqueId) && !claimed.has(p.UniqueId));
  const seen = new Set<string>();
  for (const p of orphans) {
    if (seen.has(p.UniqueId)) continue;
    const comp = current.composites.find((c) => c.partIds.includes(p.UniqueId));
    const ids = comp ? comp.partIds.filter((id) => orphans.some((o) => o.UniqueId === id)) : [p.UniqueId];
    ids.forEach((id) => seen.add(id));
    const why = ids.map((id) => guard(current.meta[id])).find((g) => g !== null) ?? null;
    const key = idToKey.get(ids[0])!;
    units.push({
      id: key,
      kind: "remove",
      protected: why !== null,
      defaultAccept: why === null,
      label: comp ? `${comp.kind} ${key}` : `${p.Type} ${key}`,
      reason: why ? `no longer compiled, kept: ${why}` : "no longer compiled",
      changes: [],
      current: ids,
      fresh: [],
    });
  }

  const untouched = current.parts.filter((p) => !idToKey.has(p.UniqueId)).length;
  const order: Record<UnitKind, number> = { update: 0, add: 1, remove: 2 };
  units.sort((a, b) => Number(a.protected) - Number(b.protected) || order[a.kind] - order[b.kind] || a.id.localeCompare(b.id));
  return { units, unchanged, untouched };
}

/* ---------------------------------------------------------------- applying */

export interface AppliedScreen {
  /** The screen's new child list, in paint order. */
  parts: Part[];
  /** This screen's bindings after the change. */
  bindings: Binding[];
  /** Meta for this screen's parts after the change (absent key = no meta). */
  meta: Record<string, ObjectMeta>;
  /** This screen's composite instances after the change. */
  composites: CompositeInstance[];
  /** What happened, for the log and the version. */
  summary: { added: number; updated: number; removed: number };
}

/**
 * Apply the accepted units. Nothing outside them moves: parts keep their
 * place in paint order (an update replaces in place, an addition lands next to
 * its neighbour in the fresh compile), untouched parts keep their meta, and a
 * replaced part keeps its UniqueId and name.
 */
export function applyRegeneration(
  current: CurrentScreen,
  fresh: FreshScreen,
  plan: RegenPlan,
  accepted: ReadonlySet<string>,
  /** Every part name in the project, so an added part's name is unique. */
  taken: Set<string>,
  screenId: string,
  newId: () => string = () => crypto.randomUUID(),
): AppliedScreen {
  const chosen = plan.units.filter((u) => accepted.has(u.id));
  const freshKey = keyOfPart(fresh);
  const freshByKey = new Map(fresh.parts.map((p) => [freshKey(p), p]));
  const byKey = matchCurrent(current, new Set(freshByKey.keys()));
  const summary = { added: 0, updated: 0, removed: 0 };

  let parts = current.parts.map((p) => structuredClone(p));
  const meta: Record<string, ObjectMeta> = structuredClone(current.meta);
  let bindings = current.bindings.map((b) => ({ ...b }));
  let composites = current.composites.map((c) => ({ ...c, partIds: [...c.partIds] }));

  // Removals first, so a name they free can be reused by an addition.
  const removed = new Set(chosen.filter((u) => u.kind === "remove").flatMap((u) => u.current));
  for (const id of removed) {
    const p = parts.find((x) => x.UniqueId === id);
    if (p) taken.delete(p.Name);
  }
  if (removed.size) {
    parts = parts.filter((p) => !removed.has(p.UniqueId));
    bindings = bindings.filter((b) => !removed.has(b.targetId));
    for (const id of removed) delete meta[id];
    composites = composites.filter((c) => !c.partIds.some((id) => removed.has(id)));
    summary.removed += chosen.filter((u) => u.kind === "remove").length;
  }

  /** Fresh key -> the id it has after this apply. */
  const idOf = new Map<string, string>();
  const nameOf = new Map<string, string>();
  const replaced = new Set<string>();

  for (const unit of chosen.filter((u) => u.kind !== "remove")) {
    const comp = fresh.composites.find((c) => (c.partKeys[0] ?? c.name) === unit.id);
    // Names for parts that are new: a composite keeps one stem for all its parts.
    const newKeys = unit.fresh.filter((k) => !byKey.has(k));
    if (comp && newKeys.length) {
      const stemKey = comp.partKeys[0];
      const existingStem = byKey.has(stemKey) ? current.parts.find((p) => p.UniqueId === byKey.get(stemKey))?.Name : undefined;
      let stem = existingStem ?? freshByKey.get(stemKey)?.Name ?? stemKey;
      const suffixOf = (k: string) => (k.startsWith(stemKey) ? k.slice(stemKey.length) : `_${k}`);
      if (!existingStem) {
        const base = stem;
        for (let n = 2; newKeys.some((k) => taken.has(stem + suffixOf(k))); n++) stem = `${base}_${n}`;
      }
      for (const k of newKeys) nameOf.set(k, stem + suffixOf(k));
    }
    for (const k of unit.fresh) {
      const f = freshByKey.get(k);
      if (!f) continue;
      const keep = byKey.get(k);
      const old = keep ? parts.find((p) => p.UniqueId === keep) : undefined;
      let name = old?.Name ?? nameOf.get(k);
      if (!name) {
        name = f.Name;
        for (let n = 2; taken.has(name); n++) name = `${f.Name.replace(/_\d+$/, "")}_${n}`;
      }
      taken.add(name);
      const id = old?.UniqueId ?? newId();
      idOf.set(k, id);
      const next: Part = { ...structuredClone(f), UniqueId: id, Name: name };
      if (old) {
        parts[parts.findIndex((p) => p.UniqueId === id)] = next;
        replaced.add(id);
      } else {
        // Next to its neighbour in the fresh compile, so paint order follows it.
        const order = fresh.parts.map(freshKey);
        const at = order.indexOf(k);
        let index = -1;
        for (let i = at - 1; i >= 0 && index < 0; i--) {
          const neighbour = idOf.get(order[i]) ?? byKey.get(order[i]);
          const pos = neighbour ? parts.findIndex((p) => p.UniqueId === neighbour) : -1;
          if (pos >= 0) index = pos + 1;
        }
        if (index < 0) parts.push(next);
        else parts.splice(index, 0, next);
      }
      meta[id] = { ...(meta[id]?.groupId ? { groupId: meta[id].groupId } : {}), origin: "generated", key: k };
    }
    // The unit's bindings are the fresh ones, on the kept ids.
    const ids = new Set(unit.fresh.map((k) => idOf.get(k)).filter(Boolean) as string[]);
    bindings = bindings.filter((b) => !ids.has(b.targetId));
    for (const w of fresh.wires) {
      if (!unit.fresh.includes(w.key)) continue;
      const id = idOf.get(w.key);
      const part = parts.find((p) => p.UniqueId === id);
      if (id && part) bindings.push({ tag: w.tag, targetId: id, targetName: part.Name, property: w.property, ...(w.converter ? { converter: w.converter } : {}) });
    }
    // The unit's composite: the old instance goes, the fresh one is adopted.
    if (comp) {
      const partIds = comp.partKeys.map((k) => idOf.get(k)).filter(Boolean) as string[];
      const old = composites.find((c) => c.partIds.some((id) => ids.has(id)));
      composites = composites.filter((c) => c !== old);
      const cid = old?.id ?? newId();
      const stemName = parts.find((p) => p.UniqueId === partIds[0])?.Name ?? comp.name;
      composites.push({ id: cid, kind: comp.kind, name: stemName, props: structuredClone(comp.props), screenId, partIds });
      for (const id of partIds) meta[id] = { ...meta[id], groupId: cid };
    }
    if (unit.kind === "add") summary.added++;
    else summary.updated++;
  }
  void replaced;

  return { parts, bindings, meta, composites, summary };
}
