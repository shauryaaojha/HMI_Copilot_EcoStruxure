/**
 * What comes in, and what is refused, before anything is parsed.
 *
 * Every import path now starts at lib/ingest: the bytes are sniffed for what
 * they are, a ZIP's directory is checked against its declared sizes before a
 * byte is inflated, and a refusal is an IngestError with a code, a sentence
 * about the file, and a hint about what to do. These tests hold each of those
 * to a real or deliberately crafted file.
 */

import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { IngestError, fileNameFrom } from "@/lib/ingest/errors";
import { guardZip, listZip, DEFAULT_LIMITS } from "@/lib/ingest/zip";
import { readBody } from "@/lib/ingest/body";
import { refuse, sniff, xmlRoot } from "@/lib/ingest/sniff";
import { readProject } from "@/lib/ote/reader";
import { packageProject } from "@/lib/ote/packager";
import { parseTagsFile } from "@/lib/tags/parse";

const DEMO = path.join(__dirname, "..", "..", "demo_project");
const CO = path.join(__dirname, "..", "..", "demo_objects", "HMICopilot_TankLevel.co");
const file = (name: string) => new Uint8Array(fs.readFileSync(path.join(DEMO, name)));

async function zipOf(entries: Record<string, string | Uint8Array>) {
  const z = new JSZip();
  for (const [name, body] of Object.entries(entries)) z.file(name, body);
  return z.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** Overwrite a field in every central-directory header. */
function patchCentral(bytes: Uint8Array, offset: number, write: (v: DataView, at: number) => void) {
  const out = bytes.slice();
  const v = new DataView(out.buffer);
  for (let i = 0; i + 4 < out.length; i++) if (v.getUint32(i, true) === 0x02014b50) write(v, i + offset);
  return out;
}

async function expectIngest(p: Promise<unknown> | (() => unknown), code: string) {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    expect(e).toBeInstanceOf(IngestError);
    expect((e as IngestError).code).toBe(code);
    expect((e as IngestError).message.length).toBeGreaterThan(10);
    return e as IngestError;
  }
  throw new Error(`expected an IngestError ${code}`);
}

describe("the ZIP guard", () => {
  it("lists a real project's directory with OTE's backslash names intact", () => {
    const entries = listZip(file("HMICopilot_PumpStation.eote"));
    expect(entries.some((e) => /^Screens\\[0-9a-f-]{36}\\Screen\.dat$/.test(e.name))).toBe(true);
    expect(entries.every((e) => !e.encrypted)).toBe(true);
  });

  it("refuses an archive that declares more than it could hold, before inflating it", async () => {
    const honest = await zipOf({ "Project.dat": "{}" });
    const bomb = patchCentral(honest, 24, (v, at) => v.setUint32(at, 0x7fffffff, true));
    await expectIngest(() => guardZip(bomb), "zip-bomb");
  });

  it("refuses password-protected entries by name", async () => {
    const z = await zipOf({ "Project.dat": "{}" });
    const enc = patchCentral(z, 8, (v, at) => v.setUint16(at, v.getUint16(at, true) | 1, true));
    const e = await expectIngest(() => guardZip(enc), "encrypted");
    expect(e.hint).toMatch(/save/i);
  });

  it("calls a truncated archive damaged rather than crashing in the inflater", async () => {
    const z = await zipOf({ "Project.dat": "{}", "Variables.db": new Uint8Array(4000) });
    await expectIngest(() => guardZip(z.subarray(0, z.length - 30)), "zip-corrupt");
  });

  it("refuses a file over the size limit", async () => {
    const z = await zipOf({ "a.txt": "x" });
    await expectIngest(() => guardZip(z, { ...DEFAULT_LIMITS, maxBytes: 10 }), "too-large");
  });

  it("does not trip on a real project's mostly-empty SQLite pages", () => {
    for (const name of fs.readdirSync(DEMO).filter((n) => n.endsWith(".eote"))) expect(() => guardZip(file(name))).not.toThrow();
  });
});

