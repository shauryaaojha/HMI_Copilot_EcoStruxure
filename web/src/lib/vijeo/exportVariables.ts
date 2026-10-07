/**
 * The project's tags, written into a Vijeo Designer variable export.
 *
 * Vijeo Designer imports variables from the CSV it exports (Variables node >
 * Export / Import), and its importer is strict: the preamble line, the header
 * and the field layout of each row kind must be exactly its own. None of that
 * is published in full, so this never writes the format from scratch. It
 * writes *into* an export the engineer made from their own Vijeo project -
 * any project, one variable is enough - and each new row is a copy of one of
 * that file's own rows of the same data type, with the fields set and
 * everything else made neutral (alarm off, no logging, no scaling). That is
 * how an independent tool verified against Vijeo itself adds variables
 * (github.com/apexsotjo-blip/vijeo-mcp, varedit); this is written here from
 * those facts. Latin-1 and the file's own line endings, byte-transparent.
 *
 * What does not carry is reported, not dropped: an OTE type Vijeo lacks
 * (LREAL, WORD, DWORD map to REAL, UINT, UDINT), a device address (an
 * external variable needs a scan group this project cannot know), and any
 * character Latin-1 cannot hold.
 */

import type { Variable } from "@/lib/ote/schema";

/** OTE data types onto Vijeo's: BOOL INT UINT DINT UDINT REAL STRING. */
const TYPE: Record<Variable["DataType"], string> = {
  BOOL: "BOOL",
  INT: "INT",
  UINT: "UINT",
  DINT: "DINT",
  UDINT: "UDINT",
  WORD: "UINT",
  DWORD: "UDINT",
  REAL: "REAL",
  LREAL: "REAL",
  STRING: "STRING",
};

/** Columns Vijeo writes quoted (vijeo-mcp, varedit QUOTED). */
const QUOTED = new Set(["Description", "Initial Value", "Alarm Message", "Alarm Type", "Trigger Condition", "LoLo\\Lo\\Hi\\HiHi", "Vibration Pattern", "Sound File", "Play Mode", "Device Address"]);

export interface VijeoExport {
  bytes: Uint8Array;
  added: string[];
  /** Variables already in the template, left exactly as they were. */
  present: string[];
  notes: string[];
}

/** Split on commas outside double quotes, keeping each token verbatim. */
export function splitRaw(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const unquote = (t: string) => {
  const s = t.trim();
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/""/g, '"') : s;
};
const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;

const latin1Decode = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
function latin1Encode(s: string): { bytes: Uint8Array; lossy: boolean } {
  const out = new Uint8Array(s.length);
  let lossy = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0xff) {
      out[i] = 0x3f; // "?"
      lossy = true;
    } else out[i] = c;
  }
  return { bytes: out, lossy };
}

