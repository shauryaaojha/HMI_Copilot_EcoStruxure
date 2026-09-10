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
    const target = parts()[0];
    applyOps([{ op: "moveObject", target: target.Name, left: 33, top: 44, note: "n" }]);
    expect(parts()[0].Location).toEqual({ Left: 33, Top: 44 });
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
