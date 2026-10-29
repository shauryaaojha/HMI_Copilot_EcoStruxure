/**
 * Tags, the bindings that point at them, and the plant model built from them.
 *
 * Adoption is the delicate one: placeholder tags become real tags, and every
 * reference to the old name has to follow. lib/refs owns those rules so that
 * a new kind of reference is added in one place.
 */


import { current } from "immer";
import { modelPlant} from "@/lib/plant/model";
import { retagEquipment, retagRefs} from "@/lib/refs";


import type { ProjectState, SliceOf } from "../state";
import {
  remember,
  screenHolding,
  touch,
  viewOf,
} from "../internals";

export type TagsSlice = Pick<
  ProjectState,
  | "setPlant"
  | "answerQuestion"
  | "setRange"
  | "connect"
  | "disconnect"
  | "importTags"
  | "adoptTags"
  | "addBinding"
  | "setBinding"
  | "setEquipment"
>;

export const createTagsSlice: SliceOf<TagsSlice> = (set, get) => ({
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
        const rebuilt = modelPlant(s.variables, answers, s.tagImport?.structure);
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
        const band = "normalLow" in patch || "normalHigh" in patch ? "stated" : e.ranges[tag].band;
        e.ranges[tag] = { ...e.ranges[tag], ...patch, source: "engineer", band };
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

    importTags: (variables, meta) =>
      set((s) => {
        s.variables = variables;
        s.tagImport = meta;
      }),

    adoptTags: (variables, meta, renames) =>
      set((s) => {
        const placeholders = new Map(s.variables.map((v) => [v.Name, v]));
        const dropped = new Set([...placeholders.keys()].filter((name) => !renames[name]));
        for (const b of current(s.bindings)) {
          if (!dropped.has(b.tag)) continue;
          const intent = placeholders.get(b.tag)?.Comments || b.tag;
          (s.objectMeta[b.targetId] ??= {}).bindIntent = intent;
        }
        s.bindings = current(s.bindings).filter((b) => !dropped.has(b.tag)).map((b) => ({ ...b, tag: renames[b.tag] ?? b.tag }));
        s.alarms = current(s.alarms).filter((a) => !dropped.has(a.Trigger)).map((a) => ({ ...a, Trigger: renames[a.Trigger] ?? a.Trigger }));
        s.composites = retagRefs(current(s.composites), renames, dropped);
        s.programs = retagRefs(current(s.programs), renames, dropped);
        s.equipment = retagEquipment(current(s.equipment), renames, dropped);
        s.variables = variables;
        s.tagImport = meta;
        if (s.plant) s.plant = modelPlant(variables, s.plant.answers, meta.structure);
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
        touch(s, [targetId]);
        s.bindings = s.bindings.filter((b) => !(b.targetId === targetId && b.property === property));
        // Rebinding a bar keeps its converter: the range is the indicator's.
        if (tag) s.bindings.push({ tag, targetId, targetName: part.Name, property, ...(had?.converter ? { converter: had.converter } : {}) });
      }),

    setEquipment: (equipment) =>
      set((s) => {
        s.equipment = equipment;
      }),
});
