/**
 * Guards the contract both workstreams build against.
 *
 * The fixtures are lifted out of the .eote that opens in OTE, so if they stop
 * parsing through the schema, either the generator or the schema has drifted -
 * and the canvas is about to start rendering something the packager cannot emit.
 */

import { describe, expect, it } from "vitest";
import { Screen } from "@/lib/ote/schema";
import { toPathData, boundsOf } from "@/lib/ote/graphics";
import screenJson from "@/fixtures/pump-station.screen.json";

describe("fixtures", () => {
  it("the demo screen parses through the real schema", () => {
    const screen = Screen.parse(screenJson);
    expect(screen.Name).toBe("PumpStation1");
    expect(screen.Children[0].Children).toHaveLength(19);
  });

  it("every part type in the fixture has a schema case", () => {
    const screen = Screen.parse(screenJson);
    const types = new Set(screen.Children[0].Children.map((p) => p.Type));
    expect([...types].sort()).toEqual([
      "AlarmSummary",
      "Lamp",
      "NumericDisplay",
      "Rectangle",
      "TextBox",
    ]);
  });
});

describe("graphics", () => {
  it("zips commands and points into SVG path data", () => {
    const raw = {
      Name: "T",
      Commands: "MLLLz",
      Points: "0,0,10,0,10,10,0,10",
    };
    expect(toPathData(raw)).toBe("M 0,0 L 10,0 L 10,10 L 0,10 Z");
    expect(boundsOf(raw)).toEqual({ width: 10, height: 10 });
  });

  it("consumes three points for a cubic bezier", () => {
    const raw = { Name: "C", Commands: "MC", Points: "0,0,1,1,2,2,3,3" };
    expect(toPathData(raw)).toBe("M 0,0 C 1,1 2,2 3,3");
  });

  it("refuses to guess when commands and points disagree", () => {
    expect(() =>
      toPathData({ Name: "bad", Commands: "ML", Points: "0,0" }),
    ).toThrow(/exhausted/);
    expect(() =>
      toPathData({ Name: "bad", Commands: "M", Points: "0,0,1,1" }),
    ).toThrow(/unused/);
  });
});