export function writeVijeoVariables(template: Uint8Array, variables: Variable[]): VijeoExport {
  const text = latin1Decode(template);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(eol);
  const headerAt = lines.findIndex((l) => l.startsWith("Type,Name"));
  if (headerAt < 0) {
    throw new Error("That file is not a Vijeo Designer variable export: no line starts with \"Type,Name\". Export the variables from your Vijeo project and use that file.");
  }
  const header = splitRaw(lines[headerAt]).map((h) => h.trim());
  const col = new Map(header.map((h, i) => [h, i]));
  const source = col.get("Data Source") ?? 3;

  const rows = lines.slice(headerAt + 1).map(splitRaw);
  const present = new Set(rows.filter((t) => t.length > 1 && t[0] !== "Folder").map((t) => unquote(t[1])));
  // Rows to copy, per Vijeo type: Internal variables, quiet ones first.
  const templates = new Map<string, string[]>();
  const quiet = (t: string[]) => (col.has("Alarm") && unquote(t[col.get("Alarm")!]) === "Enable" ? 1 : 0) + (col.has("LoggingGroup") && unquote(t[col.get("LoggingGroup")!]) ? 1 : 0);
  for (const t of rows.filter((r) => r[0] === "Variable" && unquote(r[source] ?? "") === "Internal").sort((a, b) => quiet(a) - quiet(b))) {
    if (!templates.has(unquote(t[2]))) templates.set(unquote(t[2]), t);
  }
  const anyTemplate = templates.values().next().value as string[] | undefined;
  if (!anyTemplate) {
    throw new Error("The template has no internal variable to copy a row from. Add one internal variable in Vijeo Designer, export again, and use that file.");
  }

  const notes: string[] = [];
  const set = (t: string[], name: string, value: string) => {
    const i = col.get(name);
    if (i === undefined) return;
    while (t.length <= i) t.push("");
    t[i] = QUOTED.has(name) ? quote(value) : value;
  };
  const added: string[] = [];
  const kept: string[] = [];
  const mapped = new Map<string, number>();
  let addresses = 0;
  let lossy = false;
  const out: string[] = [];
  for (const v of variables) {
    if (present.has(v.Name)) {
      kept.push(v.Name);
      continue;
    }
    const type = TYPE[v.DataType];
    if (type !== v.DataType) mapped.set(`${v.DataType} as ${type}`, (mapped.get(`${v.DataType} as ${type}`) ?? 0) + 1);
    const t = [...(templates.get(type) ?? anyTemplate)];
    t[0] = "Variable";
    t[1] = v.Name;
    t[2] = type;
    t[source] = "Internal";
    set(t, "Description", v.Comments ?? "");
    set(t, "Initial Value", type === "BOOL" ? "Off" : type === "STRING" ? "" : "0");
    if (type !== "STRING") set(t, "NumofBytes", "");
    for (const h of ["Alarm Message", "Alarm Group", "Severity", "LoggingGroup", "Min", "Max", "RawMin", "RawMax", "ScaledMin", "ScaledMax", "Trigger Condition", "LoLo\\Lo\\Hi\\HiHi", "Alarm Type", "Vibration Pattern", "Sound File", "Play Mode", "Scan Group", "Device Address"]) {
      const i = col.get(h);
      if (i !== undefined && t[i] !== undefined && unquote(t[i]) !== "") set(t, h, "");
    }
    if (col.has("Alarm")) set(t, "Alarm", "Disable");
    if (col.has("Data Sharing") && unquote(t[col.get("Data Sharing")!] ?? "")) set(t, "Data Sharing", "None");
    if (col.has("InputRange") && unquote(t[col.get("InputRange")!] ?? "")) set(t, "InputRange", "Disable");
    if (col.has("DataScaling") && unquote(t[col.get("DataScaling")!] ?? "")) set(t, "DataScaling", "Disable");
    if (v.DeviceAddress) addresses++;
    const line = t.join(",");
    if (latin1Encode(line).lossy) lossy = true;
    out.push(line);
    added.push(v.Name);
  }

  // New rows go after the last row, before any trailing blank line.
  let end = lines.length;
  while (end > headerAt + 1 && lines[end - 1].trim() === "") end--;
  const result = [...lines.slice(0, end), ...out, ...lines.slice(end)].join(eol);

  for (const [what, n] of mapped) notes.push(`${n} variable${n === 1 ? "" : "s"} written ${what}: Vijeo has no such type.`);
  if (addresses) notes.push(`${addresses} device address${addresses === 1 ? " was" : "es were"} not carried: an external variable in Vijeo needs a scan group, so these are internal; set the source and scan group in Vijeo.`);
  if (lossy) notes.push("Some characters cannot be written in Vijeo's Latin-1 export and became \"?\".");
  if (kept.length) notes.push(`${kept.length} variable${kept.length === 1 ? " is" : "s are"} already in the template and ${kept.length === 1 ? "was" : "were"} left as ${kept.length === 1 ? "it was" : "they were"}.`);
  notes.push("Import it in Vijeo Designer with Variables > Import. The format was written from a template of your own export; check the first import.");
  return { bytes: latin1Encode(result).bytes, added, present: kept, notes };
}
