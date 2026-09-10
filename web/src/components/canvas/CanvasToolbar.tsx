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
 * The whole row scrolls sideways rather than wrapping: a toolbar that reflows
 * into two rows moves every button the moment the inspector opens.
 */

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
    <div className="flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line-subtle px-2">
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

      <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">
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
