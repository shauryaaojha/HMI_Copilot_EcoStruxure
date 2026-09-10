"use client";

/**
 * The centre pane: view tabs, the design toolbar, and the screen itself.
 * Reference screens 1, 2, 5, 6. Phase 2 of docs/BUILD_PLAN.md.
 *
 * This owns the viewport - zoom, pan and fit - and ScreenRenderer owns the
 * screen's own coordinate space. The split matters: the renderer converts
 * pointer positions through its own bounding box, so it stays correct at any
 * zoom without either side knowing the other's transform.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Grid3x3,
  Hand,
  Maximize2,
  Minus,
  MousePointer2,
  Play,
  Plus,
  Square,
} from "lucide-react";
import { useProject } from "@/store/project";
import { demoLiveValues, demoScreen } from "@/fixtures";
import { activeAlarms } from "@/lib/sim/alarms";
import { Badge, Button, Tabs, cn, type TabItem } from "@/components/ui";
import { ScreenRenderer } from "./ScreenRenderer";

type CanvasTab = "design" | "bindings" | "script" | "preview" | "json";

const TABS: TabItem<CanvasTab>[] = [
  { id: "design", label: "Design" },
  { id: "bindings", label: "Binding Map" },
  { id: "script", label: "Script" },
  { id: "preview", label: "Preview (SVG)" },
  { id: "json", label: "JSON" },
];

const ZOOMS = [25, 50, 75, 100, 125, 150, 200, 300, 400];
const FIT_PADDING = 48;
const GRID_SIZE = 8;

export function CanvasPane() {
  const [tab, setTab] = useState<CanvasTab>("design");
  const [zoom, setZoom] = useState(100);
  const [showGrid, setShowGrid] = useState(false);
  const [snap, setSnap] = useState(true);
  const [panMode, setPanMode] = useState(false);

  const viewport = useRef<HTMLDivElement>(null);
  const panning = useRef<{ x: number; y: number; left: number; top: number } | null>(
    null,
  );

  const screens = useProject((s) => s.screens);
  const activeScreenId = useProject((s) => s.activeScreenId);
  const selectedIds = useProject((s) => s.selectedIds);
  const hoveredId = useProject((s) => s.hoveredId);
  const alarms = useProject((s) => s.alarms);
  const bindings = useProject((s) => s.bindings);
  const select = useProject((s) => s.select);
  const hover = useProject((s) => s.hover);
  const nudge = useProject((s) => s.nudge);
  const setBox = useProject((s) => s.setBox);
  const removeObjects = useProject((s) => s.removeObjects);
  const values = useProject((s) => s.values);
  const simulating = useProject((s) => s.simulating);
  const setSimulating = useProject((s) => s.setSimulating);

  // Until the generation pipeline lands, fall back to the fixture lifted out of
  // demo_project/HMICopilot_PumpStation.eote, so the canvas can be built and
  // judged against a real project on a machine with no EcoStruxure install.
  const screen =
    screens.find((s) => s.UniqueId === activeScreenId) ?? screens[0] ?? demoScreen;
  const view = screen.Children[0];

  const live = simulating ? { ...demoLiveValues, ...values } : undefined;
  // Design state shows an empty grid, exactly as render_screen.py draws it;
  // Live evaluates each alarm against the tag it is bound to.
  const rows = simulating ? activeAlarms(alarms, bindings, live ?? {}) : [];

  const fit = useCallback(() => {
    const box = viewport.current?.getBoundingClientRect();
    if (!box) return;
    const scale = Math.min(
      (box.width - FIT_PADDING) / view.Width,
      (box.height - FIT_PADDING) / view.Height,
    );
    setZoom(Math.max(10, Math.min(400, Math.round(scale * 100))));
  }, [view.Width, view.Height]);

  // Fit once when a screen first appears, so the demo opens on a whole screen
  // rather than on the top-left corner of one.
  const fitted = useRef<string>("");
  useLayoutEffect(() => {
    if (fitted.current === screen.UniqueId) return;
    fitted.current = screen.UniqueId;
    fit();
  }, [screen.UniqueId, fit]);

  const step = (direction: 1 | -1) =>
    setZoom((current) => {
      const options = ZOOMS.filter((z) => (direction === 1 ? z > current : z < current));
      return direction === 1 ? (options[0] ?? current) : (options.at(-1) ?? current);
    });

  /** Ctrl/Cmd + wheel zooms, as every design tool does; plain wheel scrolls. */
  function onWheel(event: React.WheelEvent) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setZoom((z) => Math.round(Math.max(10, Math.min(400, z * (1 - event.deltaY / 500)))));
  }

  function onPointerDown(event: React.PointerEvent) {
    // Middle button pans regardless of mode, which is the muscle memory.
    if (!panMode && event.button !== 1) return;
    const el = viewport.current;
    if (!el) return;
    event.preventDefault();
    panning.current = {
      x: event.clientX,
      y: event.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
    };
    el.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent) {
    const start = panning.current;
    const el = viewport.current;
    if (!start || !el) return;
    el.scrollLeft = start.left - (event.clientX - start.x);
    el.scrollTop = start.top - (event.clientY - start.y);
  }

  const endPan = () => {
    panning.current = null;
  };

  // Arrow keys nudge, shift-arrow nudges by the grid, Delete removes, Escape
  // deselects. The object under the keyboard is the same one under the pointer.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable]")) return;
      if (selectedIds.length === 0) return;

      const stride = event.shiftKey ? GRID_SIZE : 1;
      const deltas: Record<string, [number, number]> = {
        ArrowLeft: [-stride, 0],
        ArrowRight: [stride, 0],
        ArrowUp: [0, -stride],
        ArrowDown: [0, stride],
      };

      if (deltas[event.key]) {
        event.preventDefault();
        nudge(selectedIds, ...deltas[event.key]);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeObjects(selectedIds);
      } else if (event.key === "Escape") {
        select([]);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedIds, nudge, removeObjects, select]);

  const scale = zoom / 100;

  return (
    <section className="flex h-full w-full min-w-0 flex-col">
      <div className="flex h-12 shrink-0 items-end gap-2 border-b border-line-subtle px-2">
        <Tabs items={TABS} value={tab} onChange={setTab} aria-label="Canvas view" />
      </div>

      {tab === "design" && (
        <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line-subtle px-2">
          <Button
            variant={panMode ? "ghost" : "secondary"}
            size="sm"
            iconOnly
            onClick={() => setPanMode(false)}
            aria-pressed={!panMode}
            title="Select (V)"
            aria-label="Select"
            icon={<MousePointer2 size={15} />}
          />
          <Button
            variant={panMode ? "secondary" : "ghost"}
            size="sm"
            iconOnly
            onClick={() => setPanMode(true)}
            aria-pressed={panMode}
            title="Pan — or hold the middle mouse button"
            aria-label="Pan"
            icon={<Hand size={15} />}
          />

          <span aria-hidden className="mx-1 h-5 w-px bg-line" />

          <Button
            variant={showGrid ? "secondary" : "ghost"}
            size="sm"
            iconOnly
            onClick={() => setShowGrid((g) => !g)}
            aria-pressed={showGrid}
            title={`${showGrid ? "Hide" : "Show"} the ${GRID_SIZE}px grid`}
            aria-label="Toggle grid"
            icon={<Grid3x3 size={15} />}
          />
          <Button
            variant={snap ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setSnap((s) => !s)}
            aria-pressed={snap}
            title={`Snap to the ${GRID_SIZE}px grid`}
            icon={<Square size={13} />}
          >
            Snap
          </Button>

          <span aria-hidden className="mx-1 h-5 w-px bg-line" />

          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={() => step(-1)}
            aria-label="Zoom out"
            icon={<Minus size={15} />}
          />
          <span className="w-12 text-center text-xs tabular-nums text-text-secondary">
            {zoom}%
          </span>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={() => step(1)}
            aria-label="Zoom in"
            icon={<Plus size={15} />}
          />
          <Button variant="ghost" size="sm" onClick={fit} title="Fit the screen to the pane">
            Fit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={() => setZoom(100)}
            title="Actual size"
            aria-label="Actual size"
            icon={<Maximize2 size={14} />}
          />

          <div className="ml-auto flex items-center gap-2">
            {selectedIds.length > 0 && (
              <Badge tone="brand">
                {selectedIds.length === 1
                  ? "1 object selected"
                  : `${selectedIds.length} objects selected`}
              </Badge>
            )}
            <Badge tone={simulating ? "ok" : "neutral"} dot={simulating}>
              {simulating ? "Live" : "Design"}
            </Badge>
            <Button
              variant={simulating ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={simulating}
              onClick={() => setSimulating(!simulating)}
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
      )}

      <div
        ref={viewport}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        className={cn(
          "canvas-grid min-h-0 flex-1 overflow-auto p-6",
          panMode && "cursor-grab active:cursor-grabbing",
        )}
      >
        {tab !== "design" ? (
          <p className="flex h-full items-center justify-center text-center text-sm text-text-muted">
            {TABS.find((t) => t.id === tab)?.label} arrives with a later phase — see
            docs/BUILD_PLAN.md.
          </p>
        ) : (
          <div className="flex min-h-full min-w-full items-center justify-center">
            <div
              className="canvas-screen shrink-0"
              style={{ width: view.Width * scale, height: view.Height * scale }}
            >
              <ScreenRenderer
                screen={screen}
                selectedIds={selectedIds}
                hoveredId={hoveredId}
                values={live}
                alarms={rows}
                scale={scale}
                showGrid={showGrid}
                gridSize={GRID_SIZE}
                snap={snap}
                interactive={!panMode}
                onSelect={select}
                onHover={hover}
                onMove={nudge}
                onResize={setBox}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
