"use client";

/**
 * The resizable three-pane workspace.
 *
 *   +------------------------------------------------------------------+
 *   |                            TopBar                                |
 *   +------+-----------------------------------------------------------+
 *   | Nav  | copilot | canvas | inspector                              |
 *   | Rail |                                                            |
 *   +------+-----------------------------------------------------------+
 *   |                           StatusBar                              |
 *   +------------------------------------------------------------------+
 *
 * All three side regions collapse to a rail you can click to bring them back,
 * because at 1280 wide three panes and a canvas do not fit and the canvas is
 * the one that matters. Below that width they collapse on their own: the
 * inspector first, then the intent pane. Reopening one by hand wins - the
 * automatic collapse only fires when the viewport crosses a breakpoint, not on
 * every resize tick, so it cannot fight the engineer.
 *
 * Layout is persisted per group, so an engineer who widened the inspector once
 * does not have to widen it again. Reference screens 1, 2, 3, 5 and 6.
 *
 * Phase 0 of docs/BUILD_PLAN.md.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  type LayoutStorage,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import { PanelLeft, PanelRight, PanelBottom } from "lucide-react";
import { NavRail } from "./NavRail";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";
import { cn } from "@/components/ui";

/** Each region collapses to a strip you can still see and click. */
const RAIL = "2.25rem";

/**
 * useDefaultLayout defaults to `localStorage`, which does not exist while the
 * route is server-rendered - and /project/[id] is dynamic, so it is rendered on
 * the server on every request. This shim reads nothing on the server and the
 * real thing in the browser, which also means the first paint is the default
 * layout and the saved one arrives on hydration.
 */
const layoutStorage: LayoutStorage = {
  getItem: (key) => (typeof window === "undefined" ? null : window.localStorage.getItem(key)),
  setItem: (key, value) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // private mode: the layout just does not persist
    }
  },
};

export interface WorkspaceShellProps {
  projectId: string;
  intent: ReactNode;
  canvas: ReactNode;
  inspector: ReactNode;
  onExport?: () => void;
}

/** A collapsed pane's strip: the label, turned on its side, and a way back. */
function CollapsedRail({
  label,
  side,
  onExpand,
}: {
  label: string;
  side: "left" | "right" | "bottom";
  onExpand: () => void;
}) {
  const vertical = side !== "bottom";
  return (
    <button
      type="button"
      onClick={onExpand}
      title={`Show ${label}`}
      aria-label={`Show ${label}`}
      className={cn(
        "focus-ring group flex h-full w-full items-center gap-2 bg-surface-panel text-text-muted transition hover:bg-surface-hover hover:text-text-secondary",
        vertical ? "flex-col justify-start py-3" : "justify-start px-4",
      )}
    >
      {side === "left" && <PanelLeft size={15} aria-hidden />}
      {side === "right" && <PanelRight size={15} aria-hidden />}
      {side === "bottom" && <PanelBottom size={15} aria-hidden />}
      <span
        className={cn(
          "whitespace-nowrap text-xs font-medium",
          vertical && "[writing-mode:vertical-rl]",
          side === "left" && "rotate-180",
        )}
      >
        {label}
      </span>
    </button>
  );
}

/** A collapse control for an open pane, sized to sit in a pane header. */
function CollapseButton({
  label,
  side,
  onCollapse,
}: {
  label: string;
  side: "left" | "right" | "bottom";
  onCollapse: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onCollapse}
      title={`Hide ${label}`}
      aria-label={`Hide ${label}`}
      className="focus-ring absolute right-1 top-1 z-10 rounded p-1.5 text-text-muted transition hover:bg-surface-hover hover:text-text-secondary"
    >
      {side === "left" && <PanelLeft size={14} aria-hidden />}
      {side === "right" && <PanelRight size={14} aria-hidden />}
      {side === "bottom" && <PanelBottom size={14} aria-hidden />}
    </button>
  );
}

