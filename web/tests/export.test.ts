/**
 * Phase 7: what the export writes.
 *
 * The .eote itself is FORMAT's gate (tests/packager.test.ts, which skips here -
 * it needs a skeleton from a licensed installation). What is testable on this
 * side is the payload the UI builds and the CSV it writes, and the CSV is worth
 * testing properly because it round-trips through our own importer: a file that
 * exports cleanly and re-imports wrong is the kind of thing nobody notices
 * until a handover.
 */

import { describe, expect, it } from "vitest";
import { variablesCsv } from "@/components/export/variablesCsv";
import { parseTags } from "@/lib/tags/parse";
import { demoVariables } from "@/fixtures";
import type { Variable } from "@/lib/ote/schema";

const encode = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe("the variables CSV", () => {
  it("writes a header and one row per variable", () => {
    const csv = variablesCsv(demoVariables);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe("Name,DataType,Comments,DeviceAddress");
    expect(lines).toHaveLength(demoVariables.length + 1);
  });

  it("round-trips through our own importer without losing a field", () => {
    const csv = variablesCsv(demoVariables);
    const back = parseTags(encode(csv), "Variables.csv");

    expect(back.corrections).toEqual([]);
    expect(back.skipped).toEqual([]);
    expect(back.variables).toEqual(demoVariables);
  });

  it("quotes a comment containing a comma rather than splitting the row", () => {
    const awkward: Variable[] = [
      {
        Name: "LT_101_PV",
        DataType: "REAL",
        Comments: 'Tank level, "wet well", high',
        DeviceAddress: "%MD14",
      },
    ];
    const csv = variablesCsv(awkward);
    expect(csv).toContain('"Tank level, ""wet well"", high"');

    const back = parseTags(encode(csv), "Variables.csv");
    expect(back.variables).toEqual(awkward);
  });

  it("handles a project with no tags at all", () => {
    expect(variablesCsv([])).toBe("Name,DataType,Comments,DeviceAddress\r\n");
  });
});
