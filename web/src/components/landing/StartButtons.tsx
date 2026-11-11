"use client";

/**
 * The landing's calls to action: start, open a file, or go to the projects already made.
 *
 * They have to be client-side because a project is an id created in the
 * browser's own storage - there is no server to ask for one. The landing page
 * itself stays a server component; only these two buttons are shipped.
 *
 * They used to point at `/project/demo`, an id that was special-cased all the
 * way through the store to open on a fixture. That is gone: a new project is a
 * new project, and the start pane asks what to build.
 */

import { ArrowRight, FolderOpen, LayoutGrid } from "lucide-react";
import { useNewProject } from "@/components/shell/useNewProject";

export function StartButtons({ compact = false }: { compact?: boolean }) {
  const newProject = useNewProject();

  if (compact) {
    return (
      <>
      <a href="/projects" className="focus-ring inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-sm font-medium text-text-secondary transition hover:border-line-strong hover:text-text-primary">
        <LayoutGrid size={14} aria-hidden />
        Your projects
      </a>
      <button
        type="button"
        onClick={() => newProject()}
        className="focus-ring press ml-auto inline-flex h-9 items-center gap-2 rounded-lg btn-primary px-4 text-sm font-medium text-text-onbrand transition hover:brightness-110"
      >
        Get started
        <ArrowRight size={15} aria-hidden />
      </button>
      </>
    );
  }

  return (
    <div className="mt-8 flex flex-wrap gap-2.5">
      <button
        type="button"
        onClick={() => newProject()}
        className="focus-ring press inline-flex h-11 items-center gap-2 rounded-xl btn-primary px-5 text-sm font-semibold text-text-onbrand transition hover:brightness-110"
      >
        Start a project
        <ArrowRight size={16} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => newProject(undefined, { open: true })}
        className="focus-ring press inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-surface-raised/50 px-4 text-sm font-medium text-text-secondary backdrop-blur-sm transition hover:border-line-strong hover:text-text-primary"
      >
        <FolderOpen size={15} aria-hidden />
        Open an existing .eote
      </button>
      <a
        href="/projects"
        className="focus-ring press inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-surface-raised/50 px-4 text-sm font-medium text-text-secondary backdrop-blur-sm transition hover:border-line-strong hover:text-text-primary"
      >
        <LayoutGrid size={15} aria-hidden />
        Your projects
      </a>
    </div>
  );
}
