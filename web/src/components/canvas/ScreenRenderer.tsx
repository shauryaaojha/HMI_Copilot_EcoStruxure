"use client";

/**
 * Screen.dat -> inline SVG. One DOM node per object, each carrying its UniqueId.
 *
 * This is the same object tree the packager writes into the .eote, rendered a
 * second way. Everything the canvas can draw, the packager can emit - the
 * exhaustive switch in parts/index.tsx is what enforces that, and if you are
 * tempted to add a visual with no OTE part behind it, read the one rule in
 * docs/BUILD_PLAN.md first.
 *
 * Absolute Location + Width/Height inside a ViewBox maps 1:1 onto SVG, which is
 * why click-to-select, hover-to-inspect and drag-to-move resolve straight back
 * to a JSON node with no hit-testing of our own.
 *
 * The editing affordances layered on top - marquee, eight handles, smart
 * guides, draw-to-place - are all drawn in the same coordinate space and none
 * of them has a UniqueId, so none of them can reach the export.
 *
 * The target for this file is assets/screen_design.png, which
 * tools/render_screen.py produced from the same JSON. Any divergence between
 * the two is a bug in one of them, because "one model, two renderers" is only
 * a claim for as long as they agree.
 *
 * Phase 2 of docs/BUILD_PLAN.md.
 */

import { useCallback, useRef, useState } from "react";
import type { Part, PartType, Screen } from "@/lib/ote/schema";
import { resolveColor } from "@/lib/ote/palette";
import type { ObjectMeta } from "@/store/types";
import { snapDelta, snapTargets, unionOf, type Box } from "@/store/edits";
import { PartNode, type AlarmRow } from "./parts";

/** Palette index 2 is the paper the product draws a screen on; 22 its frame. */
const PAPER = resolveColor(2, "#f1f1f1");
const FRAME = resolveColor(22, "#515151");

/** How close an edge has to come, in screen units at 100%, before it snaps. */
const GUIDE_TOLERANCE = 6;

/** The eight resize handles, as unit positions within the object's box. */
const HANDLES = [
  { id: "nw", x: 0, y: 0, cursor: "nwse-resize" },
  { id: "n", x: 0.5, y: 0, cursor: "ns-resize" },
  { id: "ne", x: 1, y: 0, cursor: "nesw-resize" },
  { id: "e", x: 1, y: 0.5, cursor: "ew-resize" },
  { id: "se", x: 1, y: 1, cursor: "nwse-resize" },
  { id: "s", x: 0.5, y: 1, cursor: "ns-resize" },
  { id: "sw", x: 0, y: 1, cursor: "nesw-resize" },
  { id: "w", x: 0, y: 0.5, cursor: "ew-resize" },
] as const;

type HandleId = (typeof HANDLES)[number]["id"];

export type { Box };

/** What the toolbar can arm. Every one of these is a part the packager emits. */
export type DrawTool = PartType | null;

export interface ScreenRendererProps {
  screen: Screen;
  selectedIds: string[];
  hoveredId?: string;
  /** Lock and hide, which live beside the parts rather than inside them. */
  objectMeta?: Record<string, ObjectMeta>;
  /** Live tag values, keyed by object name. Absent = design state. */
  values?: Record<string, number | boolean>;
  /** Rows for the AlarmSummary part, which cannot be drawn from its own JSON. */
  alarms?: AlarmRow[];

  /** Screen units per CSS pixel, so handles stay one size at every zoom. */
  scale?: number;
  showGrid?: boolean;
  /** Grid pitch in screen units; also the snap increment when snapping is on. */
  gridSize?: number;
  snap?: boolean;
  /** Snap to other objects' edges and centres, and show the line that caught. */
  smartGuides?: boolean;
  /** Read-only mode drops every interaction, for thumbnails and the report. */
  interactive?: boolean;
  /** Armed drawing tool: a drag on the background places one of these. */
  tool?: DrawTool;

  onSelect?: (ids: string[], add?: boolean) => void;
  onHover?: (id?: string) => void;
  onMove?: (ids: string[], dx: number, dy: number) => void;
  onResize?: (id: string, box: Box) => void;
  /** A completed draw gesture. The caller builds the part and names it. */
  onDraw?: (type: PartType, box: Box) => void;
  onContextMenu?: (at: { x: number; y: number }, objectId?: string) => void;
}

function boxOf(part: Part): Box {
  return {
    left: part.Location.Left,
    top: part.Location.Top,
    width: part.Width,
    height: part.Height,
  };
}

/** Which objects a marquee rectangle touches. Intersection, not containment. */
function hits(parts: Part[], marquee: Box): string[] {
  const right = marquee.left + marquee.width;
  const bottom = marquee.top + marquee.height;
  return parts
    .filter((p) => {
      const b = boxOf(p);
      return (
        b.left < right &&
        b.left + b.width > marquee.left &&
        b.top < bottom &&
        b.top + b.height > marquee.top
      );
    })
    .map((p) => p.UniqueId);
}

