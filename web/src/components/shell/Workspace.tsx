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

import { ProposalReviewHost } from "@/components/chat/ProposalReview";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useProject } from "@/store/project";
import { useCanEdit } from "@/store/access";
import { StartPane } from "./StartPane";
import { useProjectHydration } from "./useProjectHydration";
import { startPaneFor } from "./startPaneDecision";
import { useCollab } from "./useCollab";
import { CanvasPane } from "@/components/canvas/CanvasPane";
import { Inspector } from "@/components/inspector/Inspector";
import { ChatPanel } from "@/components/chat/ChatPanel";

const WorkspaceShell = dynamic(
  () => import("./WorkspaceShell").then((m) => m.WorkspaceShell),
  {
    ssr: false,
    // The shell's own shape, so the workspace arrives into its place rather than out of a blank page.
    loading: () => (
      <div aria-busy className="flex h-screen flex-col bg-surface-base">
        <div className="h-11 shrink-0 border-b border-line-subtle bg-surface-frame" />
        <div className="flex min-h-0 flex-1">
          <div className="w-14 shrink-0 border-r border-line-subtle bg-surface-frame" />
          <div className="w-[22%] min-w-64 space-y-3 border-r border-line-subtle bg-surface-copilot p-3">
            <div className="skeleton h-7 w-2/3" />
            <div className="skeleton h-16" />
            <div className="skeleton h-10" />
            <div className="skeleton h-10" />
          </div>
          <div className="canvas-grid flex min-w-0 flex-1 items-center justify-center p-10">
            <div className="skeleton aspect-[1024/600] w-full max-w-3xl" />
          </div>
          <div className="hidden w-[23%] min-w-60 space-y-3 border-l border-line-subtle bg-surface-panel p-3 xl:block">
            <div className="skeleton h-7" />
            <div className="skeleton h-24" />
            <div className="skeleton h-24" />
          </div>
        </div>
        <div className="h-7 shrink-0 border-t border-line-subtle bg-surface-panel" />
      </div>
    ),
  },
);

export function Workspace({ projectId }: { projectId: string }) {
  useProjectHydration(projectId);
  // A shared project goes live once it has loaded; any other is unaffected.
  useCollab(projectId);
  const canEdit = useCanEdit();

  /**
   * An empty project opens on the start pane rather than on an empty grid.
   * Decided once, after hydration, and then latched: importing a tag export
   * fills the store, so a live `empty` would tear the pane off the screen in
   * the middle of its own reveal. The pane says when it is finished.
   */
  const [start, setStart] = useState<boolean | null>(null);
  // Re-run when the store takes this project: hydration is asynchronous.
  const loadedId = useProject((s) => s.id);
  useEffect(() => {
    if (start !== null) return;
    const decided = startPaneFor(useProject.getState(), projectId);
    if (decided !== null) setStart(decided);
  }, [start, projectId, loadedId]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Every answer the start pane offers builds something, so a viewer of
          an empty shared project lands on the empty canvas instead. */}
      {start && canEdit && <StartPane projectId={projectId} onDone={() => setStart(false)} />}
      {/* Until the project has loaded it is not known whether the start pane
          opens, so nothing underneath takes input yet: something typed into
          the chat would be wiped by hydration, or covered by the start pane. */}
      {start === null && (
        <div aria-busy className="absolute inset-0 z-30 flex items-center justify-center bg-surface-base/80 backdrop-blur-sm">
          <span className="inline-flex items-center gap-2 text-xs text-text-muted">
            <Loader2 size={14} className="animate-spin" aria-hidden /> Opening the project…
          </span>
        </div>
      )}
      <WorkspaceShell
      projectId={projectId}
      intent={<ChatPanel />}
      canvas={<CanvasPane />}
      inspector={<Inspector />}
      />
      {/* A change waiting for a decision is shown over the whole workspace, not only in the chat pane. */}
      <ProposalReviewHost />
    </div>
  );
}
