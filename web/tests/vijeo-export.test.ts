/**
 * Tags written into a Vijeo Designer variable export used as a template.
 *
 * The template is shaped on what is documented of the format (a preamble
 * line, a header starting "Type,Name", rows by kind, Latin-1, CRLF); the
 * property under test is that the file stays the engineer's own - preamble,
 * header and existing rows byte-identical - and that every new row is a copy
 * of one of its rows with only our fields changed and alarms switched off.
 */

import { describe, expect, it } from "vitest";
import { splitRaw, writeVijeoVariables } from "@/lib/vijeo/exportVariables";
import { parseTagsFile } from "@/lib/tags/parse";
import type { Variable } from "@/lib/ote/schema";

const HEADER = 'Type,Name,Data Type,Data Source,Description,Initial Value,NumofBytes,Data Sharing,Alarm,Alarm Message,Scan Group,Device Address,LoggingGroup';
const TEMPLATE = [
  "Vijeo-Designer variable export 6.2",
  HEADER,
  "Folder,GENERAL,,,,\"\",",
  'Variable,GENERAL.Existing,BOOL,Internal,"Was here",Off,,None,Enable,"Existing alarm",,,Trends',
  'Variable,GENERAL.Quiet,BOOL,Internal,"Quiet one",Off,,None,Disable,"",,,',
  'Variable,GENERAL.Speed,REAL,Internal,"",0,,None,Disable,"",,,',
  "",
].join("\r\n");
const latin1 = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const read = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

const vars: Variable[] = [
  { Name: "PMP_101_RUN", DataType: "BOOL", Comments: "Pump 1 running", DeviceAddress: "%MW100:X0" },
  { Name: "FT_101_PV", DataType: "LREAL", Comments: "Flow, m³/h", DeviceAddress: "" },
  { Name: "STATE_TXT", DataType: "STRING", Comments: "Pump ✓", DeviceAddress: "" },
  { Name: "GENERAL.Existing", DataType: "BOOL", Comments: "", DeviceAddress: "" },
];

describe("writing tags into a Vijeo export", () => {
  it("keeps the engineer's file and adds rows copied from its own, alarms off", () => {
    const out = writeVijeoVariables(latin1(TEMPLATE), vars);
    const text = read(out.bytes);
    const lines = text.split("\r\n");
    expect(lines.slice(0, 6)).toEqual(TEMPLATE.split("\r\n").slice(0, 6));
    expect(text.endsWith("\r\n")).toBe(true);
    expect(out.added).toEqual(["PMP_101_RUN", "FT_101_PV", "STATE_TXT"]);
    expect(out.present).toEqual(["GENERAL.Existing"]);

    const row = (name: string) => splitRaw(lines.find((l) => splitRaw(l)[1] === name)!);
    const pump = row("PMP_101_RUN");
    // Copied from the quiet BOOL row, not the one with an alarm and logging.
    expect(pump).toEqual(["Variable", "PMP_101_RUN", "BOOL", "Internal", '"Pump 1 running"', '"Off"', "", "None", "Disable", '""', "", "", ""]);
    expect(pump.length).toBe(HEADER.split(",").length);
    expect(row("FT_101_PV").slice(0, 6)).toEqual(["Variable", "FT_101_PV", "REAL", "Internal", '"Flow, m³/h"', '"0"']);
  });

  it("says what did not carry", () => {
    const { notes } = writeVijeoVariables(latin1(TEMPLATE), vars);
    expect(notes.join(" ")).toMatch(/1 variable written LREAL as REAL/);
    expect(notes.join(" ")).toMatch(/1 device address was not carried/);
    expect(notes.join(" ")).toMatch(/Latin-1/);
    expect(notes.join(" ")).toMatch(/already in the template/);
  });

  it("reads back through the importer as the same tags", async () => {
    const out = writeVijeoVariables(latin1(TEMPLATE), vars.slice(0, 2));
    const parsed = await parseTagsFile(out.bytes, "vijeo.csv");
    expect(parsed.variables.find((v) => v.Name === "PMP_101_RUN")).toMatchObject({ DataType: "BOOL", Comments: "Pump 1 running" });
    expect(parsed.variables.find((v) => v.Name === "FT_101_PV")?.DataType).toBe("REAL");
  });

  it("refuses a file that is not a Vijeo export, and one with nothing to copy", () => {
    expect(() => writeVijeoVariables(latin1("Name,DataType\r\nA,BOOL"), vars)).toThrow(/not a Vijeo Designer variable export/);
    expect(() => writeVijeoVariables(latin1(`x\r\n${HEADER}\r\nFolder,G,,,,"",`), vars)).toThrow(/no internal variable to copy/);
  });
});
