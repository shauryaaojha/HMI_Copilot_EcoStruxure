/**
 * The conversational half: what a turn is allowed to be, and what its ops do.
 *
 * The model's output is not trusted anywhere in this path - it is parsed, the
 * names it used are resolved against the real project, and anything that does
 * not resolve is reported rather than guessed at. These tests are the ones that
 * would catch a provider drifting: a turn that no longer parses degrades to
 * "no turn", never to a mangled project.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { coerceTurn } from "@/lib/ai/ops";
import { fallbackPlan } from "@/lib/ai/plan";
import { digestOf } from "@/lib/ai/converse";
import { applyOps } from "@/components/chat/applyOps";
import { inferEquipment } from "@/lib/ai/infer";
import { requirementsOf, anythingMissing } from "@/components/chat/requirements";
import { useProject } from "@/store/project";
import { demoScreen, demoVariables } from "@/fixtures";

const s = () => useProject.getState();
const parts = () => s().screens[0].Children[0].Children;

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

describe("coerceTurn", () => {
  it("accepts a minimal turn", () => {
    expect(coerceTurn({ mode: "answer", reply: "Nineteen objects." })).toMatchObject({
      mode: "answer",
    });
  });

  it("rejects anything that is not a turn, rather than half-applying it", () => {
    expect(coerceTurn(null)).toBeNull();
    expect(coerceTurn({ reply: "no mode" })).toBeNull();
    expect(coerceTurn({ mode: "sing", reply: "x" })).toBeNull();
  });

  it("drops an op that names no target for an op that needs one", () => {
    const turn = coerceTurn({
      mode: "edit",
      reply: "Moved it.",
      ops: [
        { op: "moveObject", left: 10, note: "no target" },
        { op: "moveObject", target: "Banner", left: 10, note: "fine" },
      ],
    });
    expect(turn!.ops).toHaveLength(1);
    expect(turn!.ops![0].target).toBe("Banner");
  });

  it("refuses a part type the packager cannot emit", () => {
    expect(
      coerceTurn({
        mode: "edit",
        reply: "x",
        ops: [{ op: "addObject", type: "Gauge", note: "invented" }],
      }),
    ).toBeNull();
  });
});

describe("applyOps", () => {
  beforeEach(seed);

  it("adds an object through the same action the toolbar uses", () => {
    const before = parts().length;
    const { changes, problems } = applyOps([
      {
        op: "addObject",
        type: "Rectangle",
        name: "Panel_New",
        left: 40,
        top: 80,
        width: 200,
        height: 100,
        note: "added a panel for the filter readings",
      },
    ]);

    expect(problems).toHaveLength(0);
    expect(changes).toEqual(["added a panel for the filter readings"]);
    expect(parts()).toHaveLength(before + 1);
    expect(parts().at(-1)!.Name).toBe("Panel_New");
  });

  it("lands in the undo history, so a turn can be taken back", () => {
    const before = parts().length;
    applyOps([{ op: "addObject", type: "Rectangle", name: "X", note: "n" }]);
    s().undo();
    expect(parts()).toHaveLength(before);
  });

  it("reports a name that does not resolve instead of editing something else", () => {
    const before = parts().map((p) => p.Location.Left);
    const { changes, problems } = applyOps([
      { op: "moveObject", target: "Pump_999", left: 500, note: "n" },
    ]);
    expect(changes).toHaveLength(0);
    expect(problems[0]).toContain("Pump_999");
    expect(parts().map((p) => p.Location.Left)).toEqual(before);
  });

  it("moves a real object by name", () => {
    // Not parts()[0] - that is the full-width banner, and a move is clamped
    // into the panel, so a 1024-wide object on a 1024-wide screen cannot shift
    // sideways at all. See the clamping test further down.
    const target = parts().find((p) => p.Width < 400)!;
    applyOps([{ op: "moveObject", target: target.Name, left: 33, top: 44, note: "n" }]);
    const moved = parts().find((p) => p.UniqueId === target.UniqueId)!;
    expect(moved.Location).toEqual({ Left: 33, Top: 44 });
  });

  it("will not bind a tag that is not in the tag list", () => {
    const { problems } = applyOps([
      { op: "bindTag", target: parts()[0].Name, tag: "NOT_A_TAG", note: "n" },
    ]);
    expect(problems[0]).toContain("NOT_A_TAG");
    expect(s().bindings).toHaveLength(0);
  });

  it("binds one that is", () => {
    const tag = s().variables[0].Name;
    applyOps([{ op: "bindTag", target: parts()[0].Name, tag, note: "n" }]);
    expect(s().bindings).toHaveLength(1);
    expect(s().bindings[0].tag).toBe(tag);
  });

  it("adds a screen and can then add to it by name", () => {
    applyOps([
      { op: "addScreen", name: "Filters", note: "added the filter screen" },
      { op: "addObject", screen: "Filters", type: "TextBox", name: "Lbl_F", text: "Filters", note: "titled it" },
    ]);
    expect(s().screens).toHaveLength(2);
    const filters = s().screens.find((x) => x.Name === "Filters")!;
    expect(filters.Children[0].Children).toHaveLength(1);
  });

  it("keeps the last screen even when told to delete it", () => {
    const { problems } = applyOps([
      { op: "deleteScreen", screen: demoScreen.Name, note: "n" },
    ]);
    expect(s().screens).toHaveLength(1);
    expect(problems[0]).toContain("at least one screen");
  });

  it("writes a palette index, never a colour of its own", () => {
    const target = parts().find((p) => p.Type === "Rectangle")!;
    applyOps([
      { op: "setColor", target: target.Name, colorRole: "fill", color: "red", note: "n" },
    ]);
    const after = parts().find((p) => p.UniqueId === target.UniqueId)!;
    expect(after.Type === "Rectangle" && after.Fill?.Color.Value).toBe(5);
  });

  it("adds a level alarm with the setpoint in Value, and a bit alarm without", () => {
    const bool = s().variables.find((v) => v.DataType === "BOOL")!;
    const real = s().variables.find((v) => v.DataType !== "BOOL" && v.DataType !== "STRING")!;

    applyOps([
      { op: "addAlarm", tag: bool.Name, message: "Pump fault", alarmKind: 1, severity: 8, note: "n" },
      { op: "addAlarm", tag: real.Name, message: "Level high", alarmKind: 2, alarmType: 2, value: "85", note: "n" },
    ]);

    const [bit, level] = s().alarms.slice(-2);
    expect(bit.AlarmRecordType).toBe(1);
    expect(bit.Value).toBe("");
    expect(level.AlarmRecordType).toBe(2);
    expect(level.Value).toBe("85");
  });
});

describe("the digest handed to the model", () => {
  beforeEach(seed);

  it("names objects and screens, and never sends the whole tree", () => {
    const digest = digestOf({
      name: s().name,
      target: s().target,
      screens: s().screens,
      activeScreenId: s().activeScreenId,
      variables: s().variables,
      alarms: s().alarms,
      bindings: s().bindings,
      selectedIds: [],
    });

    expect(digest.screens).toHaveLength(1);
    expect(digest.screens[0].active).toBe(true);
    expect(digest.screens[0].objects[0]).toHaveProperty("name");
    expect(digest.screens[0].objects[0]).not.toHaveProperty("Children");
  });

  it("caps the tag list, so a 1,200-tag import does not become the prompt", () => {
    const many = Array.from({ length: 400 }, (_, i) => ({
      Name: `TAG_${i}`,
      DataType: "REAL" as const,
      Comments: "",
      DeviceAddress: "",
    }));
    const digest = digestOf({
      name: "big",
      target: s().target,
      screens: s().screens,
      variables: many,
      alarms: [],
      bindings: [],
      selectedIds: [],
    });
    expect(digest.variables.length).toBeLessThanOrEqual(120);
  });

  it("resolves the selection to names, because that is how ops address things", () => {
    const first = parts()[0];
    const digest = digestOf({
      name: s().name,
      target: s().target,
      screens: s().screens,
      variables: [],
      alarms: [],
      bindings: [],
      selectedIds: [first.UniqueId],
    });
    expect(digest.selection).toEqual([first.Name]);
  });
});

describe("the offline plan", () => {
  const equipmentFor = (count: number) =>
    inferEquipment(
      Array.from({ length: count }, (_, i) => [
        { Name: `PMP_${100 + i}_RUN`, DataType: "BOOL" as const, Comments: "running", DeviceAddress: "" },
        { Name: `PMP_${100 + i}_FLT`, DataType: "BOOL" as const, Comments: "fault", DeviceAddress: "" },
      ]).flat(),
    );

  it("keeps a small station on one screen", () => {
    const plan = fallbackPlan("pump station", equipmentFor(2));
    expect(plan.screens).toHaveLength(1);
    expect(plan.screens[0].level).toBe(2);
  });

  it("adds a plant overview above the rest once there are enough units", () => {
    const plan = fallbackPlan("the whole plant", equipmentFor(9));
    expect(plan.screens.length).toBeGreaterThan(1);
    expect(plan.screens[0].level).toBe(1);
  });

  it("splits rather than crowding, which is the point of the hierarchy", () => {
    const plan = fallbackPlan("everything", equipmentFor(14));
    for (const screen of plan.screens.filter((s) => s.level !== 1)) {
      expect(screen.include.length).toBeLessThanOrEqual(6);
    }
  });

  it("gives every screen a distinct name", () => {
    const names = fallbackPlan("everything", equipmentFor(14)).screens.map((s) => s.screenName);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("what a request needs", () => {
  it("counts the project's own state as satisfied, and asks only for the subject", () => {
    const requirements = requirementsOf({
      variables: demoVariables,
      screens: [demoScreen],
      alarms: [],
      target: { model: "HMIGTO6310", width: 1024, height: 600 },
    });
    expect(anythingMissing(requirements)).toBe(false);
    expect(requirements.find((r) => r.id === "subject")!.met).toBe(false);
  });

  it("says what is missing when the project cannot supply it", () => {
    const requirements = requirementsOf({
      variables: [],
      screens: [],
      alarms: [],
      target: { model: "HMIGTO6310", width: 1024, height: 600 },
    });
    expect(anythingMissing(requirements)).toBe(true);
    expect(requirements.find((r) => r.id === "tags")!.detail).toContain("Import");
  });
});

describe("where a conversational edit puts things", () => {
  beforeEach(seed);

  const screenOf = () => useProject.getState().screens[0];
  const boxes = () =>
    screenOf().Children[0].Children.map((p) => ({
      left: p.Location.Left,
      top: p.Location.Top,
      width: p.Width,
      height: p.Height,
    }));
  const clash = (a: ReturnType<typeof boxes>[number], b: ReturnType<typeof boxes>[number]) =>
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top;

  /** A screen with room on it, which is the case that must come out clean. */
  const sparse = () => {
    const screen = structuredClone(demoScreen);
    // Keep the banner; drop everything else, leaving most of the panel free.
    screen.Children[0].Children = screen.Children[0].Children.slice(0, 1);
    useProject.getState().hydrate({ screens: [screen], activeScreenId: screen.UniqueId });
  };

  it("does not stack objects in one corner when no position was given", () => {
    // Reported from a real session: several turns of editing put everything in
    // the top-left, on top of each other. Every op below omits left and top,
    // which is what a model does for "add a lamp for the standby pump".
    sparse();
    const before = boxes().length;
    applyOps([
      { op: "addObject", type: "Lamp", name: "Lamp_A", note: "n" },
      { op: "addObject", type: "Lamp", name: "Lamp_B", note: "n" },
      { op: "addObject", type: "NumericDisplay", name: "Num_A", note: "n" },
    ]);

    const all = boxes();
    const added = all.slice(before);
    expect(added).toHaveLength(3);
    expect(new Set(added.map((b) => `${b.left},${b.top}`)).size).toBe(3);
    for (let i = 0; i < added.length; i++) {
      // Clear of each other, and clear of what was already on the screen.
      for (let j = i + 1; j < added.length; j++) {
        expect(clash(added[i], added[j]), "two added objects overlap").toBe(false);
      }
      for (const existing of all.slice(0, before)) {
        expect(clash(added[i], existing), "an added object covers an existing one").toBe(
          false,
        );
      }
    }
  });

  it("still spreads them out on a screen with no room left", () => {
    // A generated screen is mostly full - chrome, faceplates and an alarm
    // banner - so this is the common case, not the edge case. Nothing can be
    // placed clear, but they must not all land on the same spot.
    const before = boxes().length;
    applyOps([
      { op: "addObject", type: "Lamp", name: "Full_A", note: "n" },
      { op: "addObject", type: "Lamp", name: "Full_B", note: "n" },
    ]);

    const added = boxes().slice(before);
    expect(new Set(added.map((b) => `${b.left},${b.top}`)).size).toBe(2);
    const view = screenOf().Children[0];
    for (const b of added) {
      expect(b.left + b.width).toBeLessThanOrEqual(view.Width);
      expect(b.top + b.height).toBeLessThanOrEqual(view.Height);
    }
  });

  it("cannot shift a full-width object sideways, because that would clip it", () => {
    const view = screenOf().Children[0];
    const banner = parts().find((p) => p.Width === view.Width)!;
    applyOps([{ op: "moveObject", target: banner.Name, left: 300, top: 0, note: "n" }]);
    const moved = parts().find((p) => p.UniqueId === banner.UniqueId)!;
    expect(moved.Location.Left).toBe(0);
  });

  it("keeps an object the model placed off the panel where it can be seen", () => {
    // SVG clips anything outside the ViewBox, so top: 900 on a 600-high panel
    // is an object that exists, binds, and is invisible.
    const view = screenOf().Children[0];
    applyOps([
      { op: "addObject", type: "Rectangle", name: "Off_Panel", left: 2000, top: 900, note: "n" },
    ]);

    const placed = boxes().at(-1)!;
    expect(placed.left + placed.width).toBeLessThanOrEqual(view.Width);
    expect(placed.top + placed.height).toBeLessThanOrEqual(view.Height);
  });

  it("respects a position the model did give, because overlap is often the point", () => {
    // A label on the panel rectangle behind it is correct, not a mistake.
    applyOps([
      { op: "addObject", type: "TextBox", name: "Lbl_On_Panel", left: 40, top: 96, text: "STATUS", note: "n" },
    ]);
    const placed = boxes().at(-1)!;
    expect(placed.left).toBe(40);
    expect(placed.top).toBe(96);
  });

  it("clamps a move that would push an object off the screen", () => {
    const view = screenOf().Children[0];
    const target = screenOf().Children[0].Children[0];
    applyOps([{ op: "moveObject", target: target.Name, left: 5000, top: 5000, note: "n" }]);

    const moved = screenOf().Children[0].Children.find((p) => p.UniqueId === target.UniqueId)!;
    expect(moved.Location.Left + moved.Width).toBeLessThanOrEqual(view.Width);
    expect(moved.Location.Top + moved.Height).toBeLessThanOrEqual(view.Height);
  });
});

