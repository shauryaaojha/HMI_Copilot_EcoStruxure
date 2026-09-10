"use client";

/**
 * Chrome for the full-width routes - Tags, Validation, Export, Templates and
 * the rest of reference screen 4's sitemap.
 *
 * The workspace has its own shell because it owns resizable regions; everything
 * else is a page inside the same top bar, nav rail and status bar, so they
 * share this instead of each rebuilding the frame.
 *
 * Phase 3 of docs/BUILD_PLAN.md.
 */

import { type ReactNode } from "react";
import { NavRail } from "./NavRail";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";
import { useProjectHydration } from "./useProjectHydration";

export interface PageShellProps {
  projectId: string;
  title: string;
  description?: string;
  /** Rendered at the trailing edge of the page header. */
  actions?: ReactNode;
  children: ReactNode;
}

export function PageShell({
  projectId,
  title,
  description,
  actions,
  children,
}: PageShellProps) {
  // Deep-linking straight to /project/x/validation has to find a project, so
  // every route hydrates through the same path the workspace does.
  useProjectHydration(projectId);

  return (
    <div className="flex h-screen flex-col bg-surface-base">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <NavRail projectId={projectId} />
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-panel">
          <header className="flex shrink-0 items-start gap-4 border-b border-line-subtle px-6 py-4">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold">{title}</h1>
              {description && (
                <p className="mt-0.5 text-sm text-text-muted">{description}</p>
              )}
            </div>
            {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
          </header>
          <div className="min-h-0 flex-1 p-6">{children}</div>
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
