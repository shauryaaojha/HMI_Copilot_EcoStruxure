"use client";

/**
 * Starting again: a new project, a blank canvas, an empty conversation.
 *
 * Nothing is lost by doing this. The project being left is autosaved under its
 * own id and stays on the Projects page, so this is a "new tab", not a "clear
 * everything" - which is why it does not stop to ask.
 *
 * The store is reset before the route changes so the canvas does not show the
 * old project for a frame on the way to the new one. Resetting also empties the
 * screens, and the autosave subscriber skips an empty project, so the outgoing
 * project's save is left exactly as it was.
 */

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useProject } from "@/store/project";
import { createProject, type ProjectRecord } from "@/store/projects";

export function useNewProject() {
  const router = useRouter();
  const reset = useProject((s) => s.reset);

  return useCallback(
    (name?: string): ProjectRecord => {
      const record = createProject(name);
      reset();
      router.push(`/project/${record.id}`);
      return record;
    },
    [reset, router],
  );
}
