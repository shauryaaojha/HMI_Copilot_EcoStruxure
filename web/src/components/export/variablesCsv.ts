/**
 * The variable list as a CSV that OTE, and our own importer, can read back.
 *
 * The column names are the Variable field names from lib/ote/schema.ts rather
 * than prettier labels, so a file exported here and re-imported through
 * /api/tags/parse comes back identical. A round trip that loses the comments
 * column is the kind of thing nobody notices until a handover.
 *
 * Phase 7 of docs/BUILD_PLAN.md.
 */

import type { Variable } from "@/lib/ote/schema";

const COLUMNS = ["Name", "DataType", "Comments", "DeviceAddress"] as const;

/** RFC 4180: quote anything containing a comma, quote or newline. */
function cell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function variablesCsv(variables: Variable[]): string {
  const rows = variables.map((variable) =>
    COLUMNS.map((column) => cell(String(variable[column] ?? ""))).join(","),
  );
  // A trailing newline, because a file without one is a diff nobody wanted.
  return [COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}
