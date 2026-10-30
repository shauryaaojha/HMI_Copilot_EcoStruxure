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
import { rootBox, type Part, type Screen } from "@/lib/ote/schema";
import { COMPOSITES, isCompositeKind } from "@/lib/composites";
import type { ToolType } from "./newPart";
import { resolveColor } from "@/lib/ote/palette";
import type { ForeignPart, ObjectMeta, ScreenPreview } from "@/store/types";
import { snapDelta, snapTargets, unionOf, type Box } from "@/store/edits";
import { ContentScreens, contentsById, PartNode, PictureSource, type AlarmRow } from "./parts";
import type { Look } from "@/lib/ote/co-look";
import { LookNode } from "./parts/ContentDisplay";
import { useProject } from "@/store/project";
import type { Presence } from "@/lib/collab/types";
import { PresenceOverlay } from "@/components/collab/PresenceOverlay";

/** Palette index 2 is the paper the product draws a screen on; 22 its frame. */
/** When no panel is given: the most common ST6 size in the corpus. */
const FALLBACK_PANEL = { width: 1024, height: 600 };

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
export type DrawTool = ToolType | null;

/**
 * A comment's pin, as the canvas draws it. Only what the drawing needs: the
 * thread itself stays with the comments list, so the renderer never learns
 * what a comment says or who wrote it.
 */
export interface CommentPin {
  id: string;
  /** The number on the pin, which is the thread's place in the screen's list. */
  n: number;
  /** Screen units, the same space as every Location on the screen. */
  x: number;
  y: number;
  resolved: boolean;
}

export interface ScreenRendererProps {
  screen: Screen;
  /**
   * The panel the screen is drawn for. A ViewBox root carries its own size and
   * ignores this; a Canvas root usually carries none and fills the panel.
   */
  panel?: { width: number; height: number };
  selectedIds: string[];
  hoveredId?: string;
  /** Lock and hide, which live beside the parts rather than inside them. */
  objectMeta?: Record<string, ObjectMeta>;
  /** Live tag values, keyed by object name. Absent = design state. */
  values?: Record<string, number | boolean | string>;
  /** Rows for the AlarmSummary part, which cannot be drawn from its own JSON. */
  alarms?: AlarmRow[];
  /**
   * A pending proposal for this screen, drawn as ghosts: added objects
   * translucent with a dashed brand outline, removed ones hatched, moved ones
   * outlined at their new place with a line from where they are. None of it
   * is interactive and none of it has a UniqueId the export could see.
   */
  preview?: ScreenPreview;
  /** Objects the reader carried rather than modelled; drawn as placeholders. */
  foreign?: ForeignPart[];
  /**
   * The screens a ContentDisplay can show. Defaults to the open project's, so
   * only a renderer drawing something else (a template preview, the critic)
   * needs to pass them.
   */
  contents?: Screen[];
  /** Carried objects of every screen, for the content screens a display shows. Defaults to the open project's. */
  contentForeign?: Record<string, ForeignPart[]>;

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
  /**
   * The person looking may not change the project. Unlike `interactive`, this
   * keeps the canvas live - hover, click-to-select, marquee and the context
   * menu all still work - and drops only what edits: drag-move, the resize
   * handles and draw-to-place. Driven by useCanEdit() in CanvasPane.
   */
  readOnly?: boolean;
  /**
   * Comment pins, drawn above everything the project owns. Like the carried
   * placeholders and the proposal ghosts, they sit outside the object groups
   * and carry no data-object-id, so no hit test, selection or export can
   * mistake one for an object.
   */
  comments?: CommentPin[];
  /**
   * Other people in a shared project (Phase C): their selections outlined
   * with their name, and their pointers, drawn like the ghosts - above the
   * objects, outside the object groups, never hit-testable.
   */
  presence?: Presence[];
  /** Where this person's pointer is, in screen units, for their own heartbeat. */
  onCursor?: (at: { x: number; y: number }) => void;
  /** A pin was clicked. */
  onPin?: (id: string) => void;
  /**
   * Comments mode. While this is set, a click places a comment instead of
   * selecting or dragging: the point in screen units, and the object under the
   * pointer when there is one.
   */
  onPlaceComment?: (at: { x: number; y: number }, objectId?: string) => void;
  /** Armed drawing tool: a drag on the background places one of these. */
  tool?: DrawTool;

