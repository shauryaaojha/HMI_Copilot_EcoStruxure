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
const COLUMNS: Record<Exclude<keyof ParsedRow, "original">, string[]> = {
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
  /** The name as the file wrote it, when it was shortened (a Vijeo folder left out). */
  original?: string;
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
  // The most specific alias wins, not the leftmost column: Vijeo Designer's
  // export starts "Type,Name,Data Type,..." where Type is the row kind
  // (Variable, Folder), and taking it as the data type skipped every row.
  const mapping: Partial<Record<keyof ParsedRow, number>> = {};
  const rank: Partial<Record<keyof ParsedRow, number>> = {};
  header.forEach((cell, index) => {
    const k = key(String(cell ?? ""));
    for (const [field, aliases] of Object.entries(COLUMNS) as [Exclude<keyof ParsedRow, "original">, string[]][]) {
      const r = aliases.indexOf(k);
      if (r >= 0 && (rank[field] === undefined || r < rank[field]!)) {
        mapping[field] = index;
        rank[field] = r;
      }
    }
  });
  return mapping;
}

/**
 * Vijeo Designer's variable export marks every row with its kind in the first
 * column (folder, variable, structure instance, structure element, array).
 * When the header's first column is that, the kind decides what is a tag.
 */
const VIJEO_ROWS: Record<string, "tag" | "skip-folder" | "skip-structure" | "skip-array"> = {
  variable: "tag",
  subvariable: "tag",
  folder: "skip-folder",
  ddtvariable: "skip-structure",
  structurevariable: "skip-structure",
  arrayvariable: "skip-array",
};

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

  // Vijeo Designer: first column "Type" holding row kinds, and the data type
  // somewhere else. Recognised by the rows, not by the header alone.
  const kindColumn =
    hasHeader && key(String(grid[headerRow][0] ?? "")) === "type" && mapping.dataType !== 0 &&
    body.slice(0, 50).some((r) => VIJEO_ROWS[key(String(r[0] ?? ""))] !== undefined)
      ? 0
      : -1;

  // Vijeo folders: "Folder,PUMPS" rows. A variable "PUMPS.PMP_101_RUN" is
  // PMP_101_RUN filed in PUMPS, and flattening it to PUMPS_PMP_101_RUN would
  // hide the equipment prefix from inference. So the folder path is left out
  // of the OTE name - when what remains is still unique - and said so.
  const folders = new Set<string>();
  if (kindColumn >= 0) {
    for (const r of body) if (key(String(r[kindColumn] ?? "")) === "folder") folders.add(String(r[1] ?? "").trim());
  }
  const unfiled = (name: string): string => {
    const parts = name.split(".");
    let cut = 0;
    while (cut < parts.length - 1 && folders.has(parts.slice(0, cut + 1).join("."))) cut++;
    return parts.slice(cut).join(".");
  };

  const cell = (row: unknown[], field: keyof ParsedRow): string => {
    const index = mapping[field];
    return index === undefined ? "" : String(row[index] ?? "").trim();
  };

  const rows: ParsedRow[] = [];
  /** Vijeo Designer structure instances (DDTVariable rows): name -> type. */
  const instances = new Map<string, { type: string; comment: string }>();
  const skipped: ParseResult["skipped"] = [];

  body.forEach((row, i) => {
    const name = cell(row, "name");
    if (name.length === 0) return; // blank line, not an error worth reporting
    if (kindColumn >= 0) {
      const kind = VIJEO_ROWS[key(String(row[kindColumn] ?? ""))];
      if (kind === "skip-folder") return; // a folder is not a tag
      if (kind === "skip-structure") {
        // Not a tag itself, but it says what its elements are: "PUMPS.P5" of
        // type PumpType. Kept, so its SubVariable rows become one unit.
        instances.set(name, { type: cell(row, "dataType"), comment: cell(row, "comment") });
        return;
      }
      if (kind === "skip-array") {
        skipped.push({
          row: i + firstBodyRow,
          value: name,
          reason: kind === "skip-array" ? "array variable: its elements are imported where the export lists them" : "structure instance: its elements are imported as their own rows",
        });
        return;
      }
    }

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

    const short = folders.size ? unfiled(name) : name;
    rows.push({
      name: short,
      ...(short !== name ? { original: name } : {}),
      // A tag list with no type column is common; BOOL is the safe default
      // because a wrong BOOL is visible on screen, a wrong REAL is not.
      dataType: dataType ?? "BOOL",
      comment: cell(row, "comment"),
      address: cell(row, "address"),
    });
  });

  // A shortened name that would collide with another keeps its folders.
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  for (const r of rows) if (r.original && counts.get(r.name)! > 1) r.name = r.original;

  const normalised = normaliseNames(rows.map((r) => r.name));
  const names = normalised.names;
  // Report renames from what the file said, so a Vijeo name maps to its OTE one.
  const corrections: Correction[] = [];
  rows.forEach((r, i) => {
    const from = r.original ?? r.name;
    if (from === names[i]) return;
    const own = normalised.corrections.find((c) => c.from === r.name && c.to === names[i]);
    corrections.push({
      from,
      to: names[i],
      reason: r.original
        ? `Vijeo folder ${r.original.slice(0, r.original.length - r.name.length - 1)} left out of the name${own ? `; ${own.reason}` : ""}`
        : (own?.reason ?? "renamed to an OTE-legal name"),
    });
  });

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
  // Vijeo structure instances, as the same structure a Control Expert DDT
  // gives: each instance's elements are the rows named "<instance>.<member>".
  const structure: StructuredInstance[] = [];
  if (instances.size > 0) {
    const full = (r: ParsedRow) => r.original ?? r.name;
    const byOriginal = new Map(rows.map((r, i) => [full(r), names[i]]));
    for (const [instance, { type, comment }] of instances) {
      const members = rows
        .filter((r) => full(r).startsWith(`${instance}.`))
        .map((r) => ({ path: full(r).slice(instance.length + 1), variable: byOriginal.get(full(r))!, typeName: r.dataType }));
      if (members.length === 0) continue;
      structure.push({ instance: unfiled(instance).replace(/[^A-Za-z0-9_]/g, "_"), ddt: type, comment, address: "", members });
    }
  }

  return { variables, corrections, skipped, summary, ...(structure.length ? { structure } : {}) };
}
