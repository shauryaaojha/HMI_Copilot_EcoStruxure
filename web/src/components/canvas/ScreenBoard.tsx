"use client";

/**
 * Every screen in the project, laid out on one board.
 *
 * Tabs were the wrong model for an HMI application. An operator interface is a
 * *set* of displays that have to agree with each other - the same header, the
 * same navigation strip, the alarm banner at the same height - and tabs show
 * you exactly one at a time, which is the one arrangement that makes those
 * agreements impossible to check. A plant with nine screens was nine clicks to
 * see, and no way to see them together at all.
 *
 * So they sit side by side, in a grid, on a board you pan and zoom. Figma's
 * model, for the same reason Figma uses it: the work is a set of frames, not a
 * document with pages.
 *
 * Editing still happens in place. The screen you last clicked is live - drag an
 * object on it, select it, resize it - and the others are drawn but inert, so
 * clicking one is unambiguous: it makes that screen the live one. There is no
 * mode to enter or leave.
 */

import { useMemo, useRef } from "react";
import type { Screen } from "@/lib/ote/schema";
import type { ObjectMeta } from "@/store/types";
import { cn } from "@/components/ui";
import { ScreenRenderer, type Box, type DrawTool } from "./ScreenRenderer";
import type { AlarmRow } from "./parts";

/**
 * Board units between screens.
 *
 * 72 looked generous next to one 1024-wide screen and vanished entirely once
 * there were twenty-one of them: at the zoom that fits a whole plant, 72 units
 * is about eight pixels and the frames read as one continuous wall. This is
 * proportional to a panel instead, so the gap between two frames stays visibly
 * a gap at any zoom that shows the board.
 */
export const BOARD_GAP = 180;
/** Room above each screen for its name, at the same proportional scale. */
export const BOARD_LABEL = 56;

/**
 * How many across.
 *
 * Not sqrt: a plant's screens are wider than they are tall, so a square grid of
 * them is a very wide board that never fits. Capping at four keeps the whole
 * set inside a landscape viewport at a readable zoom, which is the only reason
 * the board exists.
 */
export function columnsFor(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  return 4;
}

export interface BoardMetrics {
  columns: number;
  rows: number;
  cell: { width: number; height: number };
  width: number;
  height: number;
}

export function boardMetrics(
  count: number,
  screen: { width: number; height: number },
): BoardMetrics {
  const columns = columnsFor(count);
  const rows = Math.max(1, Math.ceil(count / columns));
  const cell = {
    width: screen.width + BOARD_GAP,
    height: screen.height + BOARD_GAP + BOARD_LABEL,
  };
  return {
    columns,
    rows,
    cell,
    width: columns * cell.width - BOARD_GAP,
    height: rows * cell.height - BOARD_GAP,
  };
}

/** Where a screen's frame sits: where it was dragged, else its grid slot. */
export function placementOf(
  index: number,
  metrics: BoardMetrics,
  placed?: { x: number; y: number },
): { x: number; y: number } {
  if (placed) return placed;
  return {
    x: (index % metrics.columns) * metrics.cell.width,
    y: Math.floor(index / metrics.columns) * metrics.cell.height,
  };
}

/**
 * The board's extent once hand placements are taken into account.
 *
 * A dragged screen can sit anywhere, including left of or above the grid, so
 * the scrolling area has to be measured rather than derived from the row and
 * column count. The origin shifts with it, so nothing lands at a negative
 * offset that the scroll container could not reach.
 */
