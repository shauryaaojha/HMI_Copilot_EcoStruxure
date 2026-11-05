import { describe, expect, it } from "vitest";
import { snapPositionDelta } from "@/store/edits";

describe("grid drag", () => {
  it("snaps the resulting position even when the part starts off-grid", () => {
    expect(snapPositionDelta(5, 2, 4)).toBe(3);
    expect(snapPositionDelta(5, 0, 4)).toBe(-1);
    expect(snapPositionDelta(1.5, 2, 4)).toBe(2.5);
  });
});
