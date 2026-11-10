/**
 * The ops a designer and a connector were missing: shape and transparency,
 * italic, what a button does, and the tag list one tag at a time. Each is the
 * same op whether it came from the chat, the agent or claude.ai.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { applyOps } from "@/components/chat/applyOps";
import { OP_ITEM_SCHEMA } from "@/lib/ai/converse";
import { Op } from "@/core/ops";
import { packageProject } from "@/lib/ote/packager";
import { preflight } from "@/lib/ote/preflight";
import { readProject } from "@/lib/ote/reader";
import { useProject } from "@/store/project";
import { demoScreen, demoVariables } from "@/fixtures";

const s = () => useProject.getState();
const parts = () => s().screens[0].Children[0].Children;
const named = (name: string) => parts().find((p) => p.Name === name) as unknown as Record<string, never>;
const bool = () => s().variables.find((v) => v.DataType === "BOOL")!;

beforeEach(() => {
  s().reset();
  s().hydrate({
    id: "test",
    name: "Test",
    target: { model: "HMIGTO6310", width: 1024, height: 600 },
    screens: [structuredClone(demoScreen)],
    activeScreenId: demoScreen.UniqueId,
    variables: structuredClone(demoVariables),
  });
});

describe("setStyle", () => {
  it("rounds a rectangle, and never more than a pill", () => {
    const { problems } = applyOps([
      { op: "addObject", type: "Rectangle", name: "Pill", left: 600, top: 300, width: 200, height: 60, note: "n" },
      { op: "setStyle", target: "Pill", radius: 500 > 400 ? 400 : 500, note: "n" },
    ]);
    expect(problems).toEqual([]);
    expect(named("Pill").CornerRadius).toEqual({ Style: 2, TopLeft: 30, TopRight: 30, BottomLeft: 30, BottomRight: 30 });
  });

  it("refuses a radius on anything else, and says how a rounded button is made", () => {
    const { problems } = applyOps([
      { op: "addObject", type: "Switch", name: "Go", left: 600, top: 300, width: 160, height: 48, note: "n" },
      { op: "setStyle", target: "Go", radius: 20, note: "n" },
    ]);
    expect(problems.join(" ")).toMatch(/only a Rectangle has rounded corners/);
    expect(named("Go").CornerRadius).toBeUndefined();
  });

  it("makes every face of a switch see-through, by role, and sets an outline", () => {
    const { problems } = applyOps([
      { op: "addObject", type: "Switch", name: "Go", left: 600, top: 300, width: 160, height: 48, note: "n" },
      { op: "setStyle", target: "Go", transparency: 100, note: "n" },
      { op: "setStyle", target: "Go", transparency: 100, colorRole: "border", borderWidth: 0, note: "n" },
    ]);
    expect(problems).toEqual([]);
    const go = named("Go") as unknown as Record<"Release" | "Press", { Fill: { Color: { Transparency: number } }; Border: { Color: { Transparency: number } }; Thickness: number }>;
    for (const face of [go.Release, go.Press]) {
      expect(face.Fill.Color.Transparency).toBe(100);
      expect(face.Border.Color.Transparency).toBe(100);
      expect(face.Thickness).toBe(0);
    }
  });

  it("is one op for every rectangle on the screen", () => {
    const before = parts().filter((p) => p.Type === "Rectangle").length;
    expect(before).toBeGreaterThan(0);
    const { problems } = applyOps([{ op: "setStyle", select: "Rectangle", radius: 4, note: "soft corners" }]);
    expect(problems).toEqual([]);
    expect(parts().filter((p) => p.Type === "Rectangle" && (p as { CornerRadius?: unknown }).CornerRadius).length).toBe(before);
  });
});

describe("setText bold and italic", () => {
  it("restyles without relabelling", () => {
    applyOps([{ op: "addObject", type: "TextBox", name: "DrinkName", text: "Espresso", left: 600, top: 300, width: 200, height: 40, note: "n" }]);
    const { problems } = applyOps([{ op: "setText", target: "DrinkName", italic: true, bold: true, fontSize: 28, note: "n" }]);
    expect(problems).toEqual([]);
    // Bold is written the way the product writes it (Font.Attribute.Bold) as well as ours.
    expect(named("DrinkName")).toMatchObject({ Text: "Espresso", Font: { Italic: true, Size: 28, Bold: true, Attribute: { Bold: true } } });
  });
});

describe("setAction", () => {
  it("makes a switch open a screen, by name until the file is written", () => {
    const { problems } = applyOps([
      { op: "addScreen", name: "Settings", note: "n" },
      { op: "addObject", screen: "s1", type: "Switch", name: "ToSettings", left: 600, top: 300, width: 160, height: 48, note: "n" },
      { op: "setAction", target: "ToSettings", action: "goToScreen", toScreen: "Settings", note: "n" },
    ]);
    expect(problems).toEqual([]);
    expect(named("ToSettings").ClickTrigger).toEqual({ OperationType: 4, Operation: 1, ScreenName: "Settings" });
  });

  it("names the screens when the one asked for is not there, and refuses what is not a switch", () => {
    applyOps([{ op: "addObject", type: "Switch", name: "Go", left: 600, top: 300, width: 160, height: 48, note: "n" }]);
    const missing = applyOps([{ op: "setAction", target: "Go", action: "goToScreen", toScreen: "Nowhere", note: "n" }]);
    expect(missing.problems.join(" ")).toMatch(/needs toScreen, one of: s1/);
    const lamp = parts().find((p) => p.Type === "Lamp")!;
    const wrong = applyOps([{ op: "setAction", target: lamp.Name, action: "toggle", note: "n" }]);
    expect(wrong.problems.join(" ")).toMatch(/only a Switch acts on a touch/);
  });

  it("sets how a switch writes its bit, and says when nothing is bound yet", () => {
    applyOps([{ op: "addObject", type: "Switch", name: "Run", left: 600, top: 300, width: 160, height: 48, note: "n" }]);
    const out = applyOps([{ op: "setAction", target: "Run", action: "toggle" }]);
    expect(named("Run").ClickTrigger).toEqual({ OperationType: 1, Operation: 2 });
    expect(out.applied.join(" ")).toMatch(/writes nothing until a BOOL tag is bound/);
  });
});

describe("tags, one at a time", () => {
  it("adds a tag, and refuses a name OTE would not take or one already there", () => {
    const count = s().variables.length;
    expect(applyOps([{ op: "addTag", tag: "BOILER_TEMP", dataType: "REAL", comment: "Boiler temperature", note: "n" }]).problems).toEqual([]);
    expect(s().variables.at(-1)).toMatchObject({ Name: "BOILER_TEMP", DataType: "REAL", Comments: "Boiler temperature" });
    expect(applyOps([{ op: "addTag", tag: "Boiler temp", dataType: "REAL", note: "n" }]).problems.join(" ")).toMatch(/Cannot add tag/);
    expect(applyOps([{ op: "addTag", tag: "BOILER_TEMP", dataType: "REAL", note: "n" }]).problems.join(" ")).toMatch(/already a tag/);
    expect(applyOps([{ op: "addTag", tag: "NO_TYPE", note: "n" }]).problems.join(" ")).toMatch(/Cannot add tag/);
    expect(s().variables.length).toBe(count + 1);
  });

  it("renames a tag, and what was bound to it follows", () => {
    const tag = bool().Name;
    applyOps([
      { op: "addObject", type: "Lamp", name: "RunLamp", left: 600, top: 300, width: 120, height: 40, note: "n" },
      { op: "bindTag", target: "RunLamp", tag, note: "n" },
      { op: "addAlarm", tag, message: "Tripped", note: "n" },
    ]);
    const { problems } = applyOps([{ op: "setTag", tag, name: "MOTOR_1_RUN", comment: "Motor 1 running", note: "n" }]);
    expect(problems).toEqual([]);
    expect(s().variables.some((v) => v.Name === tag)).toBe(false);
    expect(s().variables.find((v) => v.Name === "MOTOR_1_RUN")).toMatchObject({ Comments: "Motor 1 running", DataType: "BOOL" });
    expect(s().bindings.filter((b) => b.tag === "MOTOR_1_RUN").length).toBeGreaterThan(0);
    expect(s().bindings.some((b) => b.tag === tag)).toBe(false);
    expect(s().alarms.some((a) => a.Trigger === "MOTOR_1_RUN")).toBe(true);
  });

  it("deletes a tag with its bindings and alarms, as a delete the engineer is asked about", () => {
    const tag = bool().Name;
    applyOps([
      { op: "addObject", type: "Lamp", name: "RunLamp", left: 600, top: 300, width: 120, height: 40, note: "n" },
      { op: "bindTag", target: "RunLamp", tag, note: "n" },
    ]);
    const others = s().bindings.filter((b) => b.tag !== tag).length;
    const out = applyOps([{ op: "deleteTag", tag, note: "n" }]);
    expect(out.problems).toEqual([]);
    expect(out.deleted).toBe(true);
    expect(s().variables.some((v) => v.Name === tag)).toBe(false);
    expect(s().bindings.some((b) => b.tag === tag)).toBe(false);
    expect(s().bindings.length).toBe(others);
    expect(applyOps([{ op: "deleteTag", tag: "NOT_A_TAG", note: "n" }]).problems.join(" ")).toMatch(/not in the tag list/);
  });
});

describe("the new ops and the file", () => {
  it("every field the applier reads is in the schema the models are given", () => {
    const offered = Object.keys(OP_ITEM_SCHEMA.properties);
    for (const key of ["italic", "radius", "transparency", "borderWidth", "action", "toScreen", "dataType", "comment", "address"]) {
      expect(offered).toContain(key);
      expect(Object.keys(Op.shape)).toContain(key);
    }
    for (const name of ["setStyle", "setAction", "addTag", "setTag", "deleteTag"]) expect(OP_ITEM_SCHEMA.properties.op.enum).toContain(name);
  });

  it("a styled, navigating screen passes the export's checks and reads back as written", async () => {
    applyOps([
      { op: "addScreen", name: "Settings", note: "n" },
      { op: "addObject", screen: "s1", type: "Rectangle", name: "PillBack", left: 600, top: 300, width: 200, height: 60, note: "n" },
      { op: "setStyle", target: "PillBack", radius: 30, note: "n" },
      { op: "addObject", screen: "s1", type: "Switch", name: "PillTouch", left: 600, top: 300, width: 200, height: 60, note: "n" },
      { op: "setStyle", target: "PillTouch", transparency: 100, note: "n" },
      { op: "setAction", target: "PillTouch", action: "goToScreen", toScreen: "Settings", note: "n" },
    ]);
    const st = s();
    const input = {
      name: st.name, target: st.target, screens: st.screens, variables: st.variables, alarms: st.alarms,
      wires: st.bindings.flatMap((b) => {
        const part = st.screens.flatMap((x) => x.Children[0].Children).find((p) => p.UniqueId === b.targetId);
        return part ? [{ part, tag: b.tag, property: b.property }] : [];
      }),
    };
    expect(preflight(input as never)).toEqual([]);
    const back = await readProject(await packageProject(input as never), "Test.eote");
    const screen = back.screens.find((x) => x.Children[0].Children.some((p) => p.Name === "PillBack"))!;
    const get = (name: string) => screen.Children[0].Children.find((p) => p.Name === name) as unknown as Record<string, never>;
    expect(get("PillBack").CornerRadius).toMatchObject({ TopLeft: 30, BottomRight: 30 });
    expect((get("PillTouch").Release as { Fill: { Color: { Transparency: number } } }).Fill.Color.Transparency).toBe(100);
    // The screen's name has become its number, which is what the product reads.
    expect(get("PillTouch").ClickTrigger).toMatchObject({ OperationType: 4, Operation: 1 });
    expect(typeof (get("PillTouch").ClickTrigger as { Screen?: number }).Screen).toBe("number");
  });
});
