/**
 * Alarms, composites and the programs a generated screen was compiled from.
 *
 * A composite is a group of parts with a recipe attached, so changing its
 * props re-expands it in place rather than editing the parts one by one.
 */


import { applyRegeneration as applyRegenerationPlan} from "@/lib/program/regenerate";
import { current } from "immer";
import {
  uniqueName,
} from "../edits";
import { isEmptyMeta } from "../types";
import { expandComposite, propsFor, unionBox, type CompositeKind } from "@/lib/composites";
import type { ProjectState, SliceOf } from "../state";
import {
  ensureHandles,
  remember,
  sameCondition,
  takenNames,
  viewOf,
} from "../internals";

export type AlarmsSlice = Pick<
  ProjectState,
  | "addComposite"
  | "setCompositeProps"
  | "registerComposite"
  | "setProgram"
  | "markGenerated"
  | "applyRegeneration"
  | "addAlarm"
  | "addFinding"
>;

export const createAlarmsSlice: SliceOf<AlarmsSlice> = (set, get) => ({
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
        for (const part of parts) Object.assign((s.objectMeta[part.UniqueId] ??= {}), { groupId: id, origin: "manual" });
        for (const w of wires) {
          const part = parts[w.index];
          if (part) s.bindings.push({ tag: w.tag, targetId: part.UniqueId, targetName: part.Name, property: w.property, ...(w.converter ? { converter: w.converter } : {}) });
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
        // Re-expanding a generated composite is an edit of it: its parts keep
        // their keys (matched by name) and become "edited", so a regeneration
        // keeps them unless the engineer ticks them.
        const before = new Map(oldParts.map((p) => [p.Name, current(s.objectMeta)[p.UniqueId] ?? {}]));
        const origins = [...before.values()].map((m) => m.origin);
        const origin = origins.some((o) => o === "generated" || o === "edited") ? "edited" : origins.find(Boolean);
        for (const part of parts) {
          const was = before.get(part.Name);
          if (origin || was?.key) Object.assign((s.objectMeta[part.UniqueId] ??= {}), { ...(origin ? { origin } : {}), ...(was?.key ? { key: was.key } : {}) });
        }
        for (const oldId of own) delete s.objectMeta[oldId];
        s.bindings = s.bindings.filter((b) => !own.has(b.targetId));
        for (const part of parts) (s.objectMeta[part.UniqueId] ??= {}).groupId = id;
        for (const w of wires) {
          const part = parts[w.index];
          if (part) s.bindings.push({ tag: w.tag, targetId: part.UniqueId, targetName: part.Name, property: w.property, ...(w.converter ? { converter: w.converter } : {}) });
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

    setProgram: (viewBoxId, program) =>
      set((s) => {
        const screen = s.screens.find((x) => viewOf(x).UniqueId === viewBoxId);
        if (screen) s.programs[screen.UniqueId] = program;
      }),

    markGenerated: (id, key) =>
      set((s) => {
        s.objectMeta[id] = { ...s.objectMeta[id], origin: "generated", key };
      }),

    applyRegeneration: (screenId, fresh, plan, accepted, program) => {
      let summary = { added: 0, updated: 0, removed: 0 };
      set((s) => {
        const screen = s.screens.find((x) => x.UniqueId === screenId);
        if (!screen) return;
        const parts = current(viewOf(screen)).Children;
        const ids = new Set(parts.map((p) => p.UniqueId));
        const allMeta = current(s.objectMeta);
        const result = applyRegenerationPlan(
          {
            parts,
            meta: Object.fromEntries(parts.flatMap((p) => (allMeta[p.UniqueId] ? [[p.UniqueId, allMeta[p.UniqueId]]] : []))),
            bindings: current(s.bindings).filter((b) => ids.has(b.targetId)),
            composites: Object.values(current(s.composites)).filter((c) => c.screenId === screenId || c.partIds.some((id) => ids.has(id))),
          },
          fresh,
          plan,
          new Set(accepted),
          takenNames(s),
          screenId,
        );
        summary = result.summary;
        if (result.summary.added + result.summary.updated + result.summary.removed === 0) {
          s.programs[screenId] = program;
          return;
        }
        remember(s, `Regenerate ${screen.Name}`);
        viewOf(screen).Children = result.parts;
        const kept = new Set(result.parts.map((p) => p.UniqueId));
        for (const id of ids) if (!kept.has(id)) delete s.objectMeta[id];
        for (const p of result.parts) {
          const m = result.meta[p.UniqueId];
          if (m && !isEmptyMeta(m)) s.objectMeta[p.UniqueId] = m;
          else delete s.objectMeta[p.UniqueId];
        }
        s.bindings = [...current(s.bindings).filter((b) => !ids.has(b.targetId)), ...result.bindings];
        for (const [cid, c] of Object.entries(current(s.composites))) {
          if (c.screenId === screenId || c.partIds.some((id) => ids.has(id))) delete s.composites[cid];
        }
        for (const c of result.composites) s.composites[c.id] = c;
        s.programs[screenId] = program;
        s.selectedIds = s.selectedIds.filter((id) => kept.has(id));
        ensureHandles(s);
      });
      return summary;
    },

    addAlarm: (alarm) =>
      set((s) => {
        // One alarm per condition: a second "high on TT_401_PV" replaces the
        // first rather than raising twice. A rebuild of screens that were
        // already there used to double every alarm (25 became 50).
        const same = s.alarms.findIndex((a) => sameCondition(a, alarm));
        if (same >= 0) s.alarms[same] = alarm;
        else s.alarms.push(alarm);
      }),

    addFinding: (finding) =>
      set((s) => {
        s.findings.push(finding);
      }),
});
