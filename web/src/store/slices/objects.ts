/**
 * The objects on a screen: placing, editing, moving, grouping, the clipboard.
 *
 * Every action here is undoable and every one respects the lock, which is why
 * they go through `remember` and `editable` rather than writing to the draft
 * directly.
 */


import { current } from "immer";
import { rootBox } from "@/lib/ote/schema";
import {
  alignTo,
  clonePartsInto,
  distribute,
  restack,
  uniqueName,
} from "../edits";
import { isEmptyMeta } from "../types";
import { withoutObjects } from "@/lib/refs";


import type { ProjectState, SliceOf } from "../state";
import {
  activeScreen,
  detachedPartsByIds,
  editable,
  ensureHandles,
  partsByIds,
  remember,
  screenHolding,
  takenNames,
  touch,
  viewOf,
} from "../internals";

export type ObjectsSlice = Pick<
  ProjectState,
  | "appendObject"
  | "updateObject"
  | "setProperty"
  | "nudge"
  | "setBox"
  | "removeObjects"
  | "duplicateObjects"
  | "copyObjects"
  | "cutObjects"
  | "pasteObjects"
  | "align"
  | "spread"
  | "restackObjects"
  | "setMeta"
  | "group"
  | "ungroup"
  | "appendToView"
>;

export const createObjectsSlice: SliceOf<ObjectsSlice> = (set, get) => ({
    appendObject: (screenId, part) =>
      set((s) => {
        const screen = s.screens.find((x) => x.UniqueId === screenId);
        if (!screen) return;
        remember(s, `Add ${part.Type}`);
        part.Name = uniqueName(takenNames(s), part.Name);
        viewOf(screen).Children.push(part);
        s.objectMeta[part.UniqueId] = { ...s.objectMeta[part.UniqueId], origin: "manual" };
        s.handles[part.UniqueId] ??= `o${++s.handleSeq}`;
      }),

    updateObject: (id, patch) =>
      set((s) => {
        const screen = screenHolding(s, id);
        if (!screen || s.objectMeta[id]?.locked) return;
        remember(s, "Edit object");
        touch(s, [id]);
        const parts = viewOf(screen).Children;
        Object.assign(parts[parts.findIndex((p) => p.UniqueId === id)], patch);
      }),

    setProperty: (id, path, value) =>
      set((s) => {
        if (path.length === 0) return;
        const screen = screenHolding(s, id);
        if (!screen || s.objectMeta[id]?.locked) return;
        remember(s, `Set ${path.join(".")}`);
        touch(s, [id]);
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
        touch(s, [...wanted]);
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
        touch(s, [id]);
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
        const kept = withoutObjects(current(s.bindings), current(s.composites), wanted);
        s.bindings = kept.bindings;
        s.composites = kept.composites;
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
        for (const p of copies) s.objectMeta[p.UniqueId] = { origin: "manual" };
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
        for (const p of copies) s.objectMeta[p.UniqueId] = { origin: "manual" };
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
        touch(s, wanted);
        const moves = alignTo(detachedPartsByIds(s, wanted), mode, rootBox(viewOf(screen), s.target));
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
        touch(s, wanted);
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
          // An empty record is noise in the save file. Provenance is not
          // empty: dropping it would make a generated object look unknown.
          if (isEmptyMeta(meta)) delete s.objectMeta[id];
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
          if (isEmptyMeta(meta)) delete s.objectMeta[id];
        }
      }),

    /* --- history ------------------------------------------------------ */

    appendToView: (viewBoxId, part) =>
      set((s) => {
        for (const screen of s.screens) {
          if (viewOf(screen).UniqueId !== viewBoxId) continue;
          viewOf(screen).Children.push(part);
          s.handles[part.UniqueId] ??= `o${++s.handleSeq}`;
          return;
        }
      }),
});
