"use client";

/**
 * The workspace route's client half: hydrate the store, then hand the four
 * regions to the shell.
 *
 * The shell is loaded client-side only. react-resizable-panels reads the saved
 * layout out of localStorage while it renders, so the server - which has no
 * localStorage and therefore lays the panels out at their defaults - produced
 * different inline sizes from the browser, and React reported a hydration
 * mismatch it refused to patch up on every reload once a layout had been
 * saved. Which is to say: on every visit after an engineer's first.
 *
 * Skipping the server render is the honest fix rather than a workaround. The
 * project itself comes out of localStorage in an effect, so the server never
 * had anything real to draw here - the server HTML was an empty canvas that
 * was thrown away a frame later regardless.
 */

import dynamic from "next/dynamic";
import { useProjectHydration } from "./useProjectHydration";
import { CanvasPane } from "@/components/canvas/CanvasPane";
import { Inspector } from "@/components/inspector/Inspector";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { BuildTimeline } from "@/components/timeline/BuildTimeline";

const WorkspaceShell = dynamic(
  () => import("./WorkspaceShell").then((m) => m.WorkspaceShell),
  {
    ssr: false,
    // Matches the shell's own ground, so the swap is not a flash of white.
    loading: () => <div className="min-h-0 flex-1 bg-surface-base" />,
  },
);

export function Workspace({ projectId }: { projectId: string }) {
  useProjectHydration(projectId);

  return (
    <WorkspaceShell
      projectId={projectId}
      intent={<ChatPanel />}
      canvas={<CanvasPane />}
      inspector={<Inspector />}
      timeline={<BuildTimeline />}
    />
  );
}
