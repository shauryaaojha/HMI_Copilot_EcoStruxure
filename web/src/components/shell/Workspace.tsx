"use client";

/**
 * The workspace route's client half: hydrate the store, then hand the four
 * regions to the shell.
 */

import { useProjectHydration } from "./useProjectHydration";
import { CanvasPane } from "@/components/canvas/CanvasPane";
import { Inspector } from "@/components/inspector/Inspector";
import { IntentPanel } from "@/components/intent/IntentPanel";
import { BuildTimeline } from "@/components/timeline/BuildTimeline";
import { WorkspaceShell } from "./WorkspaceShell";

export function Workspace({ projectId }: { projectId: string }) {
  useProjectHydration(projectId);

  return (
    <WorkspaceShell
      projectId={projectId}
      intent={<IntentPanel />}
      canvas={<CanvasPane />}
      inspector={<Inspector />}
      timeline={<BuildTimeline />}
    />
  );
}