/** Applies a handle drag to a box, keeping the opposite edge pinned. */
function resizeBox(start: Box, handle: HandleId, dx: number, dy: number): Box {
  let { left, top, width, height } = start;

  if (handle.includes("w")) {
    left = start.left + dx;
    width = start.width - dx;
  }
  if (handle.includes("e")) width = start.width + dx;
  if (handle.includes("n")) {
    top = start.top + dy;
    height = start.height - dy;
  }
  if (handle.includes("s")) height = start.height + dy;

  // A dragged-through edge flips rather than inverting the box.
  if (width < 0) {
    left += width;
    width = -width;
  }
  if (height < 0) {
    top += height;
    height = -height;
  }
  return { left, top, width, height };
}

interface Guides {
  vertical: number[];
  horizontal: number[];
}

interface Drag {
  kind: "move" | "resize" | "marquee" | "draw";
  originX: number;
  originY: number;
  /** Screen-unit position now, updated as the pointer moves. */
  x: number;
  y: number;
  handle?: HandleId;
  /** The box the resize started from. */
  startBox?: Box;
  targetId?: string;
  /** The selection's bounding box when the move started, for guide matching. */
  startUnion?: Box;
  /** Edges of everything not being dragged. Computed once, at drag start. */
  guides?: Guides;
  /** Whole screen units already committed, so moves stay integral. */
  appliedX: number;
  appliedY: number;
  moved: boolean;
}

