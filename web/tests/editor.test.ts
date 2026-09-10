/**
 * The editor's store: screens as pages, undo/redo, clipboard, lock and group.
 *
 * These are the actions the toolbar, the keyboard, the context menu and the
 * chat's op list all reach, so a bug here is a bug in four places at once. The
 * previous store had no coverage at all, which is how a throw on every
 * successful generation went unnoticed by 187 passing tests - see
 * tests/store.test.ts.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useProject } from "@/store/project";
import { demoScreen, demoVariables } from "@/fixtures";
import { rectangle } from "@/lib/ote/parts";

const s = () => useProject.getState();

const seed = () => {
  s().reset();
  s().hydrate({
    id: "test",
    name: "Test",
    target: { model: "HMIGTO6310", width: 1024, height: 600 },
    screens: [structuredClone(demoScreen)],
    activeScreenId: demoScreen.UniqueId,
    variables: structuredClone(demoVariables),
  });
};

const active = () =>
  s().screens.find((x) => x.UniqueId === s().activeScreenId) ?? s().screens[0];
const parts = () => active().Children[0].Children;

describe("screens as pages", () => {
  beforeEach(seed);

  it("adds a screen, makes it active, and leaves it empty", () => {
    const id = s().addScreen("Filters");
    expect(s().screens).toHaveLength(2);
    expect(s().activeScreenId).toBe(id);
    expect(parts()).toHaveLength(0);
  });

  it("will not let two screens share a name", () => {
    s().addScreen("Overview");
    s().addScreen("Overview");
    const names = s().screens.map((x) => x.Name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("duplicates a screen with fresh ids and non-colliding object names", () => {
    const before = parts().length;
    const id = s().duplicateScreen(demoScreen.UniqueId)!;
    expect(s().screens).toHaveLength(2);

    const copy = s().screens.find((x) => x.UniqueId === id)!;
    expect(copy.Children[0].Children).toHaveLength(before);
    expect(copy.Children[0].UniqueId).not.toBe(demoScreen.Children[0].UniqueId);

    // Bindings resolve by name, so a duplicate that reused them would wire the
    // copy's objects to the original's tags.
    const everyName = s().screens.flatMap((x) =>
      x.Children[0].Children.map((p) => p.Name),
    );
    expect(new Set(everyName).size).toBe(everyName.length);
  });

  it("keeps the last screen, because a project with none cannot be packaged", () => {
    s().removeScreen(demoScreen.UniqueId);
    expect(s().screens).toHaveLength(1);
  });

  it("moves to a surviving screen when the active one is deleted", () => {
    const second = s().addScreen("Second");
    s().removeScreen(second);
    expect(s().screens).toHaveLength(1);
    expect(s().activeScreenId).toBe(demoScreen.UniqueId);
  });

  it("reorders, which changes the export - screen 0 anchors the binding graph", () => {
    s().addScreen("Second");
    const before = s().screens.map((x) => x.Name);
    s().reorderScreens(0, 1);
    expect(s().screens.map((x) => x.Name)).toEqual([before[1], before[0]]);
  });
});

describe("undo and redo", () => {
  beforeEach(seed);

  it("puts back what an edit changed", () => {
    const before = parts().length;
    s().appendObject(active().UniqueId, rectangle("New", { left: 0, top: 0, width: 10, height: 10 }));
    expect(parts()).toHaveLength(before + 1);

    s().undo();
    expect(parts()).toHaveLength(before);

    s().redo();
    expect(parts()).toHaveLength(before + 1);
  });

  it("has nothing to undo on a freshly loaded project", () => {
    expect(s().past).toHaveLength(0);
    s().undo();
    expect(parts().length).toBeGreaterThan(0);
  });

  it("drops the redo stack once a new edit lands, as every editor does", () => {
    s().appendObject(active().UniqueId, rectangle("A", { left: 0, top: 0, width: 10, height: 10 }));
    s().undo();
    expect(s().future).toHaveLength(1);
    s().appendObject(active().UniqueId, rectangle("B", { left: 0, top: 0, width: 10, height: 10 }));
    expect(s().future).toHaveLength(0);
  });

  it("restores a moved object to where it was", () => {
    const id = parts()[0].UniqueId;
    const was = parts()[0].Location.Left;
    s().nudge([id], 40, 0);
    expect(parts()[0].Location.Left).toBe(was + 40);
    s().undo();
    expect(parts()[0].Location.Left).toBe(was);
  });
});

describe("clipboard", () => {
  beforeEach(seed);

  it("pastes a copy rather than the same object", () => {
    const first = parts()[0];
    const before = parts().length;
    s().copyObjects([first.UniqueId]);
    s().pasteObjects();

    expect(parts()).toHaveLength(before + 1);
    const pasted = parts().at(-1)!;
    expect(pasted.UniqueId).not.toBe(first.UniqueId);
    expect(pasted.Name).not.toBe(first.Name);
    expect(s().selectedIds).toEqual([pasted.UniqueId]);
  });

  it("pastes onto whichever screen is active now", () => {
    s().copyObjects([parts()[0].UniqueId]);
    s().addScreen("Second");
    s().pasteObjects();
    expect(parts()).toHaveLength(1);
  });

  it("cut removes the original and keeps it available to paste", () => {
    const id = parts()[0].UniqueId;
    const before = parts().length;
    s().cutObjects([id]);
    expect(parts()).toHaveLength(before - 1);
    s().pasteObjects();
    expect(parts()).toHaveLength(before);
  });

  it("duplicate offsets the copy so it is not hidden under the original", () => {
    const first = parts()[0];
    s().duplicateObjects([first.UniqueId]);
    const copy = parts().at(-1)!;
    expect(copy.Location.Left).toBeGreaterThan(first.Location.Left);
  });
});

describe("lock, hide and group", () => {
  beforeEach(seed);

  it("a locked object ignores a move and a delete", () => {
    const id = parts()[0].UniqueId;
    const was = parts()[0].Location.Left;
    s().setMeta([id], { locked: true });

    s().nudge([id], 50, 50);
    expect(parts()[0].Location.Left).toBe(was);

    const before = parts().length;
    s().removeObjects([id]);
    expect(parts()).toHaveLength(before);
  });

  it("clears the record rather than leaving an empty one in the save file", () => {
    const id = parts()[0].UniqueId;
    s().setMeta([id], { locked: true });
    expect(s().objectMeta[id]).toEqual({ locked: true });
    s().setMeta([id], { locked: false });
    expect(s().objectMeta[id]).toBeUndefined();
  });

  it("groups two objects under one id and ungroups them again", () => {
    const [a, b] = parts();
    s().group([a.UniqueId, b.UniqueId]);
    expect(s().objectMeta[a.UniqueId].groupId).toBe(s().objectMeta[b.UniqueId].groupId);

    s().ungroup([a.UniqueId]);
    expect(s().objectMeta[a.UniqueId]).toBeUndefined();
    expect(s().objectMeta[b.UniqueId]).toBeUndefined();
  });

  it("select all skips hidden objects", () => {
    const id = parts()[0].UniqueId;
    s().setMeta([id], { hidden: true });
    s().selectAll();
    expect(s().selectedIds).not.toContain(id);
    expect(s().selectedIds).toHaveLength(parts().length - 1);
  });
});

describe("deleting an object", () => {
  beforeEach(seed);

  it("takes its bindings with it, so no dangling target reaches the export", () => {
    const id = parts()[0].UniqueId;
    s().addBinding({ tag: "PMP_101_RUN", targetId: id, targetName: parts()[0].Name, property: "CurrentValue" });
    expect(s().bindings).toHaveLength(1);
    s().removeObjects([id]);
    expect(s().bindings).toHaveLength(0);
  });
});

describe("a new project", () => {
  it("starts blank: one empty screen, no tags, alarms, bindings or chat", () => {
    // What useProjectHydration writes for any id that is not the demo. The
    // rule matters: a new project that arrives carrying somebody else's pump
    // station is not a new project.
    s().reset();
    const target = { model: "HMIGTO6310", width: 1024, height: 600 };
    s().hydrate({
      id: "p-new",
      name: "Untitled",
      target,
      screens: [
        {
          Type: "Screen",
          UniqueId: crypto.randomUUID(),
          Name: "Screen1",
          Children: [
            {
              Type: "ViewBox",
              UniqueId: crypto.randomUUID(),
              Name: "ViewBox",
              Options: 108,
              Width: target.width,
              Height: target.height,
              Children: [],
            },
          ],
        },
      ],
      variables: [],
      alarms: [],
      bindings: [],
      objectMeta: {},
      versions: [],
      chat: [],
    });

    expect(s().screens).toHaveLength(1);
    expect(s().screens[0].Children[0].Children).toHaveLength(0);
    expect(s().variables).toHaveLength(0);
    expect(s().alarms).toHaveLength(0);
    expect(s().bindings).toHaveLength(0);
    expect(s().chat).toHaveLength(0);
    expect(s().versions).toHaveLength(0);
  });

  it("has one screen rather than none, so the first object has somewhere to go", () => {
    // Zero screens would make "add a screen" a step that exists for no reason,
    // and the packager refuses a project without one.
    const screen = s().screens[0];
    s().appendObject(screen.UniqueId, rectangle("First", { left: 0, top: 0, width: 10, height: 10 }));
    expect(s().screens[0].Children[0].Children).toHaveLength(1);
  });
});

describe("arranging screens on the board", () => {
  beforeEach(seed);

  it("remembers where a screen was dragged to", () => {
    const id = s().addScreen("Second");
    s().placeScreen(id, { x: 1400, y: 320 });
    expect(s().screenPlacement[id]).toEqual({ x: 1400, y: 320 });
  });

  it("rounds, because a board position is in screen units", () => {
    const id = s().addScreen("Second");
    s().placeScreen(id, { x: 100.6, y: -40.2 });
    expect(s().screenPlacement[id]).toEqual({ x: 101, y: -40 });
  });

  it("ignores a screen that is not in the project", () => {
    s().placeScreen("not-a-screen", { x: 10, y: 10 });
    expect(s().screenPlacement["not-a-screen"]).toBeUndefined();
  });

  it("is undoable like any other edit", () => {
    const id = s().addScreen("Second");
    s().placeScreen(id, { x: 900, y: 0 });
    s().undo();
    expect(s().screenPlacement[id]).toBeUndefined();
  });

  it("tidying puts every screen back in the automatic grid", () => {
    const id = s().addScreen("Second");
    s().placeScreen(id, { x: 900, y: 0 });
    s().tidyBoard();
    expect(s().screenPlacement).toEqual({});
  });

  it("forgets a deleted screen's placement", () => {
    const id = s().addScreen("Second");
    s().placeScreen(id, { x: 900, y: 0 });
    s().removeScreen(id);
    expect(s().screenPlacement[id]).toBeUndefined();
  });
});
