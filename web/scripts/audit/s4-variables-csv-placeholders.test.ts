/**
 * S4: Variables.csv exports placeholder tags that the .eote leaves out.
 *
 * useExport (src/components/export/useExport.ts:129-131) writes variablesCsv(s.variables)
 * unconditionally. The .eote goes through packageInputOf (lib/collab/package.ts:19),
 * which drops every variable while tagImport.pending is true (a screens-first project
 * built from a brief). The README written into the same zip says the CSV "is a copy of
 * what is already inside the .eote" (useExport.ts:85-87). An engineer who loads that CSV
 * into Control Expert or a SCADA gets invented tag names.
 */
import { describe, expect, it } from "vitest";
import { variablesCsv } from "@/components/export/variablesCsv";
import { packageInputOf } from "@/lib/collab/package";

describe("a screens-first project's export", () => {
  it("writes the same variables into the CSV as into the .eote", () => {
    const placeholder = { Name: "PMP_101_RUN", DataType: "BOOL", Comments: "Pump 1 running", DeviceAddress: "" };
    const doc = {
      name: "Brief",
      target: { model: "X", width: 800, height: 480 },
      screens: [],
      variables: [placeholder],
      alarms: [],
      bindings: [],
      tagImport: { fileName: "brief", at: 0, corrections: [], skipped: [], summary: { total: 1 }, pending: true },
    };
    const inEote = (packageInputOf(doc as never) as unknown as { variables: unknown[] }).variables.length;
    const inCsv = variablesCsv(doc.variables as never).trim().split(/\r\n/).length - 1;
    expect(inEote).toBe(0);
    expect(inCsv, `the CSV carries ${inCsv} placeholder tag(s) the .eote does not`).toBe(inEote);
  });
});