export function ScreenRenderer({
  screen,
  selectedIds,
  hoveredId,
  objectMeta,
  values,
  alarms = [],
  scale = 1,
  showGrid = false,
  gridSize = 8,
  snap = false,
  smartGuides = false,
  interactive = true,
  tool = null,
  onSelect,
  onHover,
  onMove,
  onResize,
  onDraw,
  onContextMenu,
}: ScreenRendererProps) {
  const view = screen.Children[0];
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** The guide lines that actually caught, so the engineer sees what snapped. */
  const [shown, setShown] = useState<{ v?: number; h?: number }>({});

  const selected = new Set(selectedIds);
  const meta = objectMeta ?? {};
  // Handles and outlines are drawn in screen units but should look the same at
  // every zoom, so everything cosmetic is divided by the scale.
  const px = (n: number) => n / scale;
  const tolerance = GUIDE_TOLERANCE / Math.max(scale, 0.25);

  /** Client coordinates -> screen units, via the SVG's own box. */
  const toScreen = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const rect = svg.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: ((event.clientX - rect.left) / rect.width) * view.Width,
        y: ((event.clientY - rect.top) / rect.height) * view.Height,
      };
    },
    [view.Width, view.Height],
  );

  const round = useCallback(
    (n: number) => (snap ? Math.round(n / gridSize) * gridSize : Math.round(n)),
    [snap, gridSize],
  );

  /** Drawn objects and hit-testable objects both skip anything hidden. */
  const visible = view.Children.filter((p) => !meta[p.UniqueId]?.hidden);

  function startDrag(
    event: React.PointerEvent,
    kind: Drag["kind"],
    extra: Partial<Drag> = {},
  ) {
    if (!interactive) return;
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    const at = toScreen(event);
    setDrag({
      kind,
      originX: at.x,
      originY: at.y,
      x: at.x,
      y: at.y,
      appliedX: 0,
      appliedY: 0,
      moved: false,
      ...extra,
    });
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!drag) return;
    const at = toScreen(event);
    const dx = at.x - drag.originX;
    const dy = at.y - drag.originY;
    const moved = drag.moved || Math.abs(dx) > 1 || Math.abs(dy) > 1;

    if (drag.kind === "move") {
      // Commit whole units as they accumulate so Location stays integral, the
      // way every Location in a real Screen.dat is.
      let wantX = round(dx);
      let wantY = round(dy);

      // Smart guides run after the grid, so an object that is near both lands
      // on the object - which is the one the engineer was aiming at.
      const caught: { v?: number; h?: number } = {};
      if (smartGuides && drag.startUnion && drag.guides) {
        const u = drag.startUnion;
        const v = snapDelta(
          [u.left + wantX, u.left + u.width / 2 + wantX, u.left + u.width + wantX],
          drag.guides.vertical,
          tolerance,
        );
        if (v) {
          wantX += v.delta;
          caught.v = v.line;
        }
        const h = snapDelta(
          [u.top + wantY, u.top + u.height / 2 + wantY, u.top + u.height + wantY],
          drag.guides.horizontal,
          tolerance,
        );
        if (h) {
          wantY += h.delta;
          caught.h = h.line;
        }
      }
      wantX = Math.round(wantX);
      wantY = Math.round(wantY);

      const stepX = wantX - drag.appliedX;
      const stepY = wantY - drag.appliedY;
      if (stepX !== 0 || stepY !== 0) onMove?.(selectedIds, stepX, stepY);
      setShown(caught);
      setDrag({ ...drag, x: at.x, y: at.y, appliedX: wantX, appliedY: wantY, moved });
      return;
    }

    if (drag.kind === "resize" && drag.startBox && drag.targetId && drag.handle) {
      const next = resizeBox(drag.startBox, drag.handle, dx, dy);
      onResize?.(drag.targetId, {
        left: round(next.left),
        top: round(next.top),
        width: Math.max(1, round(next.width)),
        height: Math.max(1, round(next.height)),
      });
    }

    setDrag({ ...drag, x: at.x, y: at.y, moved });
  }

  function endDrag(event: React.PointerEvent) {
    if (!drag) return;
    setShown({});

    if (drag.kind === "marquee") {
      const marquee = dragBox(drag);
      // A marquee that never moved is a click on the background: deselect.
      if (drag.moved) {
        onSelect?.(
          hits(
            visible.filter((p) => !meta[p.UniqueId]?.locked),
            marquee,
          ),
          event.shiftKey,
        );
      } else onSelect?.([]);
    }

    if (drag.kind === "draw" && tool) {
      const box = dragBox(drag);
      // A click with a tool armed places a sensible default rather than a
      // zero-sized object nobody can grab.
      const placed = drag.moved
        ? {
            left: round(box.left),
            top: round(box.top),
            width: Math.max(8, round(box.width)),
            height: Math.max(8, round(box.height)),
          }
        : { left: round(box.left), top: round(box.top), ...defaultSize(tool) };
      onDraw?.(tool, placed);
    }

    setDrag(null);
  }

  const marquee =
    (drag?.kind === "marquee" || drag?.kind === "draw") && drag.moved
      ? dragBox(drag)
      : null;

  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${view.Width} ${view.Height}`}
      width="100%"
      height="100%"
      role="img"
      aria-label={`HMI screen ${screen.Name}`}
      style={{
        background: PAPER,
        cursor: tool ? "crosshair" : drag?.kind === "marquee" ? "crosshair" : undefined,
        touchAction: "none",
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        startDrag(e, tool ? "draw" : "marquee");
      }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => onHover?.(undefined)}
      onContextMenu={(e) => {
        if (!interactive || !onContextMenu) return;
        e.preventDefault();
        const id = (e.target as Element)
          .closest("[data-object-id]")
          ?.getAttribute("data-object-id");
        if (id && !selected.has(id)) onSelect?.([id]);
        onContextMenu({ x: e.clientX, y: e.clientY }, id ?? undefined);
      }}
    >
      {visible.map((part) => {
        const isSelected = selected.has(part.UniqueId);
        const locked = meta[part.UniqueId]?.locked;
        return (
          <g
            key={part.UniqueId}
            data-object-id={part.UniqueId}
            data-object-name={part.Name}
            data-object-type={part.Type}
            style={{
              cursor: !interactive || locked ? "default" : isSelected ? "move" : "pointer",
            }}
            onPointerEnter={() => interactive && onHover?.(part.UniqueId)}
            onPointerDown={(e) => {
              if (e.button !== 0 || !interactive || locked) return;
              // A tool is armed: the background gesture wins, so an engineer
              // drawing a rectangle over an existing panel gets a rectangle.
              if (tool) return;
              // Clicking an unselected object selects it before the drag, so a
              // press-and-drag in one gesture moves what was pressed.
              const group = meta[part.UniqueId]?.groupId;
              const family = group
                ? visible
                    .filter((p) => meta[p.UniqueId]?.groupId === group)
                    .map((p) => p.UniqueId)
                : [part.UniqueId];

              if (!isSelected) onSelect?.(family, e.shiftKey);
              else if (e.shiftKey) onSelect?.(family, true);

              const moving = isSelected && !e.shiftKey ? selectedIds : family;
              startDrag(e, "move", {
                startUnion:
                  unionOf(visible.filter((p) => moving.includes(p.UniqueId))) ?? undefined,
                guides: smartGuides
                  ? snapTargets(visible, new Set(moving))
                  : undefined,
              });
            }}
          >
            <PartNode part={part} values={values} alarms={alarms} />
          </g>
        );
      })}

      {/* The design grid is ours, not the project's, so it is drawn above the
          objects but never exported - nothing here has a UniqueId. */}
      {showGrid && (
        <GridOverlay
          width={view.Width}
          height={view.Height}
          size={gridSize}
          strokeWidth={px(1)}
        />
      )}

      {hoveredId && !selected.has(hoveredId) && (
        <Outline
          part={visible.find((p) => p.UniqueId === hoveredId)}
          stroke="var(--color-status-info)"
          strokeWidth={px(1)}
          dashed
        />
      )}

      {visible
        .filter((p) => selected.has(p.UniqueId))
        .map((part) => (
          <Outline
            key={part.UniqueId}
            part={part}
            stroke="var(--color-brand-400)"
            strokeWidth={px(1.5)}
          />
        ))}

      {/* Handles only on a single selection: resizing eight objects at once is
          an editor feature nobody asked for and a source of silent damage. */}
      {interactive &&
        selectedIds.length === 1 &&
        !meta[selectedIds[0]]?.locked &&
        visible
          .filter((p) => p.UniqueId === selectedIds[0])
          .map((part) => {
            const box = boxOf(part);
            const size = px(7);
            return HANDLES.map((handle) => (
              <rect
                key={handle.id}
                className="selection-handle"
                x={box.left + box.width * handle.x - size / 2}
                y={box.top + box.height * handle.y - size / 2}
                width={size}
                height={size}
                strokeWidth={px(1)}
                style={{ cursor: handle.cursor }}
                onPointerDown={(e) =>
                  startDrag(e, "resize", {
                    handle: handle.id,
                    startBox: box,
                    targetId: part.UniqueId,
                  })
                }
              />
            ));
          })}

      {/* The line that caught, drawn only while it is catching. */}
      {shown.v !== undefined && (
        <line
          x1={shown.v}
          y1={0}
          x2={shown.v}
          y2={view.Height}
          stroke="var(--color-status-warn, #d97706)"
          strokeWidth={px(1)}
          pointerEvents="none"
        />
      )}
      {shown.h !== undefined && (
        <line
          x1={0}
          y1={shown.h}
          x2={view.Width}
          y2={shown.h}
          stroke="var(--color-status-warn, #d97706)"
          strokeWidth={px(1)}
          pointerEvents="none"
        />
      )}

      {marquee && (
        <rect
          x={marquee.left}
          y={marquee.top}
          width={marquee.width}
          height={marquee.height}
          fill="var(--color-brand-400)"
          fillOpacity={0.12}
          stroke="var(--color-brand-400)"
          strokeWidth={px(1)}
          strokeDasharray={drag?.kind === "draw" ? `${px(4)} ${px(3)}` : undefined}
          pointerEvents="none"
        />
      )}

      {/* render_screen.py frames the whole screen; without this the browser
          render is a pixel short of the picture in the deck. */}
      <rect
        x={0.5}
        y={0.5}
        width={view.Width - 1}
        height={view.Height - 1}
        fill="none"
        stroke={FRAME}
        strokeWidth={1}
        pointerEvents="none"
      />
    </svg>
  );
}

/** What a click with a tool armed places, when there is no drag to size it. */
function defaultSize(type: PartType): { width: number; height: number } {
  switch (type) {
    case "TextBox":
      return { width: 160, height: 28 };
    case "Lamp":
      return { width: 160, height: 64 };
    case "NumericDisplay":
      return { width: 160, height: 48 };
    case "AlarmSummary":
      return { width: 480, height: 200 };
    case "Path":
      return { width: 96, height: 96 };
    case "Rectangle":
    default:
      return { width: 200, height: 120 };
  }
}

function dragBox(drag: Drag): Box {
  return {
    left: Math.min(drag.originX, drag.x),
    top: Math.min(drag.originY, drag.y),
    width: Math.abs(drag.x - drag.originX),
    height: Math.abs(drag.y - drag.originY),
  };
}

function Outline({
  part,
  stroke,
  strokeWidth,
  dashed,
}: {
  part?: Part;
  stroke: string;
  strokeWidth: number;
  dashed?: boolean;
}) {
  if (!part) return null;
  return (
    <rect
      x={part.Location.Left - strokeWidth}
      y={part.Location.Top - strokeWidth}
      width={part.Width + strokeWidth * 2}
      height={part.Height + strokeWidth * 2}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeDasharray={dashed ? `${strokeWidth * 4} ${strokeWidth * 3}` : undefined}
      pointerEvents="none"
    />
  );
}

function GridOverlay({
  width,
  height,
  size,
  strokeWidth,
}: {
  width: number;
  height: number;
  size: number;
  strokeWidth: number;
}) {
  const lines = [];
  for (let x = size; x < width; x += size) {
    lines.push(
      <line key={`v${x}`} x1={x} y1={0} x2={x} y2={height} strokeWidth={strokeWidth} />,
    );
  }
  for (let y = size; y < height; y += size) {
    lines.push(
      <line key={`h${y}`} x1={0} y1={y} x2={width} y2={y} strokeWidth={strokeWidth} />,
    );
  }
  return (
    <g stroke="#000000" strokeOpacity={0.08} pointerEvents="none">
      {lines}
    </g>
  );
}
