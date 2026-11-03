/**
 * Screens: adding, removing, reordering, and where each one sits on the board.
 *
 * A screen owns a ViewBox and the parts inside it, so removing one has to take
 * the bindings and composites that pointed into it with it - that cascade is
 * lib/refs, not something written again here.
 */


import { current } from "immer";
import { rootBox } from "@/lib/ote/schema";
import type { Part, Screen} from "@/lib/ote/schema";
import {
  clonePartsInto,
  uniqueName,
} from "../edits";
import { applyPack } from "@/lib/standard/apply";
import { refreshNavigation as refreshNavigationParts } from "@/lib/ote/layout";
import { withoutObjects } from "@/lib/refs";
import type {
  ImportReport,
} from "../types";


import type { ProjectState, SliceOf } from "../state";
import {
  ensureHandles,
  remember,
  takenNames,
  viewOf,
} from "../internals";

export type ScreensSlice = Pick<
  ProjectState,
  | "applyStandard"
  | "importScreens"
  | "addScreen"
  | "duplicateScreen"
  | "renameScreen"
  | "removeScreen"
  | "setActiveScreen"
  | "placeScreen"
  | "tidyBoard"
  | "reorderScreens"
  | "refreshNavigation"
  | "ensureScreen"
>;

export const createScreensSlice: SliceOf<ScreensSlice> = (set, get) => ({
    applyStandard: (screenId) => {
      const target = get().screens.find((x) => x.UniqueId === (screenId ?? get().activeScreenId)) ?? get().screens[0];
      if (!target) return [];
      const view = viewOf(target);
      // get() hands back plain state, not a draft; applyPack clones what it is given.
      const { parts, changes } = applyPack(view.Children, undefined, rootBox(view, get().target));
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
            s.objectMeta[id] = { origin: "imported" };
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
          s.bindings.push({ tag: b.tag, targetId, targetName: part.Name, property: b.property, ...(b.converter ? { converter: b.converter } : {}) });
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
        // A copy is the engineer's, not the generator's: no keys, no recipe.
        for (const p of viewOf(copy).Children) s.objectMeta[p.UniqueId] = { origin: "manual" };
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
        // Its objects go with it, and so do their bindings and composites.
        const parts = new Set(viewOf(gone).Children.map((part) => part.UniqueId));
        for (const id of parts) delete s.objectMeta[id];
        const kept = withoutObjects(current(s.bindings), current(s.composites), parts);
        s.bindings = kept.bindings;
        s.composites = kept.composites;
        delete s.screenPlacement[gone.UniqueId];
        delete s.programs[gone.UniqueId];
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
});