describe("naming an object the request did not name", () => {
  beforeEach(seed);

  it("binds to what the batch just created, whatever it ended up called", () => {
    // A model that omits `name` on addObject still has to bind to the thing it
    // just added, and refers to it by a name it made up - Lamp_1. The real name
    // depends on what is already on the screen, which it cannot predict. The
    // bind used to resolve to nothing and the object came out unbound.
    const tag = useProject.getState().variables.find((v) => v.DataType === "BOOL")!;
    const { problems } = applyOps([
      { op: "addObject", type: "Lamp", note: "added the standby lamp" },
      { op: "bindTag", target: "Lamp_1", tag: tag.Name, note: "bound it" },
    ]);

    expect(problems).toEqual([]);
    const bindings = useProject.getState().bindings;
    expect(bindings).toHaveLength(1);
    // Bound to the object that actually landed, not to the invented name.
    const lamp = parts().at(-1)!;
    expect(bindings[0].targetId).toBe(lamp.UniqueId);
  });

  it("will not guess when the batch created two of the same type", () => {
    // Two lamps and a bind to "Lamp_1" is genuinely ambiguous, and binding the
    // wrong one silently is worse than saying so.
    const tag = useProject.getState().variables.find((v) => v.DataType === "BOOL")!;
    const { problems } = applyOps([
      { op: "addObject", type: "Lamp", note: "n" },
      { op: "addObject", type: "Lamp", note: "n" },
      { op: "bindTag", target: "Lamp_1", tag: tag.Name, note: "n" },
    ]);
    expect(problems[0]).toContain("Lamp_1");
    expect(useProject.getState().bindings).toHaveLength(0);
  });

  it("gives an unnamed object a name carrying its type", () => {
    applyOps([{ op: "addObject", type: "NumericDisplay", note: "n" }]);
    expect(parts().at(-1)!.Name).toMatch(/^NumericDisplay_\d+$/);
  });
});
