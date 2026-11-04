/**
 * S3-06: a brief sent straight to MCP `generate` has no ceiling on a unit's count.
 *
 * The model path and the rules path both cap a count at 20 (lib/brief/draft.ts MAX_COUNT).
 * A brief passed as the `brief` argument of the MCP `generate` tool (lib/mcp/generate.ts:103,
 * `count: z.number().int().optional()`) goes through Brief.parse and problemsWith
 * (lib/brief/brief.ts:106), and neither has an upper bound. The job then calls
 * tagsFromBrief, which builds count x signals variables in memory before the
 * MAX_BUILD_OPS check (generate.ts:289). That check runs only after the pipeline, so after the
 * model call has been paid for.
 */
import { describe, expect, it } from "vitest";
import { Brief, problemsWith, tagsFromBrief } from "@/lib/brief/brief";

const brief = (count: number) => Brief.parse({ units: [{ id: "u1", kind: "pump", label: "Pump", count, signals: ["RUN", "FLT", "START", "STOP"] }] });

describe("S3-06 brief counts are bounded", () => {
  it("a count of ten million is a problem the gate names", () => {
    const problems = problemsWith(brief(10_000_000));
    expect(problems.length, "problemsWith accepts count 10,000,000 - the MCP generate gate lets it through").toBeGreaterThan(0);
  });

  it("measured: what one confirmed row costs before any ceiling applies", () => {
    const t = performance.now();
    const n = tagsFromBrief(brief(200_000)).variables.length;
    const ms = Math.round(performance.now() - t);
    // 200k pumps x 4 signals = 800k tags in one synchronous call; 10M would be 40M objects.
    console.log(`tagsFromBrief(count 200000): ${n} variables in ${ms} ms`);
    expect(n, `count 200000 produced ${n} placeholder tags in ${ms} ms with no refusal`).toBeLessThanOrEqual(20 * 4);
  });
});
