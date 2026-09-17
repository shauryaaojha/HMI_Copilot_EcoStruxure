/**
 * A tag export as a grid of cells, whatever it was saved as.
 *
 * This used to be one call into the `xlsx` package, which read spreadsheets
 * and text alike. That package's npm build is stuck at 0.18.5 with two high
 * advisories and no fix published, so it is gone: `exceljs` reads the
 * spreadsheets, and the text formats are read here - which is also where a
 * PLC export's habits are handled, rather than in a general-purpose parser
 * that does not know about them. docs/PLAN_PHASE2.md item 4.
 *
 * What comes back is exactly what the old call produced: rows of raw cell
 * values, blank rows dropped, no header interpretation.
 */

import ExcelJS from "exceljs";

/** A ZIP starts "PK"; every .xlsx is one. Cheaper and truer than the extension. */
const isZip = (bytes: Uint8Array) => bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;

export async function readTable(bytes: Uint8Array, filename = ""): Promise<unknown[][]> {
  if (isZip(bytes) || /\.xls[xm]$/i.test(filename)) return readSheet(bytes);
  return readTextTable(bytes);
}

/** The text formats only, synchronously. */
export function readTextTable(bytes: Uint8Array): unknown[][] {
  return readText(decodeText(bytes));
}

/* ---------------------------------------------------------------------- */
/* Spreadsheets                                                            */
/* ---------------------------------------------------------------------- */

/** A cell's value as the text an engineer typed, not exceljs's wrapper for it. */
function plain(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("result" in value) return plain(value.result as ExcelJS.CellValue);
    if ("text" in value) return value.text;
    if ("error" in value) return "";
    return String(value);
  }
  return value;
}

async function readSheet(bytes: Uint8Array): Promise<unknown[][]> {
  const book = new ExcelJS.Workbook();
  // exceljs wants a Node Buffer; a Uint8Array view over the same bytes is one.
  await book.xlsx.load(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) as unknown as ArrayBuffer);
  const sheet = book.worksheets[0];
  if (!sheet) return [];
  const rows: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    // row.values is 1-based with an empty slot 0; take it from 1 and pad the
    // gaps a sparse row leaves, so column indexes mean the same on every row.
    const values = row.values as ExcelJS.CellValue[];
    const cells: unknown[] = [];
    for (let i = 1; i < values.length; i += 1) cells.push(plain(values[i]));
    if (cells.some((c) => String(c ?? "").trim() !== "")) rows.push(cells);
  });
  return rows;
}

/* ---------------------------------------------------------------------- */
/* Text: CSV, TSV, semicolons, pipes                                      */
/* ---------------------------------------------------------------------- */

/** UTF-8 by default; a UTF-16 export (which some PLC tools write) by its BOM. */
function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  const text = new TextDecoder("utf-8").decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const DELIMITERS = [",", "\t", ";", "|"] as const;

/**
 * The delimiter is whichever candidate splits the first few non-empty lines
 * into the same number of fields, more than one, most often. A comma inside a
 * quoted comment does not count, because the count is taken after quoting.
 */
export function sniffDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 20);
  let best: { delimiter: string; score: number } = { delimiter: ",", score: -1 };
  for (const delimiter of DELIMITERS) {
    const counts = lines.map((line) => splitLine(line, delimiter).length);
    if (counts.length === 0) continue;
    const mode = counts
      .sort((a, b) => a - b)
      .reduce<{ value: number; n: number; best: { value: number; n: number } }>(
        (acc, v) => {
          const n = v === acc.value ? acc.n + 1 : 1;
          const bestSoFar = n > acc.best.n ? { value: v, n } : acc.best;
          return { value: v, n, best: bestSoFar };
        },
        { value: -1, n: 0, best: { value: 1, n: 0 } },
      ).best;
    if (mode.value < 2) continue;
    // Consistency first, then width: a delimiter that gives every line the
    // same four fields beats one that gives most lines two.
    const score = mode.n * 100 + mode.value;
    if (score > best.score) best = { delimiter, score };
  }
  return best.delimiter;
}

/** One line into fields, honouring double quotes and the "" escape. */
export function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

function readText(text: string): unknown[][] {
  const delimiter = sniffDelimiter(text);
  const rows: unknown[][] = [];
  // A quoted field may hold a newline; join lines until the quotes balance.
  let pending = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = pending ? `${pending}\n${raw}` : raw;
    const quotes = (line.match(/"/g) ?? []).length;
    if (quotes % 2 === 1) {
      pending = line;
      continue;
    }
    pending = "";
    if (line.trim().length === 0) continue;
    rows.push(splitLine(line, delimiter).map((f) => f.trim()));
  }
  if (pending.trim().length > 0) rows.push(splitLine(pending, delimiter).map((f) => f.trim()));
  return rows;
}
