/**
 * S4-06 (docs/audit/BUGS.md), moved from web/scripts/audit/ with the fix: a
 * screens-first project's Variables.csv listed every placeholder tag, while
 * the .eote beside it carries none until the real tags arrive. The export
 * now writes the CSV from packageInput(), the same input the .eote is built
 * from (exportedVariablesCsv in useExport.ts).
 */
import { describe, expect, it } from "vitest";
import { exportedVariablesCsv } from "@/components/export/useExport";

const doc = (pending: boolean) => ({
  name: "Brief",
  target: { model: "X", width: 800, height: 480 },
  screens: [],
  variables: [{ Name: "PMP_101_RUN", DataType: "BOOL", Comments: "Pump 1 running", DeviceAddress: "" }],
  alarms: [],
  bindings: [],
  tagImport: { fileName: "brief", at: 0, corrections: [], skipped: [], summary: { total: 1 }, pending },
});
const rows = (csv: string) => csv.trim().split(/\r\n/).length - 1;

describe("a screens-first project's export", () => {
  it("writes no placeholder tags into the CSV, as into the .eote", () => {
    expect(rows(exportedVariablesCsv(doc(true) as never))).toBe(0);
  });
  it("writes the real tags once they arrive", () => {
    expect(rows(exportedVariablesCsv(doc(false) as never))).toBe(1);
  });
});
