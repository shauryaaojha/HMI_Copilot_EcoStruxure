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

import { DATA_TYPES, type Variable } from "@/lib/ote/schema";
import { readTable, readTextTable } from "./table";
import { normaliseNames, type Correction } from "@/lib/validation/naming";
import { parseControlExpert, type StructuredInstance } from "./controlExpert";
import { IngestError } from "@/lib/ingest/errors";
import { refuse, sniff } from "@/lib/ingest/sniff";

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
  /**
   * DDT instances, when the export carried its types (Control Expert XML).
   * Equipment declared by the PLC's type system rather than read off names.
   */
  structure?: StructuredInstance[];
  /** What the file was, as an engineer would say it. */
  source?: "control-expert" | "table";
  /** The tool that wrote it, when the file says. */
  producer?: string;
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
  string: "STRING", str: "STRING", text: "STRING", char: "STRING", wstring: "STRING",
  // IEC spellings Control Expert, Machine Expert and OTE's own export use.
  sint: "INT", usint: "UINT", byte: "WORD", int8: "INT", uint8: "UINT",
  time: "DINT", date: "UDINT", tod: "UDINT", dt: "UDINT",
};

export function normaliseDataType(raw: string): DataType | null {
  const cleaned = raw.trim().toLowerCase();
  if (cleaned.length === 0) return null;
  const direct = DATA_TYPES.find((t) => t.toLowerCase() === cleaned);
  if (direct) return direct;
  // STRING[32], WSTRING[16]: a sized string is still a string.
  if (/^w?string\s*\[\s*\d+\s*\]$/.test(cleaned)) return "STRING";
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
 * Where the header is. PLC and HMI exports often open with a preamble - OTE's
 * text export carries a `[FileVersion]` line, Excel exports a title row - so
 * the header is the first of the opening rows that names a tag column *and*
 * one other known column. A row that only says "Name" could be a title; one
 * that says Name and DataType is a header. Falls back to a lone name column in
 * the first row, and then to no header.
 */
function findHeader(grid: unknown[][]): number {
  const scan = Math.min(grid.length, 30);
  for (let i = 0; i < scan; i++) {
    const m = mapHeader(grid[i].map((c) => String(c ?? "")));
    if (m.name !== undefined && (m.dataType !== undefined || m.comment !== undefined || m.address !== undefined)) return i;
  }
  return grid.length > 0 && looksLikeHeader(grid[0]) ? 0 : -1;
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

/**
 * Any tag export: a spreadsheet or a text file. Async because a spreadsheet is
 * a ZIP that has to be inflated; the route and the picker use this.
 */
export async function parseTagsFile(
  file: ArrayBuffer | ArrayBufferView,
  filename = "",
): Promise<ParseResult> {
  const bytes = toBytes(file);
  const kind = await sniff(bytes, filename);
  const label = filename || "that file";
  switch (kind.kind) {
    case "control-expert-xml": {
      if (kind.root !== "VariablesExchangeFile" && kind.root !== "FEFExchangeFile" && kind.root !== "DDTExchangeFile") {
        // Program sections carry a dataBlock too, but only of their local
        // variables; reading one as the tag list would be a quiet half-import.
        throw new IngestError(
          "unsupported-format",
          `${label} is a Control Expert ${kind.root.replace(/ExchangeFile$/, "")} section export, not a variable export.`,
          "In Control Expert, export the variables (Data Editor > Export, .xsy) or the whole application (.xef), or the HMI variable file (.xvm).",
        );
      }
      const text = new TextDecoder("utf-8").decode(bytes);
      const r = parseControlExpert(text);
      return { ...r, source: "control-expert" };
    }
    case "ote-project":
    case "compound-object":
      throw new IngestError(
        "unsupported-format",
        `${label} is ${kind.kind === "ote-project" ? `an ${kind.product} project` : "an OTE compound object"}, not a tag list.`,
        kind.kind === "ote-project" ? "Use Open project to open it; its variables come with it." : "Compound objects are imported into the Library.",
      );
    case "vijeo-designer":
      throw refuse(kind, label)!;
    case "sqlite":
      throw new IngestError(
        "unsupported-format",
        `${label} is a SQLite database on its own. A project's Variables.db is only meaningful inside its project.`,
        "Open the whole .eote, or export the variables from Operator Terminal Expert as .csv or .xlsx.",
      );
    case "xml":
      throw new IngestError(
        "unknown-format",
        `${label} is XML with root <${kind.root}>, which is not a tag export HMI Copilot reads.`,
        "Supported XML: Control Expert variable exports (.xsy, .xvm, .xef).",
      );
    case "zip":
      throw new IngestError("unknown-format", `${label} is a ZIP archive but not a spreadsheet or a project.`);
    default:
      return { ...parseGrid(await readTable(bytes, filename), filename), source: "table" };
  }
}

/**
 * A text export - CSV, TSV, semicolons, pipes - read synchronously. A
 * spreadsheet handed to this is refused by name rather than misread as text.
 */
export function parseTags(
  file: ArrayBuffer | ArrayBufferView,
  filename = "",
): ParseResult {
  const bytes = toBytes(file);
  if ((bytes[0] === 0x50 && bytes[1] === 0x4b) || /\.xls[xm]$/i.test(filename)) {
    throw new Error(`${filename || "that file"} is a spreadsheet; use parseTagsFile`);
  }
  return parseGrid(readTextTable(bytes), filename);
}

/** The importer proper, over rows of raw cells from whichever reader. */
export function parseGrid(grid: unknown[][], filename = ""): ParseResult {
  if (grid.length === 0) {
    return { variables: [], corrections: [], skipped: [], summary: { total: 0 } };
  }

  const headerRow = findHeader(grid);
  const hasHeader = headerRow >= 0;
  const mapping = hasHeader
    ? mapHeader(grid[headerRow].map((c) => String(c ?? "")))
    : { name: 0, dataType: 1, comment: 2, address: 3 };
  const body = hasHeader ? grid.slice(headerRow + 1) : grid;
  const firstBodyRow = hasHeader ? headerRow + 2 : 1;

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
        row: i + firstBodyRow,
        value: `${name} (${rawType})`,
        reason: /^(array|struct|structure)\b/i.test(rawType)
          ? `${rawType.toLowerCase().startsWith("array") ? "array" : "structure"} variable: OTE holds it, the generator does not lay it out yet`
          : `unrecognised data type "${rawType}"`,
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
