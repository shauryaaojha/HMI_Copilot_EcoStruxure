"use client";

/**
 * The design toolbar: what to draw, how to line it up, and what to look at.
 *
 * Grouped the way the hand reaches for them - pointer and tools, then the
 * things that act on a selection (align, distribute, order, group, lock), then
 * the view controls. Everything acting on a selection disables itself when
 * there is nothing selected, so the bar reads as a statement about the current
 * state rather than as a wall of buttons.
 *
 * The editing half scrolls sideways rather than wrapping: a toolbar that
 * reflows into two rows moves every button the moment the inspector opens.
 *
 * The run-state half does not scroll, and that is the whole point of the split.
 * It used to sit inside the scrolling row behind an `ml-auto`, which on a
 * 1440px laptop put Simulate at x=1697 - past the right edge, reachable only by
 * dragging a scrollbar macOS does not draw until you are already scrolling.
 * Measured on the demo project, 719px of a 1498px toolbar had no way of being
 * reached. Whether the screen is live is the one thing the bar must always be
 * able to say, and say it in the same place, so it is pinned outside the
 * scroll and the tools give up the width instead.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  Bell,
  BringToFront,
  Eye,
  EyeOff,
  Grid3x3,
  Group,
  Hand,
  Hash,
  Lightbulb,
  Lock,
  Magnet,
  Maximize2,
  Minus,
  MousePointer2,
  Play,
  Plus,
  Redo2,
  Ruler,
  SendToBack,
  Square,
  Trash2,
  Type,
  Undo2,
  Ungroup,
  Unlock,
} from "lucide-react";
import type { ReactNode } from "react";
import type { PartType } from "@/lib/ote/schema";
import { useProject } from "@/store/project";
import { Badge, Button, cn } from "@/components/ui";

const TOOL_ICON: Record<string, typeof Square> = {
  Rectangle: Square,
  TextBox: Type,
  Lamp: Lightbulb,
  NumericDisplay: Hash,
  AlarmSummary: Bell,
};

const TOOLS: { type: PartType; label: string; key: string }[] = [
  { type: "Rectangle", label: "Rectangle", key: "R" },
  { type: "TextBox", label: "Text", key: "T" },
  { type: "Lamp", label: "Lamp", key: "L" },
  { type: "NumericDisplay", label: "Numeric display", key: "N" },
  { type: "AlarmSummary", label: "Alarm summary", key: "A" },
];

export interface CanvasToolbarProps {
  tool: PartType | null;
  onTool: (tool: PartType | null) => void;
  panMode: boolean;
  onPanMode: (on: boolean) => void;
  zoom: number;
  onZoom: (percent: number) => void;
  onZoomStep: (direction: 1 | -1) => void;
  onFit: () => void;
  simulating: boolean;
  onSimulate: (on: boolean) => void;
  activeAlarms: number;
  elapsed: number;
  /** Board shows every screen at once; screen shows only the live one. */
  view: "board" | "screen";
  onView: (view: "board" | "screen") => void;
  /** One screen is not a board, so the switch is hidden rather than useless. */
  canBoard: boolean;
  /** Design / Bindings / JSON, pinned beside the run state. */
  tabs?: ReactNode;
}

/** A divider between groups, so the bar reads as sections not as a list. */
const Sep = () => <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-line" />;

