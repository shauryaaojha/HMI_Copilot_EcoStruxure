/**
 * What the first recorded sessions found. docs/PLAN_PHASE2.md item 3.
 *
 * Two turns of a real Gemini session against the full demo screen:
 *   - "add a lamp ... in the header" was refused, because a lamp's default
 *     size is the body's 180x64 and the header is 44 high;
 *   - "make the flow reading bold" came back as a resizeObject with no size,
 *     which did nothing and was reported as done.
 * Both are the applier's fault, not the model's, and both are held here.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { applyOps } from "@/components/chat/applyOps";
import { fitTo } from "@/lib/ote/regions";
import { useProject } from "@/store/project";
import { demoScreen, demoVariables } from "@/fixtures";

const s = () => useProject.getState();
const parts = () => s().screens[0].Children[0].Children;

beforeEach(() => {
  s().reset();
  s().hydrate({
    id: "rf",
    name: "Recorded findings",
    target: { model: "HMIGTO6310", width: 1024, height: 600 },
    screens: [structuredClone(demoScreen)],
    activeScreenId: demoScreen.UniqueId,
    variables: structuredClone(demoVariables),
  });
});

describe("a part asked for in a region takes the region's size", () => {
  it("shrinks a body-sized lamp to the header, keeping its proportion", () => {
    const fitted = fitTo({ width: 180, height: 64 }, { left: 0, top: 0, width: 1024, height: 44 });
    expect(fitted.height).toBeLessThanOrEqual(44 - 8);
    expect(fitted.width).toBeLessThan(180);
    expect(fitted.width).toBeGreaterThanOrEqual(60);
  });

  it("leaves a part that already fits alone", () => {
    expect(fitTo({ width: 120, height: 24 }, { left: 0, top: 0, width: 1024, height: 44 })).toEqual({ width: 120, height: 24 });
  });

  it("lands a lamp in the full demo screen's header on the first try", () => {
    const before = parts().length;
    const { problems, applied } = applyOps([
      { op: "addObject", type: "Lamp", place: { region: "header" }, tag: "PMP_102_RUN", onText: "STANDBY", note: "n" },
    ]);
    expect(problems).toEqual([]);
    expect(applied).toHaveLength(1);
    const lamp = parts().at(-1)!;
    expect(parts().length).toBe(before + 1);
    expect(lamp.Location.Top + lamp.Height).toBeLessThanOrEqual(44);
    expect(lamp.Type === "Lamp" && lamp.On.Text).toBe("STANDBY");
  });
});

describe("an op that would do nothing is refused, not reported as done", () => {
  const flow = () => parts().find((p) => p.Name === "Num_Flow")!;

  it("resizeObject without a size", () => {
    const { problems, applied } = applyOps([{ op: "resizeObject", target: "Num_Flow", note: "made the flow reading bold" }]);
    expect(applied).toEqual([]);
    expect(problems.join(" ")).toMatch(/setText with bold/);
  });

  it("setText with nothing to set", () => {
    const { problems, applied } = applyOps([{ op: "setText", target: "Num_Flow", note: "n" }]);
    expect(applied).toEqual([]);
    expect(problems.join(" ")).toMatch(/no text, bold or fontSize/);
  });

  it("setText with bold restyles a numeric display", () => {
    const { problems } = applyOps([{ op: "setText", target: "Num_Flow", bold: true, fontSize: 24, note: "n" }]);
    expect(problems).toEqual([]);
    const after = flow();
    expect(after.Type === "NumericDisplay" && after.Font?.Bold).toBe(true);
    expect(after.Type === "NumericDisplay" && after.Font?.Size).toBe(24);
  });

  it("setText with bold restyles both faces of a lamp and keeps their text", () => {
    const lamp = parts().find((p) => p.Type === "Lamp")!;
    const texts = lamp.Type === "Lamp" ? [lamp.Off.Text, lamp.On.Text] : [];
    const { problems } = applyOps([{ op: "setText", target: lamp.Name, bold: true, note: "n" }]);
    expect(problems).toEqual([]);
    const after = parts().find((p) => p.UniqueId === lamp.UniqueId)!;
    if (after.Type === "Lamp") {
      expect(after.Off.Font?.Bold).toBe(true);
      expect(after.On.Font?.Bold).toBe(true);
      expect([after.Off.Text, after.On.Text]).toEqual(texts);
    }
  });

  it("setText with text on a numeric display is refused: its text is the tag's", () => {
    const { problems } = applyOps([{ op: "setText", target: "Num_Flow", text: "12", note: "n" }]);
    expect(problems.join(" ")).toMatch(/comes from the bound tag/);
  });
});
