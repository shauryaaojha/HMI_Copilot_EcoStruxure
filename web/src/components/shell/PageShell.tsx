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
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();

  return (
    <div className="flex h-screen flex-col bg-surface-base">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <NavRail projectId={projectId} />
        {/* The page is an island on the ground, the way the workspace's panes are. */}
        <main key={pathname} className="island animate-swap mb-2 mr-2 flex min-h-0 flex-1 flex-col overflow-y-auto">
          <header className="page-head flex shrink-0 items-end gap-4 border-b border-line-subtle px-7 pb-5 pt-6">
            <div className="min-w-0">
              <p className="label-eyebrow">Project</p>
              <h1 className="mt-1 text-[1.35rem] font-semibold leading-tight tracking-tight">{title}</h1>
              {description && (
                <p className="mt-1 text-sm text-text-muted">{description}</p>
              )}
            </div>
            {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
          </header>
          <div className="min-h-0 flex-1 px-7 py-6">{children}</div>
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
