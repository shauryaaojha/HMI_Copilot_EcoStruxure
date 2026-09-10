"use client";

/**
 * The centre pane: screen tabs, view tabs, the design toolbar, and the screen.
 * Reference screens 1, 2, 5, 6. Phase 2 of docs/BUILD_PLAN.md.
 *
 * This owns the viewport - zoom, pan, fit, the armed tool and the context menu
 * - and ScreenRenderer owns the screen's own coordinate space. The split
 * matters: the renderer converts pointer positions through its own bounding
 * box, so it stays correct at any zoom without either side knowing the other's
 * transform.
 *
 * Everything that edits goes through the store, never through local state, so
 * the toolbar, the keyboard, the context menu, the layers panel and the chat
 * are all editing the same project by the same route.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useProject } from "@/store/project";
import { activeAlarms } from "@/lib/sim/alarms";
import type { PartType, Screen } from "@/lib/ote/schema";
import { useSimulation } from "./useSimulation";
import { Tabs, cn, type TabItem } from "@/components/ui";
import { BindingMap } from "@/components/bindings/BindingMap";
import { ScreenRenderer, type Box } from "./ScreenRenderer";
import { ScreenBoard, boardMetrics } from "./ScreenBoard";
import { ScreenStrip } from "./ScreenStrip";
import { RunOverlay } from "@/components/timeline/RunOverlay";
import { CanvasToolbar } from "./CanvasToolbar";
import { CanvasContextMenu, type ContextTarget } from "./CanvasContextMenu";
import { Rulers, RULER } from "./Rulers";
import { ScreenJson } from "./ScreenJson";
import { partFromTool } from "./newPart";
import { useCanvasShortcuts } from "./useCanvasShortcuts";

type CanvasTab = "design" | "bindings" | "json";

const TABS: TabItem<CanvasTab>[] = [
  { id: "design", label: "Design" },
  { id: "bindings", label: "Bindings" },
  { id: "json", label: "JSON" },
];

/**
 * Board shows every screen at once; screen shows only the live one.
 *
 * The board is the default whenever there is more than one, because an HMI
 * application is a set of displays that have to agree with each other and tabs
 * are the one arrangement that hides the disagreements.
 */
type CanvasView = "board" | "screen";

const ZOOMS = [25, 50, 75, 100, 125, 150, 200, 300, 400];
const FIT_PADDING = 48;

