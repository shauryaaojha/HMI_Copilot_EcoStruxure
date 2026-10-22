/**
 * A part's Fill must survive parsing exactly as the product wrote it. A key the
 * schema does not model is stripped on the fresh write path, and a typed paint
 * that matched the solid-colour option lost its type and gradient stops; OTE then
 * shows the Fill as "Unset". scripts/fill-audit.mts checks this against the
 * shipped projects; these tests pin each form.
 */
import { describe, expect, it } from "vitest";
import { Paint, Part } from "@/lib/ote/schema";

const base = { UniqueId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", Name: "Part1", Location: { Left: 0, Top: 0 }, Width: 100, Height: 40 };

describe("Paint keeps every form the product writes", () => {
  it("keeps a solid palette colour", () => {
    expect(Paint.parse({ Color: { Value: 33 } })).toEqual({ Color: { Value: 33 } });
  });

  it("keeps a typed paint with a Color and its Type", () => {
    const fill = { Type: 1, Color: { Value: 31, Transparency: 90 } };
    expect(Paint.parse(fill)).toEqual(fill);
  });

  it("keeps a gradient whole, with Color1, Color2 and Speed", () => {
    const gradient = {
      Type: 5,
      Speed: 4,
      Color: { Value: 5, Transparency: 100 },
      Color1: { Value: 5, Transparency: 100 },
      Color2: { Value: 15, Transparency: 100 },
    };
    expect(Paint.parse(gradient)).toEqual(gradient);
  });

  it("keeps a linear gradient written as stops", () => {
    const linear = {
      Type: 4,
      Angle: 270,
      ColorStops: [{ Color: { Value: 46, Transparency: 25 } }, { Color: { Value: 36, Transparency: 25 } }],
    };
    expect(Paint.parse(linear)).toEqual(linear);
  });

  it("keeps a packed colour", () => {
    const packed = { Color: { ColorIndexEnabled: false, Value: 929113 } };
    expect(Paint.parse(packed)).toEqual(packed);
  });

  it("still refuses a solid colour outside the colour set", () => {
    expect(Paint.safeParse({ Color: { Value: 99 } }).success).toBe(false);
    expect(Paint.safeParse({ Type: 1, Color: { Value: 99 } }).success).toBe(false);
  });
});

describe("parts that carry a Fill keep it", () => {
  it("keeps a TextBox's Fill", () => {
    const part = { Type: "TextBox", ...base, Text: "Run", Fill: { Type: 1, Color: { Value: 31, Transparency: 90 } } };
    expect(Part.parse(part)).toMatchObject({ Fill: { Type: 1, Color: { Value: 31, Transparency: 90 } } });
  });

  it("keeps an AlarmSummary's Fill", () => {
    const part = { Type: "AlarmSummary", ...base, Fill: { Color: { ColorIndexEnabled: false, Value: 929113 } } };
    expect(Part.parse(part)).toMatchObject({ Fill: { Color: { ColorIndexEnabled: false, Value: 929113 } } });
  });

  it("keeps a NumericDisplay's gradient", () => {
    const fill = { Type: 5, Speed: 1, Color: { Value: 5 }, Color1: { Value: 5 }, Color2: { Value: 15 } };
    expect(Part.parse({ Type: "NumericDisplay", ...base, CurrentValue: 0, Fill: fill })).toMatchObject({ Fill: fill });
  });
});
