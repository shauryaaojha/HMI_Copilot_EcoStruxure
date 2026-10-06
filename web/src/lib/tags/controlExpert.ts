/**
 * Control Expert (Unity Pro) XML exchange files -> variables, with structure.
 *
 * This is the input docs/REENGINEERING.md §1.5 says the product is missing and
 * the one a Schneider PLC engineer actually hands over: an `.xsy` (variables
 * export), an `.xvm` (variables with their located addresses, made for the HMI
 * side), or a whole-application `.xef`. All three are XML whose variables sit
 * in `<dataBlock>` as
 *
 *     <variables name="PMP_101" typeName="PumpCtrl_DDT" topologicalAddress="%MW100">
 *         <comment>Transfer pump 1</comment>
 *         <variableInit value="0"></variableInit>
 *     </variables>
 *
 * and whose derived data types sit in `<DDTSource DDTName="...">` with the
 * members in `<structure>` as more `<variables>`. That shape was read from
 * exchange files written by Control Expert 14.0 (`fileHeader company="Schneider
 * Automation"`), not from documentation.
 *
 * What makes this worth more than a CSV: a variable of a DDT is *equipment by
 * construction*. `PMP_101 : PumpCtrl_DDT` with members `Run`, `Flt`, `Cmd` is a
 * pump with three roles, decided by the type system rather than guessed from a
 * prefix. So every DDT instance is flattened into OTE-legal variables
 * (`PMP_101_Run`) *and* reported as a structured instance, which equipment
 * inference can use ahead of the name heuristics.
 *
 * What is not flattened is reported, never dropped quietly: arrays (OTE takes
 * them, the generator does not yet), function block instances (timers and DFBs
 * are PLC internals, not HMI signals), and types no IEC mapping covers.
 */

import { DATA_TYPES, type Variable } from "@/lib/ote/schema";
import { normaliseNames, type Correction } from "@/lib/validation/naming";
import { childNamed, descendants, parseXml, type XmlNode } from "./xml";

type DataType = (typeof DATA_TYPES)[number];

/** IEC 61131-3 elementary types as Control Expert spells them, onto OTE's. */
const IEC: Record<string, DataType> = {
  BOOL: "BOOL",
  EBOOL: "BOOL",
  BYTE: "WORD",
  WORD: "WORD",
  DWORD: "DWORD",
  INT: "INT",
  SINT: "INT",
  DINT: "DINT",
  UINT: "UINT",
  USINT: "UINT",
  UDINT: "UDINT",
  REAL: "REAL",
  LREAL: "LREAL",
  // Durations and dates are 32-bit counts in the PLC; an HMI reads them as
  // numbers and formats them, so they come across as DINT with a note.
  TIME: "DINT",
  DATE: "UDINT",
  TOD: "UDINT",
  TIME_OF_DAY: "UDINT",
  DT: "UDINT",
  DATE_AND_TIME: "UDINT",
};

/** Function blocks every Control Expert library ships; an instance is not a signal. */
const FUNCTION_BLOCKS = new Set(["TON", "TOF", "TP", "CTU", "CTD", "CTUD", "R_TRIG", "F_TRIG", "SR", "RS", "SAH", "PID", "PIDFF", "PI_B", "IDLE"]);

export interface DdtMember {
  name: string;
  typeName: string;
  comment: string;
}

export interface StructuredInstance {
  /** The PLC variable, e.g. "PMP_101". */
  instance: string;
  /** Its derived type, e.g. "PumpCtrl_DDT". */
  ddt: string;
  comment: string;
  address: string;
  /** Member path to the OTE variable it became: "Run" -> "PMP_101_Run". */
  members: { path: string; variable: string; typeName: string }[];
}

export interface ControlExpertResult {
  variables: Variable[];
  corrections: Correction[];
  skipped: { row: number; value: string; reason: string }[];
  summary: { total: number } & Partial<Record<DataType, number>>;
  /** DDT instances: the equipment the type system declares. */
  structure: StructuredInstance[];
  /** The DDT definitions found, by name. */
  ddts: Record<string, DdtMember[]>;
  /** What wrote the file, from fileHeader: "Control Expert V14.0 - 190112". */
  producer?: string;
}

