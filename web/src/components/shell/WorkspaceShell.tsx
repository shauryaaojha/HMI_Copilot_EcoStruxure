"use client";

/**
 * The resizable three-pane workspace with the build timeline docked beneath.
 *
 *   +------------------------------------------------------------------+
 *   |                            TopBar                                |
 *   +------+-----------------------------------------------------------+
 *   | Nav  | intent | canvas | inspector                               |
 *   | Rail |------------------------------------------------------------|
 *   |      |                 build timeline (collapsible)               |
 *   +------+-----------------------------------------------------------+
 *   |                           StatusBar                              |
 *   +------------------------------------------------------------------+
 *
 * Layout is persisted per group, so an engineer who widened the inspector once
 * does not have to widen it again. Reference screens 1, 2, 3, 5 and 6.
 *
 * Phase 0 of docs/BUILD_PLAN.md.
 */

import { type ReactNode } from "react";
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  type LayoutStorage,
} from "react-resizable-panels";
import { NavRail } from "./NavRail";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";

/** The timeline collapses to its own title bar rather than disappearing. */
const TIMELINE_COLLAPSED = "2.5rem";

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
  timeline: ReactNode;
  onExport?: () => void;
}

export function WorkspaceShell({
  projectId,
  intent,
  canvas,
  inspector,
  timeline,
  onExport,
}: WorkspaceShellProps) {
  const rows = useDefaultLayout({
    id: "workspace-rows",
    panelIds: ["content", "timeline"],
    storage: layoutStorage,
  });
  const columns = useDefaultLayout({
    id: "workspace-columns",
    panelIds: ["intent", "canvas", "inspector"],
    storage: layoutStorage,
  });

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
                defaultSize="22%"
                minSize="17rem"
                maxSize="34%"
                collapsible
                className="min-w-0 bg-surface-panel"
              >
                {intent}
              </Panel>

              <Separator className="w-px" aria-label="Resize the intent pane" />

              <Panel id="canvas" minSize="30%" className="min-w-0 bg-surface-panel">
                {canvas}
              </Panel>

              <Separator className="w-px" aria-label="Resize the inspector" />

              <Panel
                id="inspector"
                defaultSize="21%"
                minSize="16rem"
                maxSize="32%"
                collapsible
                className="min-w-0 bg-surface-panel"
              >
                {inspector}
              </Panel>
            </Group>
          </Panel>

          <Separator className="h-px" aria-label="Resize the build timeline" />

          <Panel
            id="timeline"
            defaultSize="26%"
            minSize="9rem"
            maxSize="55%"
            collapsible
            collapsedSize={TIMELINE_COLLAPSED}
            className="min-h-0 bg-surface-panel"
          >
            {timeline}
          </Panel>
        </Group>
      </div>

      <StatusBar />
    </div>
  );
}
