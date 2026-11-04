/**
 * S4-01 (docs/audit/BUGS.md): reopening a project showed the "New project"
 * start pane over it. The workspace decided before the asynchronous load had
 * filled the store, saw the empty initial state, and latched "empty".
 */
import { describe, expect, it } from "vitest";
import { createProjectStore } from "@/store/project";
import { demoScreen, demoVariables } from "@/fixtures";
import { startPaneFor } from "@/components/shell/startPaneDecision";

describe("the start pane decision", () => {
  it("waits while the store does not hold the project being opened", () => {
    const store = createProjectStore();
    expect(startPaneFor(store.getState(), "p-reopened")).toBeNull();
  });

  it("is false once a project with content has loaded", () => {
    const store = createProjectStore();
    store.getState().hydrate({ id: "p-reopened", screens: [structuredClone(demoScreen)], variables: structuredClone(demoVariables) });
    expect(startPaneFor(store.getState(), "p-reopened")).toBe(false);
  });

  it("is true for a new, empty project", () => {
    const store = createProjectStore();
    const blank = structuredClone(demoScreen);
    blank.Children[0].Children = [];
    store.getState().hydrate({ id: "p-new", screens: [blank], variables: [], chat: [] });
    expect(startPaneFor(store.getState(), "p-new")).toBe(true);
  });

  it("does not take another project's state for this one", () => {
    const store = createProjectStore();
    store.getState().hydrate({ id: "p-other", screens: [structuredClone(demoScreen)] });
    expect(startPaneFor(store.getState(), "p-reopened")).toBeNull();
  });
});