const STRING_TYPE = /^STRING(\[\d+\])?$/i;
const ARRAY_TYPE = /^ARRAY\s*\[/i;

function elementary(typeName: string): DataType | null {
  const t = typeName.trim().toUpperCase();
  if (STRING_TYPE.test(t)) return "STRING";
  return IEC[t] ?? null;
}

const textOf = (node: XmlNode | undefined) => (node?.text ?? "").replace(/\s+/g, " ").trim();

/** DDT definitions: `<DDTSource DDTName>` holding `<structure>` of `<variables>`. */
function readDdts(doc: XmlNode): Record<string, DdtMember[]> {
  const out: Record<string, DdtMember[]> = {};
  for (const src of descendants(doc, "DDTSource")) {
    const name = src.attrs.DDTName ?? src.attrs.name;
    if (!name) continue;
    const structure = childNamed(src, "structure");
    if (!structure) continue; // an array DDT: not a record, nothing to flatten
    out[name] = structure.children
      .filter((c) => c.name === "variables")
      .map((v) => ({ name: v.attrs.name ?? "", typeName: v.attrs.typeName ?? "", comment: textOf(childNamed(v, "comment")) }))
      .filter((m) => m.name !== "");
  }
  return out;
}

/** Declared variables: every `<variables>` directly under a `<dataBlock>`. */
function readDeclared(doc: XmlNode): XmlNode[] {
  return descendants(doc, "dataBlock").flatMap((block) => block.children.filter((c) => c.name === "variables"));
}

export function parseControlExpert(text: string): ControlExpertResult {
  let doc: XmlNode;
  try {
    doc = parseXml(text);
  } catch (e) {
    throw new Error(`the Control Expert file is not well-formed XML: ${e instanceof Error ? e.message : String(e)}`);
  }
  const header = descendants(doc, "fileHeader")[0];
  const ddts = readDdts(doc);
  const declared = readDeclared(doc);

  type Row = { name: string; dataType: DataType; comment: string; address: string };
  const rows: Row[] = [];
  const skipped: ControlExpertResult["skipped"] = [];
  const pending: { instance: string; ddt: string; comment: string; address: string; members: { path: string; row: number; typeName: string }[] }[] = [];

  /**
   * Flatten a DDT instance's members, recursing into nested DDTs. Depth is
   * capped: a recursive type cannot be declared in Control Expert, but a file
   * edited by hand can say anything.
   */
  const flatten = (prefix: string, ddt: string, comment: string, depth: number, into: { path: string; row: number; typeName: string }[], pathPrefix = "") => {
    for (const m of ddts[ddt] ?? []) {
      const path = pathPrefix ? `${pathPrefix}.${m.name}` : m.name;
      const name = `${prefix}_${m.name}`;
      const memberComment = [comment, m.comment].filter(Boolean).join(" - ");
      const t = elementary(m.typeName);
      if (t) {
        into.push({ path, row: rows.length, typeName: m.typeName });
        rows.push({ name, dataType: t, comment: memberComment, address: "" });
      } else if (ddts[m.typeName] && depth < 4) {
        flatten(name, m.typeName, memberComment, depth + 1, into, path);
      } else {
        skipped.push({ row: 0, value: `${prefix}.${path} (${m.typeName})`, reason: ARRAY_TYPE.test(m.typeName) ? "array member: not flattened yet" : `member type ${m.typeName} has no OTE equivalent` });
      }
    }
  };

  declared.forEach((v, index) => {
    const name = v.attrs.name ?? "";
    const typeName = v.attrs.typeName ?? "";
    const comment = textOf(childNamed(v, "comment"));
    const address = (v.attrs.topologicalAddress ?? "").trim();
    if (!name) return;
    const row = index + 1;
    const t = elementary(typeName);
    if (t) {
      rows.push({ name, dataType: t, comment, address });
      return;
    }
    if (ddts[typeName]) {
      const members: { path: string; row: number; typeName: string }[] = [];
      flatten(name, typeName, comment, 0, members);
      pending.push({ instance: name, ddt: typeName, comment, address, members });
      return;
    }
    const reason = ARRAY_TYPE.test(typeName)
      ? "array: OTE can hold it, the generator does not lay arrays out yet"
      : FUNCTION_BLOCKS.has(typeName.toUpperCase())
        ? "function block instance: a PLC internal, not an HMI signal"
        : `type ${typeName} is not defined in this file (export the DDTs with the variables to flatten it)`;
    skipped.push({ row, value: `${name} (${typeName})`, reason });
  });

  const { names, corrections } = normaliseNames(rows.map((r) => r.name));
  const variables: Variable[] = rows.map((r, i) => ({ Name: names[i], DataType: r.dataType, Comments: r.comment, DeviceAddress: r.address }));
  const structure: StructuredInstance[] = pending.map((p) => ({
    instance: p.instance,
    ddt: p.ddt,
    comment: p.comment,
    address: p.address,
    members: p.members.map((m) => ({ path: m.path, variable: names[m.row], typeName: m.typeName })),
  }));

  const summary: ControlExpertResult["summary"] = { total: variables.length };
  for (const v of variables) summary[v.DataType] = (summary[v.DataType] ?? 0) + 1;

  return {
    variables,
    corrections,
    skipped,
    summary,
    structure,
    ddts,
    producer: header?.attrs.product,
  };
}