export function CanvasPane() {
  const [tab, setTab] = useState<CanvasTab>("design");
  const [view, setView] = useState<CanvasView>("board");
  const [zoom, setZoom] = useState(100);
  const [panMode, setPanMode] = useState(false);
  const [tool, setTool] = useState<PartType | null>(null);
  const [menu, setMenu] = useState<ContextTarget | null>(null);

  const viewport = useRef<HTMLDivElement>(null);
  const panning = useRef<{ x: number; y: number; left: number; top: number } | null>(
    null,
  );

  const screens = useProject((s) => s.screens);
  const activeScreenId = useProject((s) => s.activeScreenId);
  const selectedIds = useProject((s) => s.selectedIds);
  const hoveredId = useProject((s) => s.hoveredId);
  const objectMeta = useProject((s) => s.objectMeta);
  const alarms = useProject((s) => s.alarms);
  const bindings = useProject((s) => s.bindings);
  const select = useProject((s) => s.select);
  const hover = useProject((s) => s.hover);
  const nudge = useProject((s) => s.nudge);
  const setBox = useProject((s) => s.setBox);
  const appendObject = useProject((s) => s.appendObject);
  const setActiveScreen = useProject((s) => s.setActiveScreen);
  const target = useProject((s) => s.target);
  const simulating = useProject((s) => s.simulating);
  // The grid and the snap increment are company standards, not canvas state -
  // reference screen 5 sets them and every screen in the project follows.
  const standards = useProject((s) => s.standards);
  const setSimulating = useProject((s) => s.setSimulating);

  /**
   * An empty screen of the project's own size, for the moment between a route
   * change and hydration.
   *
   * This used to fall back to the demo fixture, which meant a brand-new project
   * showed somebody else's pump station for a frame on its way to being blank -
   * and showed it permanently if hydration had not run. A blank project has to
   * look blank.
   */
  const placeholder: Screen = useMemo(
    () => ({
      Type: "Screen",
      UniqueId: "empty",
      Name: "Screen1",
      Children: [
        {
          Type: "ViewBox",
          UniqueId: "empty-view",
          Name: "ViewBox",
          Options: 108,
          Width: target.width,
          Height: target.height,
          Children: [],
        },
      ],
    }),
    [target.width, target.height],
  );

  const screen =
    screens.find((s) => s.UniqueId === activeScreenId) ?? screens[0] ?? placeholder;
  const viewBox = screen.Children[0];
  // One screen is not a board. Below that the board's frame and label are pure
  // overhead, so a single-screen project just shows the screen.
  const showBoard = view === "board" && screens.length > 1;

  // The engine drives tags; the bindings project them onto screen objects.
  const sim = useSimulation();
  const live = simulating ? sim.objects : undefined;
  // Design state shows an empty grid, exactly as render_screen.py draws it;
  // Live evaluates each alarm against the tag it is actually bound to.
  const rows = simulating ? activeAlarms(alarms, bindings, sim.tags) : [];

  const board = useMemo(
    () => boardMetrics(screens.length, { width: viewBox.Width, height: viewBox.Height }),
    [screens.length, viewBox.Width, viewBox.Height],
  );

  const fit = useCallback(() => {
    const box = viewport.current?.getBoundingClientRect();
    if (!box) return;
    // Whatever is on screen: one panel, or the whole board of them.
    const wide = showBoard ? board.width : viewBox.Width;
    const tall = showBoard ? board.height : viewBox.Height;
    const scale = Math.min(
      (box.width - FIT_PADDING) / wide,
      (box.height - FIT_PADDING) / tall,
    );
    setZoom(Math.max(5, Math.min(400, Math.round(scale * 100))));
  }, [showBoard, board.width, board.height, viewBox.Width, viewBox.Height]);

  // Fit once when a screen first appears, so the demo opens on a whole screen
  // rather than on the top-left corner of one.
  const fitted = useRef<string>("");
  useLayoutEffect(() => {
    // Refit when the mode changes or a screen is added, not only when the live
    // screen changes: switching to a board of nine at 100% shows one corner.
    const key = `${showBoard ? "board" : "screen"}:${showBoard ? screens.length : screen.UniqueId}`;
    if (fitted.current === key) return;
    fitted.current = key;
    fit();
  }, [showBoard, screens.length, screen.UniqueId, fit]);

  const zoomStep = useCallback((direction: 1 | -1) => {
    setZoom((current) => {
      const options = ZOOMS.filter((z) => (direction === 1 ? z > current : z < current));
      return direction === 1 ? (options[0] ?? current) : (options.at(-1) ?? current);
    });
  }, []);

  useCanvasShortcuts({
    onTool: setTool,
    onPanMode: setPanMode,
    onZoomStep: zoomStep,
    onZoom: setZoom,
    onFit: fit,
    enabled: tab === "design",
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

  /** A completed draw gesture becomes a real part on the active screen. */
  const onDraw = useCallback(
    (type: PartType, box: Box) => {
      appendObject(screen.UniqueId, partFromTool(type, box));
      // One shape per arming, the way every design tool behaves: the tool
      // disarms so the next drag selects rather than drawing a second panel.
      setTool(null);
    },
    [appendObject, screen.UniqueId],
  );

  // A screen change while a tool is armed would place the next shape somewhere
  // the engineer was not looking.
  useEffect(() => setTool(null), [activeScreenId]);

  const scale = zoom / 100;
  const rulers = standards.showRulers && tab === "design";

  return (
    <section className="flex h-full w-full min-w-0 flex-col">
      {/* The toolbar acts on objects. It sits at the top, on its own raised
          surface, because it is the thing the hand goes to most. */}
      {tab === "design" && (
        <CanvasToolbar
          tool={tool}
          onTool={setTool}
          panMode={panMode}
          onPanMode={setPanMode}
          zoom={zoom}
          onZoom={setZoom}
          onZoomStep={zoomStep}
          onFit={fit}
          simulating={simulating}
          onSimulate={setSimulating}
          activeAlarms={rows.length}
          elapsed={sim.elapsed}
          view={view}
          onView={setView}
          canBoard={screens.length > 1}
          tabs={
            <Tabs
              items={TABS}
              value={tab}
              onChange={setTab}
              variant="pill"
              aria-label="Canvas view"
            />
          }
        />
      )}

      {tab !== "design" && (
        <div className="flex h-11 shrink-0 items-center border-b border-line-subtle bg-surface-panel px-2">
          <Tabs
            items={TABS}
            value={tab}
            onChange={setTab}
            variant="pill"
            aria-label="Canvas view"
          />
        </div>
      )}

      {/* The screens strip acts on screens. Quieter, and visibly a different
          kind of control than the toolbar above it. */}
      {tab === "design" && <ScreenStrip />}

      <div
        ref={viewport}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        className={cn(
          "relative min-h-0 flex-1",
          tab === "design"
            ? cn(
                "canvas-grid overflow-auto p-8",
                panMode && "cursor-grab active:cursor-grabbing",
              )
            : "overflow-hidden",
        )}
      >
        {tab === "bindings" ? (
          <BindingMap />
        ) : tab === "json" ? (
          <ScreenJson screen={screen} />
        ) : showBoard ? (
          <div className="flex min-h-full min-w-full items-start justify-center">
            <ScreenBoard
              screens={screens}
              activeScreenId={screen.UniqueId}
              scale={scale}
              selectedIds={selectedIds}
              hoveredId={hoveredId}
              objectMeta={objectMeta}
              values={live}
              alarms={rows}
              showGrid={standards.showGrid}
              gridSize={standards.gridSize}
              snap={standards.snap}
              smartGuides={standards.smartGuides}
              interactive={!panMode}
              tool={tool}
              onFocus={setActiveScreen}
              onSelect={select}
              onHover={hover}
              onMove={nudge}
              onResize={setBox}
              onDraw={onDraw}
              onContextMenu={(at, objectId) => setMenu({ ...at, objectId })}
            />
          </div>
        ) : (
          <div className="flex min-h-full min-w-full items-center justify-center">
            <div
              className="relative shrink-0"
              style={{ marginLeft: rulers ? RULER : 0, marginTop: rulers ? RULER : 0 }}
            >
              {rulers && (
                <Rulers width={viewBox.Width} height={viewBox.Height} scale={scale} />
              )}
              <div
                className="canvas-screen"
                style={{ width: viewBox.Width * scale, height: viewBox.Height * scale }}
              >
                <ScreenRenderer
                  screen={screen}
                  selectedIds={selectedIds}
                  hoveredId={hoveredId}
                  objectMeta={objectMeta}
                  values={live}
                  alarms={rows}
                  scale={scale}
                  showGrid={standards.showGrid}
                  gridSize={standards.gridSize}
                  snap={standards.snap}
                  smartGuides={standards.smartGuides}
                  interactive={!panMode}
                  tool={tool}
                  onSelect={select}
                  onHover={hover}
                  onMove={nudge}
                  onResize={setBox}
                  onDraw={onDraw}
                  onContextMenu={(at, objectId) => setMenu({ ...at, objectId })}
                />
              </div>
            </div>
          </div>
        )}

        {/* The build timeline, over the work rather than under it. It shows
            itself when a run starts and settles to one line when it ends. */}
        {tab === "design" && (
          <div className="pointer-events-none sticky bottom-0 left-0 flex justify-start pt-4">
            <RunOverlay />
          </div>
        )}
      </div>

      {menu && <CanvasContextMenu at={menu} onClose={() => setMenu(null)} />}
    </section>
  );
}