export function WorkspaceShell({
  projectId,
  intent,
  canvas,
  inspector,
  onExport,
}: WorkspaceShellProps) {
  const rows = useDefaultLayout({
    id: "workspace-rows",
    panelIds: ["content"],
    storage: layoutStorage,
  });
  const columns = useDefaultLayout({
    id: "workspace-columns",
    panelIds: ["intent", "canvas", "inspector"],
    storage: layoutStorage,
  });

  const intentRef = useRef<PanelImperativeHandle | null>(null);
  const inspectorRef = useRef<PanelImperativeHandle | null>(null);

  const [collapsed, setCollapsed] = useState({
    intent: false,
    inspector: false,
  });

  /**
   * Takes the ref, not `ref.current`: current is null while this renders, so a
   * handler built from it would ask a null handle forever and the panes would
   * never report being dragged shut.
   */
  const sync = useCallback(
    (
      key: keyof typeof collapsed,
      ref: React.RefObject<PanelImperativeHandle | null>,
    ) =>
      () => {
        const is = ref.current?.isCollapsed() ?? false;
        setCollapsed((prev) => (prev[key] === is ? prev : { ...prev, [key]: is }));
      },
    [],
  );

  const toggle = (
    key: keyof typeof collapsed,
    ref: React.RefObject<PanelImperativeHandle | null>,
  ) => {
    const handle = ref.current;
    if (!handle) return;
    if (handle.isCollapsed()) handle.expand();
    else handle.collapse();
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  /**
   * Narrow viewports give the canvas the room instead. Driven by matchMedia
   * change events, not by width, so it fires once per crossing and an engineer
   * who reopens a pane keeps it open until the viewport actually changes band.
   */
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const bands: [MediaQueryList, React.RefObject<PanelImperativeHandle | null>, keyof typeof collapsed][] = [
      [window.matchMedia("(max-width: 1279px)"), inspectorRef, "inspector"],
      [window.matchMedia("(max-width: 1023px)"), intentRef, "intent"],
    ];

    const listeners = bands.map(([query, ref, key]) => {
      const apply = (narrow: boolean) => {
        const handle = ref.current;
        if (!handle) return;
        if (narrow && !handle.isCollapsed()) handle.collapse();
        if (!narrow && handle.isCollapsed()) handle.expand();
        setCollapsed((prev) => ({ ...prev, [key]: narrow }));
      };
      apply(query.matches);
      const onChange = (e: MediaQueryListEvent) => apply(e.matches);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    });

    return () => listeners.forEach((off) => off());
  }, []);

  return (
    <div className="flex h-screen flex-col bg-surface-base">
      <TopBar onExport={onExport} />

      <div className="flex min-h-0 flex-1">
        <NavRail projectId={projectId} />

        <Group
          orientation="vertical"
          id="workspace-rows"
          className="min-w-0 flex-1"
          defaultLayout={rows.defaultLayout}
          onLayoutChanged={rows.onLayoutChanged}
        >
          <Panel id="content" minSize="35%" className="min-h-0">
            <Group
              orientation="horizontal"
              id="workspace-columns"
              className="h-full"
              defaultLayout={columns.defaultLayout}
              onLayoutChanged={columns.onLayoutChanged}
            >
              <Panel
                id="intent"
                panelRef={intentRef}
                defaultSize="22%"
                minSize="17rem"
                maxSize="34%"
                collapsible
                collapsedSize={RAIL}
                onResize={sync("intent", intentRef)}
                className="relative min-w-0 bg-surface-panel"
              >
                {collapsed.intent ? (
                  <CollapsedRail
                    label="Copilot"
                    side="left"
                    onExpand={() => toggle("intent", intentRef)}
                  />
                ) : (
                  <>
                    <CollapseButton
                      label="the copilot pane"
                      side="left"
                      onCollapse={() => toggle("intent", intentRef)}
                    />
                    {intent}
                  </>
                )}
              </Panel>

              <Separator className="w-px" aria-label="Resize the intent pane" />

              <Panel id="canvas" minSize="20rem" className="min-w-0 bg-surface-panel">
                {canvas}
              </Panel>

              <Separator className="w-px" aria-label="Resize the inspector" />

              <Panel
                id="inspector"
                panelRef={inspectorRef}
                // 23% rather than 21%: its four tabs want 289px once the counts
                // are real - Layers (80), Tags (1248) - and 21% gave them 271.
                defaultSize="23%"
                minSize="16rem"
                maxSize="32%"
                collapsible
                collapsedSize={RAIL}
                onResize={sync("inspector", inspectorRef)}
                className="relative min-w-0 bg-surface-panel"
              >
                {collapsed.inspector ? (
                  <CollapsedRail
                    label="Inspector"
                    side="right"
                    onExpand={() => toggle("inspector", inspectorRef)}
                  />
                ) : (
                  <>
                    <CollapseButton
                      label="the inspector"
                      side="right"
                      onCollapse={() => toggle("inspector", inspectorRef)}
                    />
                    {inspector}
                  </>
                )}
              </Panel>
            </Group>
          </Panel>

        </Group>
      </div>

      <StatusBar />
    </div>
  );
}
