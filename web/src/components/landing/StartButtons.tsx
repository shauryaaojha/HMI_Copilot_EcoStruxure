"use client";

/**
 * The landing's two calls to action.
 *
 * They have to be client-side because a project is an id created in the
 * browser's own storage - there is no server to ask for one. The landing page
 * itself stays a server component; only these two buttons are shipped.
 *
 * They used to point at `/project/demo`, an id that was special-cased all the
 * way through the store to open on a fixture. That is gone: a new project is a
 * new project, and the start pane asks what to build.
 */

import { ArrowRight, FolderOpen } from "lucide-react";
import { useNewProject } from "@/components/shell/useNewProject";

export function StartButtons({ compact = false }: { compact?: boolean }) {
  const newProject = useNewProject();

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => newProject()}
        className="focus-ring ml-auto inline-flex h-9 items-center gap-2 rounded-md bg-brand-500 px-4 text-sm font-medium text-text-onbrand transition hover:bg-brand-600"
      >
        Get started
        <ArrowRight size={15} aria-hidden />
      </button>
    );
  }

  return (
    <div className="mt-8 flex flex-wrap gap-3">
      <button
        type="button"
        onClick={() => newProject()}
        className="focus-ring inline-flex h-11 items-center gap-2 rounded-md bg-brand-500 px-6 text-sm font-semibold text-text-onbrand transition hover:bg-brand-600"
      >
        Start a project
        <ArrowRight size={16} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => newProject()}
        className="focus-ring inline-flex h-11 items-center gap-2 rounded-md border border-line px-6 text-sm font-medium text-text-secondary transition hover:border-line-strong hover:text-text-primary"
      >
        <FolderOpen size={15} aria-hidden />
        Open an existing .eote
      </button>
    </div>
  );
}