export function boardExtent(
  screen: { width: number; height: number },
  ids: string[],
  placements: Record<string, { x: number; y: number }>,
) {
  const metrics = boardMetrics(ids.length, screen);
  const spots = ids.map((id, i) => placementOf(i, metrics, placements[id]));

  const minX = Math.min(0, ...spots.map((p) => p.x));
  const minY = Math.min(0, ...spots.map((p) => p.y));
  const maxX = Math.max(screen.width, ...spots.map((p) => p.x + screen.width));
  const maxY = Math.max(
    screen.height,
    ...spots.map((p) => p.y + screen.height + BOARD_LABEL),
  );

  return {
    metrics,
    originX: minX,
    originY: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export interface ScreenBoardProps {
  screens: Screen[];
  activeScreenId?: string;
  scale: number;
  /** Hand placements, keyed by screen id. An absent id uses the grid. */
  placements?: Record<string, { x: number; y: number }>;
  /** A frame was dragged somewhere new. */
  onPlace?: (screenId: string, at: { x: number; y: number }) => void;

  selectedIds: string[];
  hoveredId?: string;
  objectMeta?: Record<string, ObjectMeta>;
  values?: Record<string, number | boolean>;
  alarms?: AlarmRow[];

  showGrid?: boolean;
  gridSize?: number;
  snap?: boolean;
  smartGuides?: boolean;
  /** False while panning, so a drag across the board does not move an object. */
  interactive?: boolean;
  tool?: DrawTool;

  onFocus: (screenId: string) => void;
  onSelect?: (ids: string[], add?: boolean) => void;
  onHover?: (id?: string) => void;
  onMove?: (ids: string[], dx: number, dy: number) => void;
  onResize?: (id: string, box: Box) => void;
  onDraw?: (type: NonNullable<DrawTool>, box: Box) => void;
  onContextMenu?: (at: { x: number; y: number }, objectId?: string) => void;
}

export function ScreenBoard({
  screens,
  activeScreenId,
  scale,
  placements,
  onPlace,
  selectedIds,
  hoveredId,
  objectMeta,
  values,
  alarms,
  showGrid,
  gridSize,
  snap,
  smartGuides,
  interactive = true,
  tool,
  onFocus,
  onSelect,
  onHover,
  onMove,
  onResize,
  onDraw,
  onContextMenu,
}: ScreenBoardProps) {
  const first = screens[0]?.Children[0];
  const size = { width: first?.Width ?? 1024, height: first?.Height ?? 600 };

  const spots = useMemo(() => placements ?? {}, [placements]);
  const extent = useMemo(
    () =>
      boardExtent(
        size,
        screens.map((s) => s.UniqueId),
        spots,
      ),
    [screens, size.width, size.height, spots],
  );

  /** The frame being dragged, and where the grab started. */
  const drag = useRef<{
    id: string;
    clientX: number;
    clientY: number;
    fromX: number;
    fromY: number;
    moved: boolean;
  } | null>(null);

  return (
    <div
      className="relative shrink-0"
      style={{ width: extent.width * scale, height: extent.height * scale }}
    >
      {screens.map((screen, index) => {
        const view = screen.Children[0];
        const at = placementOf(index, extent.metrics, spots[screen.UniqueId]);
        const live = screen.UniqueId === activeScreenId;
        const objects = view.Children.length;

        return (
          <div
            key={screen.UniqueId}
            className="absolute"
            style={{
              left: (at.x - extent.originX) * scale,
              top: (at.y - extent.originY) * scale,
              width: view.Width * scale,
              height: (view.Height + BOARD_LABEL) * scale,
            }}
          >
            {/* The frame's name, above it, the way a Figma frame carries one.
                Clicking it makes the screen live; dragging it moves the whole
                frame. The name rather than the frame body, because the body is
                where objects are selected and dragged - one gesture cannot mean
                both "move this object" and "move the screen it is on". */}
            <button
              type="button"
              onClick={() => {
                if (!drag.current?.moved) onFocus(screen.UniqueId);
              }}
              onPointerDown={(event) => {
                if (event.button !== 0 || !onPlace) return;
                event.preventDefault();
                (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
                onFocus(screen.UniqueId);
                drag.current = {
                  id: screen.UniqueId,
                  clientX: event.clientX,
                  clientY: event.clientY,
                  fromX: at.x,
                  fromY: at.y,
                  moved: false,
                };
              }}
              onPointerMove={(event) => {
                const grab = drag.current;
                if (!grab || grab.id !== screen.UniqueId) return;
                const dx = event.clientX - grab.clientX;
                const dy = event.clientY - grab.clientY;
                if (!grab.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
                grab.moved = true;
                onPlace?.(screen.UniqueId, {
                  x: grab.fromX + dx / scale,
                  y: grab.fromY + dy / scale,
                });
              }}
              onPointerUp={() => {
                drag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
              title={screen.Name + " - drag to move this screen on the board"}
              className={cn(
                "focus-ring flex w-full cursor-grab items-baseline gap-2 truncate px-0.5 text-left transition active:cursor-grabbing",
                live ? "text-brand-400" : "text-text-muted hover:text-text-secondary",
              )}
              style={{ height: BOARD_LABEL * scale, fontSize: Math.max(10, 13 * scale) }}
            >
              <span className="truncate font-medium">{screen.Name}</span>
              <span className="text-figure shrink-0 opacity-60">{objects}</span>
            </button>

            <div
              onPointerDownCapture={() => {
                // Any press inside a screen that is not live makes it live, and
                // the press falls through so the same gesture also selects.
                if (!live) onFocus(screen.UniqueId);
              }}
              className={cn(
                "canvas-screen relative overflow-hidden ring-1 transition",
                live ? "ring-brand-500/70" : "ring-line hover:ring-line-strong",
              )}
              style={{ width: view.Width * scale, height: view.Height * scale }}
            >
              <ScreenRenderer
                screen={screen}
                selectedIds={live ? selectedIds : []}
                hoveredId={live ? hoveredId : undefined}
                objectMeta={objectMeta}
                values={values}
                alarms={alarms}
                scale={scale}
                showGrid={live && showGrid}
                gridSize={gridSize}
                snap={snap}
                smartGuides={smartGuides}
                // Only the live screen takes edits. Everything else is drawn
                // from the same JSON but inert, so a drag cannot land on the
                // screen next to the one being worked on.
                interactive={live && interactive}
                tool={live ? tool : null}
                onSelect={onSelect}
                onHover={onHover}
                onMove={onMove}
                onResize={onResize}
                onDraw={onDraw}
                onContextMenu={onContextMenu}
              />

              {/* A dimming veil over the screens that are not live, so the one
                  being edited is obvious at a glance across a big board. */}
              {!live && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-surface-base/25"
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
