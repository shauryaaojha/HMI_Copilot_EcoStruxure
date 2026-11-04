/**
 * S3-06 (docs/audit/BUGS.md), moved from web/scripts/audit/ with the fix: a brief
 * row's count had no ceiling, so MCP generate accepted 10,000,000 pumps and
 * tagsFromBrief built 800,000 tags for 200,000 of them in one synchronous call.
 */
import { describe, expect, it } from "vitest";
import { Brief, MAX_UNIT_COUNT, problemsWith, tagsFromBrief } from "@/lib/brief/brief";

const brief = (count: number) => Brief.parse({ units: [{ id: "u1", kind: "pump", label: "Pump", count, signals: ["RUN", "FLT", "START", "STOP"] }] });

describe("S3-06 brief counts are bounded", () => {
  it("a count of ten million is a problem the gate names", () => {
    const problems = problemsWith(brief(10_000_000));
    expect(problems.map((p) => p.field), "problemsWith accepts count 10,000,000 - the MCP generate gate lets it through").toContain("count");
  });

  it("tagsFromBrief refuses a row over the ceiling instead of building it", () => {
    expect(() => tagsFromBrief(brief(200_000))).toThrow(/at most/);
  });

  it("the ceiling itself still builds", () => {
    expect(problemsWith(brief(MAX_UNIT_COUNT))).toEqual([]);
    expect(tagsFromBrief(brief(MAX_UNIT_COUNT)).variables.length).toBe(MAX_UNIT_COUNT * 4);
  });
});
