/**
 * The project store.
 *
 * Written after a generation that succeeded and then threw: snapshot() called
 * structuredClone on an immer draft, which is a Proxy and cannot be cloned. The
 * throw surfaced inside whatever applied the "done" event, was caught by the
 * fallback handler, and ran the local pipeline on top of the finished run -
 * leaving two screens in the store and one red line on screen that named none
 * of it.
 *
 * Nothing here exercised the store, which is why none of the 187 tests noticed.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useProject } from "@/store/project";
import { demoScreen, demoVariables, demoAlarms } from "@/fixtures";

const seed = () =>
  useProject.getState().hydrate({
    id: "test",
    name: "Test",
    screens: [structuredClone(demoScreen)],
    activeScreenId: demoScreen.UniqueId,
    variables: structuredClone(demoVariables),
    alarms: structuredClone(demoAlarms),
    bindings: [],
  });

describe("versioning", () => {
  beforeEach(() => {
    useProject.getState().reset();
    seed();
  });

  it("takes a snapshot without throwing on the draft", () => {
    // The regression. Under immer `s` is a Proxy, and structuredClone(Proxy)
    // throws "could not be cloned".
    expect(() => useProject.getState().snapshot("Screen generated")).not.toThrow();
    expect(useProject.getState().versions).toHaveLength(1);
  });

  it("stores a snapshot that does not follow later edits", () => {
    useProject.getState().snapshot("Before");
    const before = useProject.getState().versions[0];
    const originalCount = before.screens[0].Children[0].Children.length;

    const screenId = useProject.getState().screens[0].UniqueId;
    useProject.getState().appendObject(screenId, {
      Type: "Rectangle",
      UniqueId: crypto.randomUUID(),
      Name: "Later",
      Location: { Left: 0, Top: 0 },
      Width: 10,
      Height: 10,
    });

    expect(useProject.getState().screens[0].Children[0].Children).toHaveLength(
      originalCount + 1,
    );
    // A shallow copy would have grown with it.
    expect(useProject.getState().versions[0].screens[0].Children[0].Children).toHaveLength(
      originalCount,
    );
  });

  it("restores a version without throwing, and detaches it", () => {
    useProject.getState().snapshot("Checkpoint");
    const at = useProject.getState().versions[0].at;

    const screenId = useProject.getState().screens[0].UniqueId;
    useProject.getState().appendObject(screenId, {
      Type: "Rectangle",
      UniqueId: crypto.randomUUID(),
      Name: "Extra",
      Location: { Left: 0, Top: 0 },
      Width: 10,
      Height: 10,
    });
    const grown = useProject.getState().screens[0].Children[0].Children.length;

    expect(() => useProject.getState().restore(at)).not.toThrow();
    expect(useProject.getState().screens[0].Children[0].Children).toHaveLength(grown - 1);

    // Restoring must not hand the live tree the version's own arrays, or the
    // next edit would rewrite history.
    const restoredId = useProject.getState().screens[0].UniqueId;
    useProject.getState().appendObject(restoredId, {
      Type: "Rectangle",
      UniqueId: crypto.randomUUID(),
      Name: "AfterRestore",
      Location: { Left: 0, Top: 0 },
      Width: 10,
      Height: 10,
    });
    expect(
      useProject.getState().versions.find((v) => v.at === at)!.screens[0].Children[0]
        .Children,
    ).toHaveLength(grown - 1);
  });

  it("keeps at most twenty versions", () => {
    for (let i = 0; i < 25; i++) useProject.getState().snapshot(`v${i}`);
    expect(useProject.getState().versions).toHaveLength(20);
    expect(useProject.getState().versions[0].description).toBe("v24");
  });
});

describe("a generation run", () => {
  beforeEach(() => {
    useProject.getState().reset();
    seed();
  });

  it("leaves exactly one screen after a run that snapshots", () => {
    // Two screens in the store is what the masked failure produced.
    useProject.getState().snapshot("Screen generated");
    expect(useProject.getState().screens).toHaveLength(1);
  });
});