export function CanvasToolbar({
  tool,
  onTool,
  panMode,
  onPanMode,
  zoom,
  onZoom,
  onZoomStep,
  onFit,
  simulating,
  onSimulate,
  activeAlarms,
  elapsed,
  view,
  onView,
  canBoard,
  tabs,
}: CanvasToolbarProps) {
  const selectedIds = useProject((s) => s.selectedIds);
  const objectMeta = useProject((s) => s.objectMeta);
  const standards = useProject((s) => s.standards);
  const setStandards = useProject((s) => s.setStandards);
  const align = useProject((s) => s.align);
  const spread = useProject((s) => s.spread);
  const restackObjects = useProject((s) => s.restackObjects);
  const group = useProject((s) => s.group);
  const ungroup = useProject((s) => s.ungroup);
  const setMeta = useProject((s) => s.setMeta);
  const removeObjects = useProject((s) => s.removeObjects);
  const tidyBoard = useProject((s) => s.tidyBoard);
  const rearranged = useProject((s) => Object.keys(s.screenPlacement).length > 0);
  const undo = useProject((s) => s.undo);
  const redo = useProject((s) => s.redo);
  const canUndo = useProject((s) => s.past.length > 0);
  const canRedo = useProject((s) => s.future.length > 0);

  const some = selectedIds.length > 0;
  const many = selectedIds.length > 1;
  const spreadable = selectedIds.length > 2;
  const anyLocked = selectedIds.some((id) => objectMeta[id]?.locked);
  const anyHidden = selectedIds.some((id) => objectMeta[id]?.hidden);
  const anyGrouped = selectedIds.some((id) => objectMeta[id]?.groupId);

  /**
   * Which edges of the tool half have more behind them.
   *
   * Twenty-eight buttons do not fit 610px, so the half scrolls - and macOS
   * draws no scrollbar until you are already scrolling, which is how the whole
   * right end of this bar came to be invisible. A fade on whichever side has
   * more says so without taking any width to say it.
   */
  const scroller = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: false, end: false });

  const measureEdges = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollWidth - el.scrollLeft - el.clientWidth > 1;
    // Returning the previous object when nothing changed keeps a scroll that
    // crosses no threshold from committing a render - the same identity rule
    // that useSimulation documents.
    setEdge((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  useEffect(() => {
    measureEdges();
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(measureEdges);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measureEdges]);

  const icon = (
    label: string,
    Icon: typeof Square,
    onClick: () => void,
    opts: { disabled?: boolean; pressed?: boolean; danger?: boolean } = {},
  ) => (
    <Button
      key={label}
      variant={opts.pressed ? "secondary" : "ghost"}
      size="sm"
      iconOnly
      disabled={opts.disabled}
      aria-pressed={opts.pressed}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(opts.danger && "hover:text-status-alarm")}
      icon={<Icon size={14} />}
    />
  );

  return (
    <div className="flex h-11 shrink-0 items-center border-b border-line-subtle bg-surface-panel">
      {/* Everything that acts on the drawing. `min-w-0` is what lets this
          shrink below its content width so the pinned half keeps its room. */}
      <div className="relative flex min-w-0 flex-1">
        <div
          ref={scroller}
          onScroll={measureEdges}
          onWheel={(e) => {
            // A wheel mouse only sends deltaY, and this scrolls sideways. Without
            // this the tools are reachable by trackpad and by nothing else.
            if (e.deltaY === 0 || e.deltaX !== 0) return;
            e.currentTarget.scrollLeft += e.deltaY;
          }}
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-2 [scrollbar-width:thin]"
        >
          {/* --- pointer and tools ------------------------------------------ */}
          {icon("Select (V)", MousePointer2, () => {
            onTool(null);
            onPanMode(false);
          }, { pressed: !panMode && !tool })}
          {icon("Pan (H) — or hold the middle mouse button", Hand, () => {
            onTool(null);
            onPanMode(true);
          }, { pressed: panMode })}

          <Sep />

          {TOOLS.map((t) =>
            icon(`${t.label} (${t.key})`, TOOL_ICON[t.type] ?? Square, () => {
              onPanMode(false);
              onTool(tool === t.type ? null : t.type);
            }, { pressed: tool === t.type }),
          )}

          <Sep />

          {/* --- history ---------------------------------------------------- */}
          {icon("Undo (Ctrl+Z)", Undo2, undo, { disabled: !canUndo })}
          {icon("Redo (Ctrl+Shift+Z)", Redo2, redo, { disabled: !canRedo })}

          <Sep />

          {/* --- act on the selection --------------------------------------- */}
          {icon("Align left", AlignStartVertical, () => align(selectedIds, "left"), {
            disabled: !some,
          })}
          {icon("Align centres", AlignCenterVertical, () => align(selectedIds, "centre"), {
            disabled: !some,
          })}
          {icon("Align right", AlignEndVertical, () => align(selectedIds, "right"), {
            disabled: !some,
          })}
          {icon("Align top", AlignStartHorizontal, () => align(selectedIds, "top"), {
            disabled: !some,
          })}
          {icon("Align middles", AlignCenterHorizontal, () => align(selectedIds, "middle"), {
            disabled: !some,
          })}
          {icon("Align bottom", AlignEndHorizontal, () => align(selectedIds, "bottom"), {
            disabled: !some,
          })}
          {icon(
            "Even horizontal gaps",
            AlignHorizontalSpaceAround,
            () => spread(selectedIds, "horizontal"),
            { disabled: !spreadable },
          )}
          {icon(
            "Even vertical gaps",
            AlignVerticalSpaceAround,
            () => spread(selectedIds, "vertical"),
            { disabled: !spreadable },
          )}

          <Sep />

          {icon("Bring to front (])", BringToFront, () => restackObjects(selectedIds, "front"), {
            disabled: !some,
          })}
          {icon("Send to back ([)", SendToBack, () => restackObjects(selectedIds, "back"), {
            disabled: !some,
          })}
          {icon("Group (Ctrl+G)", Group, () => group(selectedIds), { disabled: !many })}
          {icon("Ungroup (Ctrl+Shift+G)", Ungroup, () => ungroup(selectedIds), {
            disabled: !anyGrouped,
          })}
          {icon(
            anyLocked ? "Unlock" : "Lock",
            anyLocked ? Unlock : Lock,
            () => setMeta(selectedIds, { locked: !anyLocked }),
            { disabled: !some, pressed: anyLocked },
          )}
          {icon(
            anyHidden ? "Show" : "Hide",
            anyHidden ? EyeOff : Eye,
            () => setMeta(selectedIds, { hidden: !anyHidden }),
            { disabled: !some, pressed: anyHidden },
          )}
          {icon("Delete (Del)", Trash2, () => removeObjects(selectedIds), {
            disabled: !some,
            danger: true,
          })}

          <Sep />

          {/* --- the view --------------------------------------------------- */}
          {icon(
            `${standards.showGrid ? "Hide" : "Show"} the ${standards.gridSize}px grid`,
            Grid3x3,
            () => setStandards({ showGrid: !standards.showGrid }),
            { pressed: standards.showGrid },
          )}
          {icon(
            `Snap to the ${standards.gridSize}px grid`,
            Magnet,
            () => setStandards({ snap: !standards.snap }),
            { pressed: standards.snap },
          )}
          {icon(
            "Snap to other objects, and show the guide",
            AlignCenterVertical,
            () => setStandards({ smartGuides: !standards.smartGuides }),
            { pressed: standards.smartGuides },
          )}
          {icon("Rulers", Ruler, () => setStandards({ showRulers: !standards.showRulers }), {
            pressed: standards.showRulers,
          })}

          <Sep />

          {icon("Zoom out", Minus, () => onZoomStep(-1))}
          <span className="w-11 shrink-0 text-center text-xs tabular-nums text-text-secondary">
            {zoom}%
          </span>
          {icon("Zoom in", Plus, () => onZoomStep(1))}
          <Button variant="ghost" size="sm" onClick={onFit} title="Fit the screen to the pane">
            Fit
          </Button>
          {icon("Actual size", Maximize2, () => onZoom(100))}
        </div>

        {edge.start && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-surface-panel to-transparent"
          />
        )}
        {edge.end && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-surface-panel to-transparent"
          />
        )}
      </div>

      {/* Pinned: outside the scroll, so it is in the same place at any width. */}
      <div className="flex shrink-0 items-center gap-2 border-l border-line-subtle px-2">
        {/* Board or one screen. Pinned outside the scrolling half, because
            losing the way back to the whole project behind a scrollbar is the
            fault this bar was already fixed for once. */}
        {canBoard && rearranged && view === "board" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={tidyBoard}
            title="Put every screen back in the automatic grid"
          >
            Tidy
          </Button>
        )}

        {canBoard && (
          <div className="flex items-center rounded-md border border-line-subtle p-0.5">
            {(["board", "screen"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onView(mode)}
                aria-pressed={view === mode}
                title={
                  mode === "board"
                    ? "Every screen, side by side"
                    : "Only the screen being edited"
                }
                className={cn(
                  "focus-ring rounded px-2 py-0.5 text-[11px] font-medium capitalize transition",
                  view === mode
                    ? "bg-surface-active text-text-primary"
                    : "text-text-muted hover:text-text-secondary",
                )}
              >
                {mode}
              </button>
            ))}
          </div>
        )}

        {some && (
          <Badge tone="brand">
            {selectedIds.length === 1
              ? "1 selected"
              : `${selectedIds.length} selected`}
          </Badge>
        )}
        <Badge tone={simulating ? "ok" : "neutral"} dot={simulating}>
          {simulating ? `Live · ${elapsed.toFixed(0)}s` : "Design"}
        </Badge>
        {simulating && activeAlarms > 0 && (
          <Badge tone="alarm" dot>
            {activeAlarms} active
          </Badge>
        )}
        {tabs}

        <Button
          variant={simulating ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={simulating}
          onClick={() => onSimulate(!simulating)}
          icon={simulating ? <Square size={13} /> : <Play size={14} />}
          title={
            simulating
              ? "Return the screen to its design state"
              : "Drive the screen from tag values"
          }
        >
          {simulating ? "Stop" : "Simulate"}
        </Button>
      </div>
    </div>
  );
}
