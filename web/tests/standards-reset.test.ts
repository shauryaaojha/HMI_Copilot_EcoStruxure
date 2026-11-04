/**
 * S4-03 (docs/audit/BUGS.md), moved from web/scripts/audit/ with the fix.
 * S4: a new project inherits the previous project's settings, including
 * "Review every AI edit before it lands".
 *
 * useNewProject (src/components/shell/useNewProject.ts:27-29) calls reset() and opens a
 * fresh id. reset() (src/store/project.ts:536-567) clears screens, tags and history but
 * not `standards`, and the new-project hydrate in useProjectHydration.ts:165-177 sets no
 * standards. So the grid size, snap and the management-of-change switch of the project
 * just left carry into the new one, and are then autosaved into it.
 */
import { describe, expect, it } from "vitest";
import { createProjectStore, DEFAULT_STANDARDS } from "@/store/project";

describe("a new project", () => {
  it("starts from the default standards, not the last project's", () => {
    const store = createProjectStore();
    const s = () => store.getState();
    s().hydrate({ id: "old", name: "Old", screens: [], standards: { ...DEFAULT_STANDARDS } });
    s().setStandards({ reviewAiEdits: true, gridSize: 20 });

    // useNewProject -> reset(); then useProjectHydration's new-project hydrate.
    s().reset();
    s().hydrate({
      id: "new", name: "Untitled", target: { model: "X", width: 800, height: 480 },
      screens: [], variables: [], alarms: [], bindings: [], objectMeta: {}, screenPlacement: {}, versions: [], chat: [],
    });

    expect(s().standards.reviewAiEdits ?? false, "reviewAiEdits leaked from the previous project into a new one").toBe(false);
    expect(s().standards.gridSize, "gridSize leaked from the previous project").toBe(DEFAULT_STANDARDS.gridSize);
  });
});