  onSelect?: (ids: string[], add?: boolean) => void;
  onHover?: (id?: string) => void;
  onMove?: (ids: string[], dx: number, dy: number) => void;
  onResize?: (id: string, box: Box) => void;
  /** A completed draw gesture. The caller builds the part and names it. */
  onDraw?: (type: ToolType, box: Box) => void;
  onContextMenu?: (at: { x: number; y: number }, objectId?: string) => void;
}

function boxOf(part: Part): Box {
  return {
    left: part.Location.Left,
    top: part.Location.Top,
    width: (part.Width ?? 0),
    height: (part.Height ?? 0),
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
  panel,
  selectedIds,
  hoveredId,
  objectMeta,
  values,
  alarms = [],
  preview,
  foreign,
  contents,
  contentForeign,
  scale = 1,
  showGrid = false,
  gridSize = 8,
  snap = false,
  smartGuides = false,
  interactive = true,
  readOnly = false,
  comments,
  presence,
  onCursor,
  onPin,
  onPlaceComment,
  tool = null,
  onSelect,
  onHover,
  onMove,
  onResize,
  onDraw,
  onContextMenu,
}: ScreenRendererProps) {
  const view = screen.Children[0];
  const box = rootBox(view, panel ?? FALLBACK_PANEL);
  const svg = useRef<SVGSVGElement>(null);
  const projectScreens = useProject((s) => s.screens);
  const contentScreens = contentsById(contents ?? projectScreens);
  const projectForeign = useProject((s) => s.foreign);
  const carried = contentForeign ?? (contents ? undefined : projectForeign);
  // Pictures that came in with an opened file are served from that file.
  const source = useProject((s) => s.source);
  const pictureUrl = useCallback((sha: string) => `/api/picture/${sha}${source ? `?source=${encodeURIComponent(source)}` : ""}`, [source]);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** The guide lines that actually caught, so the engineer sees what snapped. */
  const [shown, setShown] = useState<{ v?: number; h?: number }>({});

  const selected = new Set(selectedIds);
  const meta = objectMeta ?? {};
  // Handles and outlines are drawn in screen units but should look the same at
  // every zoom, so everything cosmetic is divided by the scale.
  const px = (n: number) => n / scale;
  const tolerance = GUIDE_TOLERANCE / Math.max(scale, 0.25);
  // A read-only canvas never arms a tool, whatever the caller passed.
  const armed = readOnly ? null : tool;
  const placing = interactive && !!onPlaceComment;

  /** Client coordinates -> screen units, via the SVG's own box. */
  const toScreen = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const rect = svg.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: ((event.clientX - rect.left) / rect.width) * box.width,
        y: ((event.clientY - rect.top) / rect.height) * box.height,
      };
    },
    [box.width, box.height],
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

    if (drag.kind === "draw" && armed) {
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
        : { left: round(box.left), top: round(box.top), ...defaultSize(armed) };
      onDraw?.(armed, placed);
    }

    setDrag(null);
  }

  const marquee =
    (drag?.kind === "marquee" || drag?.kind === "draw") && drag.moved
      ? dragBox(drag)
      : null;

  return (
    <ContentScreens.Provider value={{ byId: contentScreens, depth: 0, carried }}>
    <PictureSource.Provider value={pictureUrl}>
    <svg
      ref={svg}
      viewBox={`0 0 ${box.width} ${box.height}`}
      width="100%"
      height="100%"
      role="img"
      aria-label={`HMI screen ${screen.Name}`}
      style={{
        background: PAPER,
        cursor: placing ? "cell" : armed ? "crosshair" : drag?.kind === "marquee" ? "crosshair" : undefined,
        touchAction: "none",
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (placing) {
          // Comments mode: the press is a place to talk about, not a gesture.
          // The object under it, if any, is found the way the context menu
          // finds one - by its group's data-object-id.
          e.stopPropagation();
          const id = (e.target as Element)
            .closest("[data-object-id]")
            ?.getAttribute("data-object-id");
          onPlaceComment?.(toScreen(e), id ?? undefined);
          return;
        }
        startDrag(e, armed ? "draw" : "marquee");
      }}
      onPointerMove={(e) => {
        onCursor?.(toScreen(e));
        onPointerMove(e);
      }}
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
      {/* Carried objects, under everything the editor owns. The product will
          paint them at their original index; the canvas cannot know what they
          look like, so it shows where they are and what they are. */}
      {foreign && foreign.length > 0 && (
        <g pointerEvents="none" data-foreign>
          <defs>
            <pattern id="foreign-hatch" width={px(8)} height={px(8)} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1={0} y1={0} x2={0} y2={px(8)} stroke="var(--color-text-faint)" strokeWidth={px(1)} />
            </pattern>
          </defs>
          {foreign.map((f, i) => {
            const look = (f as ForeignPart & { look?: Look }).look;
            return f.box && look ? (
              <LookNode key={i} box={f.box} look={look} alarms={alarms} />
            ) : f.box ? (
              <g key={i}>
                <rect x={f.box.left} y={f.box.top} width={f.box.width} height={f.box.height} fill="url(#foreign-hatch)" fillOpacity={0.35} />
                <rect x={f.box.left} y={f.box.top} width={f.box.width} height={f.box.height} fill="none" stroke="var(--color-text-faint)" strokeWidth={px(1)} strokeDasharray={`${px(3)} ${px(3)}`} />
                <text
                  x={f.box.left + px(4)}
                  y={f.box.top + px(4)}
                  fill="var(--color-text-muted)"
                  fontSize={px(10)}
                  fontFamily="var(--font-mono)"
                  dominantBaseline="hanging"
                >
                  {f.type}
                  {f.name ? ` ${f.name}` : ""}
                </text>
              </g>
            ) : null;
          })}
        </g>
      )}

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
              cursor: placing
                ? "cell"
                : !interactive || locked
                  ? "default"
                  : isSelected && !readOnly
                    ? "move"
                    : "pointer",
            }}
            onPointerEnter={() => interactive && onHover?.(part.UniqueId)}
            onPointerDown={(e) => {
              if (e.button !== 0 || !interactive || locked) return;
              // Comments mode: let the press reach the screen, which places the
              // comment with this object's id.
              if (placing) return;
              // A tool is armed: the background gesture wins, so an engineer
              // drawing a rectangle over an existing panel gets a rectangle.
              if (armed) return;
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

              // Selecting is reading; moving is editing. A read-only canvas
              // stops here, and the press does not fall through to a marquee.
              if (readOnly) {
                e.stopPropagation();
                return;
              }

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

      {/* A pending proposal, as ghosts. Drawn above the objects and below the
          grid; nothing here can be selected, dragged or exported. */}
      {preview && (
        <g pointerEvents="none" data-preview>
          {preview.removed.map((id) => {
            const part = visible.find((p) => p.UniqueId === id);
            if (!part) return null;
            const b = boxOf(part);
            return (
              <g key={`rm-${id}`}>
                <rect x={b.left} y={b.top} width={b.width} height={b.height} fill="var(--color-status-warn)" fillOpacity={0.18} />
                <line x1={b.left} y1={b.top} x2={b.left + b.width} y2={b.top + b.height} stroke="var(--color-status-warn)" strokeWidth={px(1)} />
                <line x1={b.left + b.width} y1={b.top} x2={b.left} y2={b.top + b.height} stroke="var(--color-status-warn)" strokeWidth={px(1)} />
                <rect x={b.left} y={b.top} width={b.width} height={b.height} fill="none" stroke="var(--color-status-warn)" strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} />
              </g>
            );
          })}
          {preview.moved.map(({ id, from, to }) => (
            <g key={`mv-${id}`}>
              <line
                x1={from.left + from.width / 2}
                y1={from.top + from.height / 2}
                x2={to.left + to.width / 2}
                y2={to.top + to.height / 2}
                stroke="var(--color-brand-400)"
                strokeWidth={px(1)}
                strokeDasharray={`${px(3)} ${px(3)}`}
              />
              <rect x={to.left} y={to.top} width={to.width} height={to.height} fill="var(--color-brand-400)" fillOpacity={0.1} stroke="var(--color-brand-400)" strokeWidth={px(1.5)} strokeDasharray={`${px(4)} ${px(3)}`} />
            </g>
          ))}
          {preview.added.map((part) => {
            const b = boxOf(part);
            return (
              <g key={`add-${part.UniqueId}`} opacity={0.55}>
                <PartNode part={part} values={values} alarms={alarms} />
                <rect x={b.left} y={b.top} width={b.width} height={b.height} fill="none" stroke="var(--color-brand-400)" strokeWidth={px(1.5)} strokeDasharray={`${px(4)} ${px(3)}`} />
              </g>
            );
          })}
        </g>
      )}

      {/* The design grid is ours, not the project's, so it is drawn above the
          objects but never exported - nothing here has a UniqueId. */}
      {presence && presence.length > 0 && (
        <PresenceOverlay users={presence} screenId={screen.UniqueId} parts={visible} scale={scale} />
      )}

      {showGrid && (
        <GridOverlay
          width={box.width}
          height={box.height}
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
        !readOnly &&
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
          y2={box.height}
          stroke="var(--color-status-warn, #d97706)"
          strokeWidth={px(1)}
          pointerEvents="none"
        />
      )}
      {shown.h !== undefined && (
        <line
          x1={0}
          y1={shown.h}
          x2={box.width}
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

      {/* Comment pins, above everything the project owns. The layer itself
          takes no pointer events and only each pin's shape does, so objects
          under a pin are still reachable around it, and nothing here has a
          data-object-id for a hit test or the export to find. */}
      {comments && comments.length > 0 && (
        <g pointerEvents="none" data-comment-pins>
          {comments.map((pin) => (
            <CommentPinMark key={pin.id} pin={pin} radius={px(10)} stroke={px(1.5)} onPin={onPin} />
          ))}
        </g>
      )}

      {/* render_screen.py frames the whole screen; without this the browser
          render is a pixel short of the picture in the deck. */}
      <rect
        x={0.5}
        y={0.5}
        width={box.width - 1}
        height={box.height - 1}
        fill="none"
        stroke={FRAME}
        strokeWidth={1}
        pointerEvents="none"
      />
    </svg>
    </PictureSource.Provider>
    </ContentScreens.Provider>
  );
}

/** What a click with a tool armed places, when there is no drag to size it. */
function defaultSize(type: ToolType): { width: number; height: number } {
  if (isCompositeKind(type)) return COMPOSITES[type].size;
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
    case "Switch":
      return { width: 120, height: 48 };
    case "N-StateLamp":
      return { width: 160, height: 48 };
    case "StringDisplay":
      return { width: 200, height: 36 };
    case "ToggleSwitch":
      return { width: 140, height: 56 };
    case "BarScale":
      return { width: 40, height: 160 };
    case "Pipe":
      return { width: 160, height: 12 };
    case "DateTimeDisplay":
      return { width: 180, height: 32 };
    case "TrendGraph":
    case "BlockTrend":
      return { width: 420, height: 220 };
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

/**
 * One numbered comment pin: a circle with one square corner, the corner on the
 * point being talked about - the shape design tools use for the same thing.
 *
 * Only the shape takes the pointer, and it stops the press there, so clicking
 * a pin neither starts a marquee nor places a second comment on top of it.
 */
function CommentPinMark({
  pin,
  radius: r,
  stroke,
  onPin,
}: {
  pin: CommentPin;
  radius: number;
  stroke: number;
  onPin?: (id: string) => void;
}) {
  return (
    <g
      data-comment-pin={pin.id}
      transform={`translate(${pin.x} ${pin.y})`}
      opacity={pin.resolved ? 0.5 : 1}
    >
      <path
        d={`M 0 0 L 0 ${-r} A ${r} ${r} 0 1 1 ${r} 0 Z`}
        fill={pin.resolved ? "var(--color-surface-active)" : "var(--color-brand-500)"}
        stroke="#ffffff"
        strokeWidth={stroke}
        pointerEvents="visiblePainted"
        style={{ cursor: "pointer" }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onPin?.(pin.id);
        }}
      >
        <title>{`Comment ${pin.n}${pin.resolved ? " (resolved)" : ""}`}</title>
      </path>
      <text
        x={r}
        y={-r}
        fill={pin.resolved ? "var(--color-text-secondary)" : "#ffffff"}
        fontSize={r}
        fontWeight={600}
        textAnchor="middle"
        dominantBaseline="central"
        pointerEvents="none"
      >
        {pin.n}
      </text>
    </g>
  );
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
      width={(part.Width ?? 0) + strokeWidth * 2}
      height={(part.Height ?? 0) + strokeWidth * 2}
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
