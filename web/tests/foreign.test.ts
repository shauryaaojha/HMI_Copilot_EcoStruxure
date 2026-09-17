/**
 * Carried objects are visible. docs/PLAN_PHASE2.md item 1.
 *
 * An opened screen with an object of a type the schema does not model used to
 * show a hole where it is. Now the reader describes each one - type, name,
 * box - the canvas draws it hatched with its type, the layers panel lists it
 * as carried, and none of that reaches the editable slice: it cannot be
 * selected, moved or deleted, and export still puts the original back.
 */

import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readProject, summariseOpaque } from "@/lib/ote/reader";
import { packageProject } from "@/lib/ote/packager";
import { ScreenRenderer } from "@/components/canvas/ScreenRenderer";
import { createProjectStore } from "@/store/project";
import { demoScreen } from "@/fixtures";

const FILE = path.join(__dirname, "..", "..", "demo_project", "HMICopilot_PumpStation.eote");
const bytes = () => new Uint8Array(fs.readFileSync(FILE));

const ALIEN = {
  Type: "ZoomCanvas",
  UniqueId: "11111111-2222-3333-4444-555555555555",
  Name: "Zoom_Alien",
  Options: 108,
  Location: { Left: 120, Top: 80 },
  Width: 300,
  Height: 200,
};

async function withAlien(extra: Record<string, unknown> = {}) {
  const zip = await JSZip.loadAsync(bytes());
  const screenName = Object.keys(zip.files).find((n) => /Screen\.dat$/i.test(n))!;
  const raw = JSON.parse(await zip.file(screenName)!.async("string"));
  raw.Children[0].Children.splice(1, 0, { ...ALIEN, ...extra });
  zip.file(screenName, JSON.stringify(raw, null, 2));
  return zip.generateAsync({ type: "uint8array" });
}

describe("the reader describes what it carries", () => {
  it("lists each carried object per screen with its type, name and box", async () => {
    const read = await readProject(await withAlien());
    const screenId = read.screens[0].UniqueId;
    expect(read.foreign[screenId]).toEqual([
      { type: "ZoomCanvas", name: "Zoom_Alien", box: { left: 120, top: 80, width: 300, height: 200 } },
    ]);
  });

  it("gives a grid-placed object no box rather than a made-up one", async () => {
    const read = await readProject(await withAlien({ Location: { Row: 2, Column: 1 } }));
    const screenId = read.screens[0].UniqueId;
    expect(read.foreign[screenId][0].box).toBeNull();
  });

  it("copes with an object missing everything", () => {
    expect(summariseOpaque({})).toEqual({ type: "Unknown", name: "", box: null });
    expect(summariseOpaque(null)).toEqual({ type: "Unknown", name: "", box: null });
  });

  it("lists nothing for a screen with nothing carried", async () => {
    const read = await readProject(bytes());
    expect(read.foreign).toEqual({});
  });
});

describe("the canvas shows them without owning them", () => {
  const foreign = [{ type: "ZoomCanvas", name: "Zoom_Alien", box: { left: 120, top: 80, width: 300, height: 200 } }];

  it("draws a placeholder with the type and name, outside any object group", () => {
    const html = renderToStaticMarkup(
      createElement(ScreenRenderer, { screen: demoScreen, selectedIds: [], foreign }),
    );
    expect(html).toContain("data-foreign");
    expect(html).toContain("ZoomCanvas Zoom_Alien");
    // Not an object: nothing hit-testable carries its name.
    expect(html).not.toContain('data-object-name="Zoom_Alien"');
  });

  it("draws nothing for a carried object with no box", () => {
    const html = renderToStaticMarkup(
      createElement(ScreenRenderer, {
        screen: demoScreen,
        selectedIds: [],
        foreign: [{ type: "DockPanel", name: "Dock", box: null }],
      }),
    );
    expect(html).not.toContain("DockPanel");
  });
});

describe("carried objects stay out of the editable slice", () => {
  it("are not in the screens the store edits, and survive reset only as the file has them", async () => {
    const read = await readProject(await withAlien());
    const store = createProjectStore();
    store.getState().hydrate({
      id: "f",
      name: "Foreign",
      target: read.target,
      screens: read.screens,
      foreign: read.foreign,
      variables: read.variables,
      alarms: read.alarms,
    });
    const s = store.getState();
    const all = s.screens.flatMap((x) => x.Children[0].Children);
    expect(all.some((p) => p.Name === "Zoom_Alien")).toBe(false);
    expect(Object.values(s.handles)).not.toContain("Zoom_Alien");
    // Select-all cannot reach it.
    s.selectAll();
    expect(store.getState().selectedIds).not.toContain(ALIEN.UniqueId);
    store.getState().reset();
    expect(store.getState().foreign).toEqual({});
  });

  it("go back into the file at their index after an edit", async () => {
    const read = await readProject(await withAlien());
    const out = await packageProject(
      { name: read.name, target: read.target, screens: read.screens, variables: read.variables, alarms: read.alarms, wires: read.wires },
      undefined,
      read.preserved,
    );
    const again = await readProject(out);
    expect(again.foreign[again.screens[0].UniqueId]).toEqual(read.foreign[read.screens[0].UniqueId]);
  });
});