describe("sniffing", () => {
  it("knows an .eote by its contents, whatever it is called", async () => {
    const k = await sniff(file("HMICopilot_PumpStation.eote"), "renamed.zip");
    expect(k.kind).toBe("ote-project");
    if (k.kind === "ote-project") {
      expect(k.layout).toBe("typed");
      expect(k.product).toMatch(/Operator Terminal Expert/);
    }
  });

  it("knows a compound object", async () => {
    expect((await sniff(new Uint8Array(fs.readFileSync(CO)), "x.co")).kind).toBe("compound-object");
  });

  it("knows a spreadsheet", async () => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet("Sheet1").addRow(["Name"]);
    const bytes = new Uint8Array(await book.xlsx.writeBuffer());
    expect((await sniff(bytes, "tags.xlsx")).kind).toBe("spreadsheet");
  });

  it("names an older .vxdz and refuses it with the upgrade path", async () => {
    const struct = await zipOf({
      "Project.dat": JSON.stringify({ Brand: "Schneider", AppVersion: "3.1.100" }),
      "Screens\\panel1.dat": JSON.stringify({ Type: "Screen", Name: "Screen1", GraphicalObjects: { Type: "Canvas", Children: [] } }),
      "Variables.db": new Uint8Array(0),
    });
    const k = await sniff(struct, "old.vxdz");
    expect(k.kind).toBe("ote-project");
    if (k.kind !== "ote-project") return;
    expect(k.layout).toBe("struct");
    expect(k.product).toMatch(/3\.1\.100 \(\.vxdz\)/);
    const r = refuse(k, "old.vxdz")!;
    expect(r.code).toBe("unsupported-format");
    expect(r.hint).toMatch(/4\.4/);
  });

  it("calls a Pro-face file Pro-face BLUE, which is what it is", async () => {
    const pf = await zipOf({
      "Project.dat": JSON.stringify({ Brand: "Pro-face", AppVersion: "3.4.1" }),
      "Screens\\0b3c3d6e-1111-2222-3333-444455556666\\Screen.dat": "{}",
    });
    const k = await sniff(pf, "x.vxdz");
    expect(k.kind === "ote-project" && k.product).toMatch(/Pro-face BLUE 3\.4\.1/);
  });

  it("recognises Vijeo Designer files and refuses them honestly", async () => {
    for (const variant of ["vdz", "zdat"] as const) {
      const k = await sniff(await zipOf({ "anything.xml": "<x/>" }), `plant.${variant}`);
      expect(k.kind).toBe("vijeo-designer");
      const r = refuse(k, `plant.${variant}`)!;
      expect(r.message).toMatch(/Vijeo Designer/);
      expect(r.hint).toMatch(/variables/i);
    }
  });

  it("knows a Control Expert export by its root element", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<!-- c -->\n<VariablesExchangeFile><fileHeader/></VariablesExchangeFile>`;
    expect(xmlRoot(xml)).toBe("VariablesExchangeFile");
    expect(await sniff(new TextEncoder().encode(xml), "a.xsy")).toEqual({ kind: "control-expert-xml", root: "VariablesExchangeFile" });
  });

  it("refuses binary it does not know rather than reading it as tags", async () => {
    const junk = new Uint8Array(2048).map((_, i) => (i * 7919) % 256);
    await expectIngest(sniff(junk, "mystery.bin"), "unknown-format");
  });

  it("refuses an empty file", async () => {
    await expectIngest(sniff(new Uint8Array(0), "x.csv"), "empty");
  });
});

describe("request plumbing", () => {
  it("never throws on a malformed file-name header", () => {
    const r = new Request("http://x/", { method: "POST", headers: { "x-file-name": "%E0%A4%A" } });
    expect(fileNameFrom(r, "project.eote")).toBe("%E0%A4%A");
  });

  it("keeps only the file name from a path", () => {
    const r = new Request("http://x/", { method: "POST", headers: { "x-file-name": encodeURIComponent("C:\\plants\\..\\Station.eote") } });
    expect(fileNameFrom(r, "project.eote")).toBe("Station.eote");
  });

  it("refuses a body over the limit while streaming, whatever the header says", async () => {
    const r = new Request("http://x/", { method: "POST", body: new Uint8Array(5000) });
    await expectIngest(readBody(r, 1000), "too-large");
  });

  it("refuses a declared length over the limit before reading", async () => {
    const r = new Request("http://x/", { method: "POST", body: "x", headers: { "content-length": "999999999" } });
    await expectIngest(readBody(r, 1000), "too-large");
  });
});

describe("the reader, on damaged and multi-group projects", () => {
  async function mutate(bytes: Uint8Array, change: (zip: JSZip) => Promise<void>) {
    const zip = await JSZip.loadAsync(bytes);
    await change(zip);
    return zip.generateAsync({ type: "uint8array" });
  }

  it("carries a screen whose Screen.dat will not parse, and says so", async () => {
    const broken = await mutate(file("HMICopilot_Bars.eote"), async (zip) => {
      const name = Object.keys(zip.files).find((n) => /Screen\.dat$/i.test(n))!;
      zip.file(name, "{ this is not json");
    });
    const read = await readProject(broken, "broken.eote");
    expect(read.warnings.some((w) => /could not be read/.test(w))).toBe(true);
    expect(read.variables.length).toBeGreaterThan(0);
  });

  it("refuses a damaged Bindings.dat, because rewriting it would drop every binding", async () => {
    const broken = await mutate(file("HMICopilot_PumpStation.eote"), async (zip) => {
      zip.file("Bindings.dat", "[[[");
    });
    const e = await expectIngest(readProject(broken, "broken.eote"), "damaged");
    expect(e.detail).toEqual({ entry: "Bindings.dat" });
  });

  it("leaves alarms of other groups alone, and an alarm keeps its own row through an edit", async () => {
    const SQL = await initSqlJs();
    const source = await mutate(file("HMICopilot_PumpStation.eote"), async (zip) => {
      const db = new SQL.Database(await zip.file("Alarm.db")!.async("uint8array"));
      // Give the first modelled alarm a deadband the model knows nothing about.
      db.run('UPDATE Alarm SET "Deadband" = 7 WHERE "Order" = (SELECT MIN("Order") FROM Alarm)');
      // A second group and an alarm in it, copied from real rows so every
      // NOT NULL column the product defines is filled the way it fills them.
      const copyRow = (table: string, overrides: Record<string, unknown>) => {
        const res = db.exec(`SELECT * FROM ${table} LIMIT 1`)[0];
        const row = Object.fromEntries(res.columns.map((c, i) => [c, res.values[0][i]]));
        Object.assign(row, overrides);
        db.run(`INSERT INTO ${table} (${Object.keys(row).map((c) => `"${c}"`).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`, Object.values(row) as never[]);
      };
      copyRow("AlarmGroup", { UniqueId: "AAAAAAAA-0000-0000-0000-000000000002", Order: 9, Name: "Utilities", Id: 9 });
      copyRow("Alarm", { UniqueId: "BBBBBBBB-0000-0000-0000-000000000001", AlarmGroupId: "AAAAAAAA-0000-0000-0000-000000000002", AlarmType: 2, AlarmRecordType: 2, Id: 1, Message: "Compressed air low", Order: 99, Severity: 2, Value: "4", Deadband: 1 });
      zip.file("Alarm.db", db.export());
      db.close();
    });

    const read = await readProject(source, "two-groups.eote");
    expect(read.alarms.some((a) => a.Message === "Compressed air low")).toBe(false);
    expect(read.warnings.some((w) => /other alarm group/.test(w))).toBe(true);

    // Edit: add one alarm, which forces Alarm.db to be rewritten.
    const input = { name: read.name, target: read.target, screens: read.screens, variables: read.variables, wires: read.wires, alarms: [...read.alarms, { ...read.alarms[0], Message: "Added by the engineer", Severity: 4 }] };
    const out = await packageProject(input, undefined, read.preserved);
    const written = new SQL.Database(await (await JSZip.loadAsync(out)).file("Alarm.db")!.async("uint8array"));
    const other = written.exec(`SELECT "AlarmGroupId", "Deadband" FROM Alarm WHERE "Message" = 'Compressed air low'`)[0].values;
    expect(other).toEqual([["AAAAAAAA-0000-0000-0000-000000000002", 1]]);
    const firstUid = read.preserved.alarms.uids[0];
    const kept = written.exec(`SELECT "Deadband" FROM Alarm WHERE "UniqueId" = '${firstUid}'`)[0]?.values;
    expect(kept).toEqual([[7]]);
    written.close();
  });
});

describe("tag files OTE and Control Expert actually write", () => {
  it("reads the Variables sheet of an OTE 4.4 Excel export, not the Summary in front of it", async () => {
    const book = new ExcelJS.Workbook();
    const summary = book.addWorksheet("Summary");
    summary.addRow(["Project Name", "Station"]);
    summary.addRow(["FileVersion", "2.0"]);
    book.addWorksheet("VariableTypes").addRow(["Name", "Type", "ElementTypeName", "Dimensions"]);
    const vars = book.addWorksheet("Variables");
    vars.addRow(["Name", "FolderName", "DataType", "Dimension", "Source", "DeviceAddress", "Comments"]);
    vars.addRow(["PMP_101_RUN", "", "BOOL", "", "Internal", "", "Pump 1 running"]);
    vars.addRow(["LT_101_PV", "", "REAL", "", "Internal", "", "Tank 1 level"]);
    vars.addRow(["Recipe", "", "ARRAY", "10", "Internal", "", ""]);
    const r = await parseTagsFile(new Uint8Array(await book.xlsx.writeBuffer()), "export.xlsx");
    expect(r.variables.map((v) => v.Name)).toEqual(["PMP_101_RUN", "LT_101_PV"]);
    expect(r.variables[1]).toMatchObject({ DataType: "REAL", Comments: "Tank 1 level" });
    expect(r.skipped).toEqual([expect.objectContaining({ value: "Recipe (ARRAY)", reason: expect.stringMatching(/^array variable/) })]);
  });

  it("finds the header below a preamble", async () => {
    const csv = "[FileVersion]\n2.0\n\nName,Type,Comments\nFT_101_PV,REAL,Flow\nSTATUS_TXT,STRING[20],Status\n";
    const r = await parseTagsFile(new TextEncoder().encode(csv), "vars.csv");
    expect(r.variables).toEqual([
      { Name: "FT_101_PV", DataType: "REAL", Comments: "Flow", DeviceAddress: "" },
      { Name: "STATUS_TXT", DataType: "STRING", Comments: "Status", DeviceAddress: "" },
    ]);
  });

  it("refuses a project offered as a tag list, and says where it goes", async () => {
    await expectIngest(parseTagsFile(file("HMICopilot_PumpStation.eote"), "x.eote"), "unsupported-format");
  });

  it("refuses a Control Expert program section offered as variables", async () => {
    const xml = `<?xml version="1.0"?><STExchangeFile><dataBlock><variables name="a" typeName="BOOL"/></dataBlock></STExchangeFile>`;
    const e = await expectIngest(parseTagsFile(new TextEncoder().encode(xml), "s.xst"), "unsupported-format");
    expect(e.hint).toMatch(/xsy/);
  });
});

describe("Vijeo Designer's own variable export", () => {
  // Shaped on what is publicly documented of the format: a preamble line,
  // then a header starting "Type,Name", rows marked by kind, structure
  // elements as dotted names, Latin-1, CRLF. The plant is ours.
  const csv = [
    "Vijeo-Designer variable export",
    'Type,Name,Data Type,Source,Description,Scan Group,Device Address',
    "Folder,PUMPS,,,,,",
    'Variable,PMP_101_RUN,BOOL,External,"Pump 1 running",SG1,%MW100:X0',
    'Variable,TANK_LVL,REAL,Internal,"Tank level",,',
    "DDTVariable,PUMPS.P5,PumpType,External,,SG1,",
    'SubVariable,PUMPS.P5.Running,BOOL,External,"P5 running",SG1,%MW200:X0',
    "ArrayVariable,LAMPS01,BOOL,Internal,,,",
  ].join("\r\n");

  it("takes variables and structure elements, skips folders, reports structures and arrays", async () => {
    const r = await parseTagsFile(new TextEncoder().encode(csv), "vijeo.csv");
    expect(r.variables.map((v) => [v.DataType, v.Comments, v.DeviceAddress])).toEqual([
      ["BOOL", "Pump 1 running", "%MW100:X0"],
      ["REAL", "Tank level", ""],
      ["BOOL", "P5 running", "%MW200:X0"],
    ]);
    expect(r.variables[2].Name).toMatch(/^PUMPS_P5_Running$/);
    expect(r.corrections.some((c) => c.from === "PUMPS.P5.Running")).toBe(true);
    expect(r.skipped.map((s) => s.value)).toEqual(["PUMPS.P5", "LAMPS01"]);
  });
});
