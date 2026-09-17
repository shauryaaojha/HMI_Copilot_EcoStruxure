/**
 * What a proposal would do, as the canvas ghosts it, and what the lookup
 * tools find. docs/PLAN_PHASE1.md items 4 and 5, without a model.
 */

import { describe, expect, it } from "vitest";
import { dryRun, previewOf } from "@/lib/ai/applier";
import { findObjects, findTags } from "@/lib/ai/retrieve";
import { createProjectStore } from "@/store/project";
import { demoScreen, demoVariables } from "@/fixtures";

function seeded(sparse = false) {
  const store = createProjectStore();
  const screen = structuredClone(demoScreen);
  if (sparse) screen.Children[0].Children = screen.Children[0].Children.slice(0, 1);
  store.getState().hydrate({
    id: "p",
    name: "Preview",
    target: { model: "HMIGTO6310", width: 1024, height: 600 },
    screens: [screen],
    activeScreenId: screen.UniqueId,
    variables: structuredClone(demoVariables),
  });
  return store;
}

describe("previewOf", () => {
  it("lists what would be added, without touching the live project", () => {
    const store = seeded(true);
    const before = JSON.stringify(store.getState().screens);
    const run = dryRun([{ op: "addObject", type: "Lamp", name: "Ghost", note: "n" }], store);
    const preview = previewOf(run, store);
    const [screenId] = Object.keys(preview);
    expect(preview[screenId].added.map((p) => p.Name)).toEqual(["Ghost"]);
    expect(preview[screenId].removed).toEqual([]);
    expect(JSON.stringify(store.getState().screens)).toBe(before);
  });

  it("lists what would be removed and what would move", () => {
    const store = seeded();
    const parts = store.getState().screens[0].Children[0].Children;
    const gone = parts.find((p) => p.Name === "Lbl_Alarms")!;
    const moving = parts.find((p) => p.Name === "Num_Flow")!;
    const run = dryRun(
      [
        { op: "deleteObject", target: "Lbl_Alarms", note: "n" },
        { op: "moveObject", target: "Num_Flow", left: 670, top: 130, note: "n" },
      ],
      store,
    );
    const preview = previewOf(run, store);
    const p = preview[store.getState().screens[0].UniqueId];
    expect(p.removed).toEqual([gone.UniqueId]);
    expect(p.moved).toHaveLength(1);
    expect(p.moved[0].id).toBe(moving.UniqueId);
    expect(p.moved[0].to.top).toBe(130);
    expect(p.added).toEqual([]);
  });

  it("says nothing about a screen the run did not touch", () => {
    const store = seeded();
    const run = dryRun([{ op: "addScreen", name: "Other", note: "n" }], store);
    const preview = previewOf(run, store);
    expect(Object.keys(preview)).toHaveLength(0);
  });
});

describe("the lookup tools", () => {
  it("find_tags finds a tag by its comment when no word of its name matches", () => {
    const hits = findTags(
      [
        ...demoVariables,
        { Name: "BW_X1", DataType: "REAL", Comments: "Backwash filter high level", DeviceAddress: "" },
      ],
      "the backwash high level",
    );
    expect(hits[0].Name).toBe("BW_X1");
  });

  it("find_objects finds an object on another screen by its bound tag", () => {
    const hits = findObjects(
      [
        { handle: "o4", name: "Lamp_A", type: "Lamp", screen: "s1", tag: "PMP_101_RUN" },
        { handle: "o40", name: "Lamp_B", type: "Lamp", screen: "s3", tag: "DOS_201_FLT" },
      ],
      "the dosing pump fault lamp",
    );
    expect(hits[0].handle).toBe("o40");
  });

  it("find_objects matches a handle said outright", () => {
    const hits = findObjects(
      [
        { handle: "o4", name: "Lamp_A", type: "Lamp", screen: "s1" },
        { handle: "o40", name: "Lamp_B", type: "Lamp", screen: "s3" },
      ],
      "make o40 red",
    );
    expect(hits[0].handle).toBe("o40");
  });
});
