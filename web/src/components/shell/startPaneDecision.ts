import type { ProjectState } from "@/store/state";

/**
 * Whether a project opens on the start pane: true for an empty project, false
 * for one with anything in it, and null while the store does not hold this
 * project yet. Hydration is asynchronous (it asks the server first), so before
 * it lands the store is empty, and deciding then put the start pane over every
 * reopened project (docs/audit/BUGS.md S4-01).
 */
export function startPaneFor(
  s: Pick<ProjectState, "id" | "screens" | "variables" | "chat">,
  projectId: string,
): boolean | null {
  if (s.id !== projectId) return null;
  return (
    s.screens.every((screen) => screen.Children[0].Children.length === 0) &&
    s.variables.length === 0 &&
    s.chat.length === 0
  );
}
