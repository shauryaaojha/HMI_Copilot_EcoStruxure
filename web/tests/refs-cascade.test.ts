/**
 * Deleting a screen must take its objects' references with it: bindings and
 * composites that point at a removed part would export as dangling references.
 */
import { describe, expect, it } from "vitest";
import { lamp } from "@/lib/ote/parts";
import { demoScreen } from "@/fixtures";
import { createProjectStore } from "@/store/project";

describe("removing a screen takes its references with it", () => {
  it("drops the bindings of the objects on that screen", () => {
    const store = createProjectStore();
    const first = structuredClone(demoScreen);
    const second = structuredClone(demoScreen);
    second.UniqueId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
    const run = lamp("Lamp_Run", "Off", "On", { left: 20, top: 100, width: 24, height: 24 });
    second.Children[0].Children = [run];
    store.getState().hydrate({
      id: "p", name: "Two screens", target: { model: "HMIGTO6310", width: 1024, height: 600 },
      screens: [first, second], activeScreenId: first.UniqueId, variables: [],
    });
    store.setState({
      bindings: [{ tag: "PMP_101_RUN", targetId: run.UniqueId, targetName: run.Name, property: "CurrentValue" }],
    });
    store.getState().removeScreen(second.UniqueId);
    expect(store.getState().bindings).toEqual([]);
  });
});
