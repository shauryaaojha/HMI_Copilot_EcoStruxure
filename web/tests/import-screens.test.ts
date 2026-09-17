/**
 * Screens lifted out of another project. docs/PLAN_PHASE2.md item 2.
 *
 * The demo file imported into a store already holding the demo screen is the
 * hardest case: every name collides, every tag already exists, every binding
 * points at an object id that now has a twin. Fresh ids, unique names,
 * bindings re-pointed by tag, one undo step.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readProject } from "@/lib/ote/reader";
import { createProjectStore } from "@/store/project";
import type { ScreenImport } from "@/store/types";
import { demoScreen, demoVariables } from "@/fixtures";

const FILE = path.join(__dirname, "..", "..", "demo_project", "HMICopilot_PumpStation.eote");

async function fromFile(): Promise<ScreenImport & { name: string }> {
  const read = await readProject(new Uint8Array(fs.readFileSync(FILE)));
  return {
    name: read.name,
    screens: read.screens,
    variables: read.variables,
    bindings: read.wires.map((w) => ({
      tag: w.tag,
      targetId: w.part.UniqueId,
      targetName: w.part.Name,
      property: w.property,
    })),
    foreign: read.foreign,
  };
}

function seeded() {
  const store = createProjectStore();
  const screen = structuredClone(demoScreen);
  store.getState().hydrate({
    id: "i",
    name: "Importer",
    target: { model: "HMIGTO6310", width: 1024, height: 600 },
    screens: [screen],
    activeScreenId: screen.UniqueId,
    variables: structuredClone(demoVariables),
  });
  return store;
}

describe("importing the demo into the demo", () => {
  it("lands the screens with fresh ids and unique names, and reports it", async () => {
    const store = seeded();
    const incoming = await fromFile();
    const before = store.getState();
    const oldIds = new Set([
      ...before.screens.map((s) => s.UniqueId),
      ...before.screens.flatMap((s) => s.Children[0].Children.map((p) => p.UniqueId)),
    ]);

    const report = store.getState().importScreens(incoming);
    const s = store.getState();

    expect(report.screens).toBe(incoming.screens.length);
    expect(s.screens).toHaveLength(1 + incoming.screens.length);
    expect(report.objects).toBe(incoming.screens.reduce((n, x) => n + x.Children[0].Children.length, 0));

    // Every id is new, including the ones that collided with the seed.
    for (const screen of s.screens.slice(1)) {
      expect(oldIds.has(screen.UniqueId)).toBe(false);
      for (const part of screen.Children[0].Children) expect(oldIds.has(part.UniqueId)).toBe(false);
    }
    // Every name is unique across the project.
    const names = s.screens.flatMap((x) => x.Children[0].Children.map((p) => p.Name));
    expect(new Set(names).size).toBe(names.length);
    const screenNames = s.screens.map((x) => x.Name);
    expect(new Set(screenNames).size).toBe(screenNames.length);
    expect(report.renamed.length).toBeGreaterThan(0);

    // The first imported screen is live, and the import is one undo step.
    expect(s.activeScreenId).toBe(s.screens[1].UniqueId);
    expect(s.past.at(-1)?.label).toMatch(/^Import/);
    store.getState().undo();
    expect(store.getState().screens).toHaveLength(1);
  });

  it("re-points bindings at the new ids by tag name and adds no duplicate tags", async () => {
    const store = seeded();
    const incoming = await fromFile();
    const tagCount = store.getState().variables.length;

    const report = store.getState().importScreens(incoming);
    const s = store.getState();

    expect(report.tagsAdded).toBe(0);
    expect(s.variables).toHaveLength(tagCount);
    expect(report.bindings).toBe(incoming.bindings.length);
    expect(report.droppedBindings).toEqual([]);
    const objects = new Set(s.screens.flatMap((x) => x.Children[0].Children.map((p) => p.UniqueId)));
    for (const b of s.bindings) {
      expect(objects.has(b.targetId), b.targetName).toBe(true);
      expect(s.variables.some((v) => v.Name === b.tag), b.tag).toBe(true);
    }
  });

  it("adds tags the project lacks, drops bindings to tags neither has, and says so", async () => {
    const store = createProjectStore();
    const screen = structuredClone(demoScreen);
    store.getState().hydrate({
      id: "e",
      name: "Empty",
      target: { model: "HMIGTO6310", width: 1024, height: 600 },
      screens: [screen],
      activeScreenId: screen.UniqueId,
      variables: [],
    });
    const incoming = await fromFile();
    const firstPart = incoming.screens[0].Children[0].Children[0];
    const withStray: ScreenImport = {
      ...incoming,
      bindings: [
        ...incoming.bindings,
        { tag: "NOT_A_TAG", targetId: firstPart.UniqueId, targetName: firstPart.Name, property: "CurrentValue" },
      ],
    };

    const report = store.getState().importScreens(withStray);
    expect(report.tagsAdded).toBe(incoming.variables.length);
    expect(report.bindings).toBe(incoming.bindings.length);
    expect(report.droppedBindings).toHaveLength(1);
    expect(report.droppedBindings[0]).toMatch(/NOT_A_TAG$/);
    expect(store.getState().bindings.some((b) => b.tag === "NOT_A_TAG")).toBe(false);
  });

  it("counts carried objects that cannot come along", async () => {
    const store = seeded();
    const incoming = await fromFile();
    const target = incoming.screens[0].UniqueId;
    const report = store.getState().importScreens({
      ...incoming,
      foreign: { [target]: [{ type: "ZoomCanvas", name: "Z", box: null }] },
    });
    expect(report.carriedLeftBehind).toBe(1);
    expect(store.getState().foreign).toEqual({});
  });

  it("does nothing with nothing", () => {
    const store = seeded();
    const depth = store.getState().past.length;
    const report = store.getState().importScreens({ screens: [], variables: [], bindings: [] });
    expect(report.screens).toBe(0);
    expect(store.getState().past.length).toBe(depth);
  });
});
