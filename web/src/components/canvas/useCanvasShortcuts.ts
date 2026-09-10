"use client";

/**
 * The keyboard, in one place.
 *
 * Every shortcut here is the muscle memory an engineer brings from another
 * design tool, mapped onto the same store actions the toolbar calls. Typing in
 * a field is always exempt - an editor that deletes the selection because you
 * pressed Backspace in the intent box is an editor nobody trusts twice.
 */

import { useEffect } from "react";
import type { PartType } from "@/lib/ote/schema";
import { useProject } from "@/store/project";

const TOOL_KEYS: Record<string, PartType> = {
  r: "Rectangle",
  t: "TextBox",
  l: "Lamp",
  n: "NumericDisplay",
  a: "AlarmSummary",
};

export interface CanvasShortcutHandlers {
  onTool: (tool: PartType | null) => void;
  onPanMode: (on: boolean) => void;
  onZoomStep: (direction: 1 | -1) => void;
  onZoom: (percent: number) => void;
  onFit: () => void;
  /** False while another pane owns the keyboard, e.g. the bindings tab. */
  enabled?: boolean;
}

export function useCanvasShortcuts({
  onTool,
  onPanMode,
  onZoomStep,
  onZoom,
  onFit,
  enabled = true,
}: CanvasShortcutHandlers) {
  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;

      const s = useProject.getState();
      const ids = s.selectedIds;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key;
      const take = () => event.preventDefault();

      if (mod) {
        switch (key.toLowerCase()) {
          case "z":
            take();
            if (event.shiftKey) s.redo();
            else s.undo();
            return;
          case "y":
            take();
            s.redo();
            return;
          case "c":
            take();
            s.copyObjects(ids);
            return;
          case "x":
            take();
            s.cutObjects(ids);
            return;
          case "v":
            take();
            s.pasteObjects();
            return;
          case "d":
            take();
            s.duplicateObjects(ids);
            return;
          case "a":
            take();
            s.selectAll();
            return;
          case "g":
            take();
            if (event.shiftKey) s.ungroup(ids);
            else s.group(ids);
            return;
          case "0":
            take();
            onZoom(100);
            return;
          case "1":
            take();
            onFit();
            return;
          case "=":
          case "+":
            take();
            onZoomStep(1);
            return;
          case "-":
            take();
            onZoomStep(-1);
            return;
          default:
            return;
        }
      }

      // Arrow keys nudge; shift-arrow nudges by the grid.
      const stride = event.shiftKey ? s.standards.gridSize : 1;
      const deltas: Record<string, [number, number]> = {
        ArrowLeft: [-stride, 0],
        ArrowRight: [stride, 0],
        ArrowUp: [0, -stride],
        ArrowDown: [0, stride],
      };
      if (deltas[key] && ids.length > 0) {
        take();
        s.nudge(ids, ...deltas[key]);
        return;
      }

      if (key === "Delete" || key === "Backspace") {
        if (ids.length === 0) return;
        take();
        s.removeObjects(ids);
        return;
      }

      if (key === "Escape") {
        onTool(null);
        s.select([]);
        return;
      }

      if (key === "]") {
        if (ids.length === 0) return;
        take();
        s.restackObjects(ids, "front");
        return;
      }
      if (key === "[") {
        if (ids.length === 0) return;
        take();
        s.restackObjects(ids, "back");
        return;
      }

      const lower = key.toLowerCase();
      if (lower === "v") {
        onTool(null);
        onPanMode(false);
        return;
      }
      if (lower === "h") {
        onTool(null);
        onPanMode(true);
        return;
      }
      if (TOOL_KEYS[lower]) {
        onPanMode(false);
        onTool(TOOL_KEYS[lower]);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, onTool, onPanMode, onZoomStep, onZoom, onFit]);
}
