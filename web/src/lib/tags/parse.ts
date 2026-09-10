/**
 * PLC tag export -> normalised variables.
 *
 * Handles the three things an engineer actually has to hand: an OTE variable
 * export (.csv / .txt, UTF-8 without BOM), a spreadsheet (.xlsx), and a generic
 * tag list from somewhere else. Column names vary between all of them, so the
 * header is matched by intent rather than by position.
 *
 * Corrections are reported, never applied silently. An import that quietly drops
 * a bad row is the behaviour we are trying to replace.
 *
 * Phase 3 of docs/BUILD_PLAN.md.
 */

import * as XLSX from "xlsx";
import { DATA_TYPES, type Variable } from "@/lib/ote/schema";
import { normaliseNames, type Correction } from "@/lib/validation/naming";

type DataType = (typeof DATA_TYPES)[number];

/** Header aliases, lowercased and stripped of non-alphanumerics. */
const COLUMNS: Record<keyof ParsedRow, string[]> = {
  name: ["name", "tagname", "symbol", "symbolname", "variable", "variablename", "tag", "identifier"],
  dataType: ["datatype", "type", "iectype", "vartype", "datatypename"],
  comment: ["comment", "comments", "description", "desc", "remark", "note"],
  address: ["address", "deviceaddress", "plcaddress", "location", "register"],
};

interface ParsedRow {
  name: string;
  dataType: string;
  comment: string;
  address: string;
}

export interface ParseResult {
  variables: Variable[];
  corrections: Correction[];
  /** Rows that could not be salvaged at all, with why. */
  skipped: { row: number; value: string; reason: string }[];
  summary: { total: number } & Partial<Record<DataType, number>>;
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Maps PLC-world type spellings onto the IEC types OTE supports. Anything
 * unrecognised becomes a REAL if it looks numeric, else a STRING - and the row
 * is reported so the engineer can correct it.
 */
const TYPE_ALIASES: Record<string, DataType> = {
  bool: "BOOL", bit: "BOOL", boolean: "BOOL", ebool: "BOOL", digital: "BOOL",
  int: "INT", int16: "INT", short: "INT", integer: "INT",
  dint: "DINT", int32: "DINT", long: "DINT", "double integer": "DINT",
  uint: "UINT", uint16: "UINT", word: "WORD",
  udint: "UDINT", uint32: "UDINT", dword: "DWORD",
  real: "REAL", float: "REAL", float32: "REAL", analog: "REAL", single: "REAL",
  lreal: "LREAL", double: "LREAL", float64: "LREAL",
  string: "STRING", str: "STRING", text: "STRING", char: "STRING",
};

export function normaliseDataType(raw: string): DataType | null {
  const cleaned = raw.trim().toLowerCase();
  if (cleaned.length === 0) return null;
  const direct = DATA_TYPES.find((t) => t.toLowerCase() === cleaned);
  if (direct) return direct;
  return TYPE_ALIASES[cleaned] ?? TYPE_ALIASES[key(cleaned)] ?? null;
}

/** Finds which spreadsheet column holds which field. */
function mapHeader(header: string[]): Partial<Record<keyof ParsedRow, number>> {
  const mapping: Partial<Record<keyof ParsedRow, number>> = {};
  header.forEach((cell, index) => {
    const k = key(String(cell ?? ""));
    for (const [field, aliases] of Object.entries(COLUMNS) as [keyof ParsedRow, string[]][]) {
      if (mapping[field] === undefined && aliases.includes(k)) mapping[field] = index;
    }
  });
  return mapping;
}

/**
 * A file with no recognisable header - a bare list of names, one per line, or
 * "NAME,TYPE,COMMENT" without a header row.
 */
function looksLikeHeader(row: unknown[]): boolean {
  const mapping = mapHeader(row.map((c) => String(c ?? "")));
  return mapping.name !== undefined;
}

/**
 * Accepts a view as well as a raw ArrayBuffer, and respects its bounds.
 *
 * Node's Buffer is a window onto a shared, pooled ArrayBuffer, so `buf.buffer`
 * hands over the whole pool - several KB of unrelated process memory - rather
 * than the file. Passing that to a parser produces convincing nonsense instead
 * of an error, so the bounds are honoured here rather than trusted to callers.
 */
function toBytes(input: ArrayBuffer | ArrayBufferView): Uint8Array {
  return ArrayBuffer.isView(input)
    ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    : new Uint8Array(input);
}

export function parseTags(
  file: ArrayBuffer | ArrayBufferView,
  filename = "",
): ParseResult {
  const book = XLSX.read(toBytes(file), { type: "array", raw: true });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) {
    return { variables: [], corrections: [], skipped: [], summary: { total: 0 } };
  }

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  if (grid.length === 0) {
    return { variables: [], corrections: [], skipped: [], summary: { total: 0 } };
  }

  const hasHeader = looksLikeHeader(grid[0]);
  const mapping = hasHeader
    ? mapHeader(grid[0].map((c) => String(c ?? "")))
    : { name: 0, dataType: 1, comment: 2, address: 3 };
  const body = hasHeader ? grid.slice(1) : grid;

  const cell = (row: unknown[], field: keyof ParsedRow): string => {
    const index = mapping[field];
    return index === undefined ? "" : String(row[index] ?? "").trim();
  };

  const rows: ParsedRow[] = [];
  const skipped: ParseResult["skipped"] = [];

  body.forEach((row, i) => {
    const name = cell(row, "name");
    if (name.length === 0) return; // blank line, not an error worth reporting

    const rawType = cell(row, "dataType");
    const dataType = normaliseDataType(rawType);
    if (!dataType && rawType.length > 0) {
      skipped.push({
        row: i + (hasHeader ? 2 : 1),
        value: `${name} (${rawType})`,
        reason: `unrecognised data type "${rawType}"`,
      });
      return;
    }

    rows.push({
      name,
      // A tag list with no type column is common; BOOL is the safe default
      // because a wrong BOOL is visible on screen, a wrong REAL is not.
      dataType: dataType ?? "BOOL",
      comment: cell(row, "comment"),
      address: cell(row, "address"),
    });
  });

  const { names, corrections } = normaliseNames(rows.map((r) => r.name));

  const variables: Variable[] = rows.map((r, i) => ({
    Name: names[i],
    DataType: r.dataType as DataType,
    Comments: r.comment,
    DeviceAddress: r.address,
  }));

  const summary: ParseResult["summary"] = { total: variables.length };
  for (const v of variables) {
    summary[v.DataType] = (summary[v.DataType] ?? 0) + 1;
  }

  void filename;
  return { variables, corrections, skipped, summary };
}
