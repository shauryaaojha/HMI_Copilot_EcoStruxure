/**
 * Finished projects, scanned for what they teach.
 *
 * Two kinds of file under test. Our own .eote files, which open in OTE 4.4 and
 * hold real bindings, alarms and screens in the typed layout. And a struct
 * layout project (.vxdz 3.1-3.3) built here in the shape docs/VXDZ_FINDINGS.md
 * §2 records from the template corpus - objects as {Type, Properties[]},
 * bindings inline in property values, screens at Screens\panelN.dat. Its
 * Variables.db table is a stand-in: the corpus's own table layout is not
 * documented, which is exactly why the scanner reads tables by column name and
 * reports that it did.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import initSqlJs from "sql.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { namingStats, scanProject } from "@/lib/knowledge/scan";
import { aggregate, exampleScreens, precedentFor } from "@/lib/knowledge/conventions";
import { allKnowledge, deleteKnowledge, getKnowledge, knowledgeStore, putKnowledge } from "@/lib/knowledge/store";

const DEMO = path.join(__dirname, "..", "..", "demo_project");
const demo = (name: string) => new Uint8Array(fs.readFileSync(path.join(DEMO, name)));

async function structProject(): Promise<Uint8Array> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE variable_root ("Id" INTEGER, "Name" TEXT, "DataType" TEXT, "Description" TEXT)');
  db.run("INSERT INTO variable_root VALUES (1, 'Var2', 'INT', 'Tank level'), (2, 'PumpRun', 'BOOL', 'Pump running')");
  const prop = (FullName: string, Type: string, Value: unknown) => ({ Name: FullName.split(".").pop(), FullName, Type, Value });
  const binding = (VariableName: string) => ({
    Type: "Binding",
    BindingType: "Variable",
    Source: { VariableName, Property: "Value", Expression: -1, Type: "IdentifierName", ObjectType: "Variable" },
    FallbackValue: 0,
    Mode: "TwoWay",
    Converter: null,
  });
  const screen = {
    Type: "Screen",
    Name: "Overview",
    Properties: [],
    GraphicalObjects: {
      Type: "Canvas",
      Name: "Canvas1",
      Children: [
        {
          Type: "Grid",
          Name: "Grid1",
          Properties: [],
          Children: [
            {
              Type: "Rectangle",
              Name: "TankFill",
              Properties: [
                prop("Location", "Struct", [prop("Location.Row", "Int", 1), prop("Location.Column", "Int", 2)]),
                prop("Animation", "Struct", [prop("Animation.FillLevel", "Struct", [prop("Animation.FillLevel.VerticalFill", "Int", binding("Var2"))])]),
              ],
              Children: [],
            },
            { Type: "Lamp", Name: "PumpLamp", Properties: [prop("Value", "Bool", binding("PumpRun")), prop("Text", "String", "Pump")], Children: [] },
          ],
        },
      ],
    },
  };
  const zip = new JSZip();
  zip.file("_metadata", JSON.stringify({ EncryptionInfo: null, SignatureInfo: null }));
  zip.file("Project.dat", JSON.stringify({ Brand: "Schneider", AppVersion: "3.1.100", Target: [{ Resolution: { Width: 480, Height: 272 } }] }));
  zip.file("Screens\\panel1.dat", JSON.stringify(screen));
  zip.file("Variables.db", db.export());
  db.close();
  return zip.generateAsync({ type: "uint8array" });
}

describe("scanning a typed-layout project", () => {
  it("reads screens, every object, bindings with their tags, and alarms with their triggers", async () => {
    const k = await scanProject(demo("HMICopilot_PumpStation.eote"), "HMICopilot_PumpStation.eote");
    expect(k.problems).toEqual([]);
    expect(k.source.layout).toBe("typed");
    expect(k.counts.screens).toBeGreaterThan(0);
    expect(k.counts.objects).toBe(k.screens.reduce((n, s) => n + s.objects.length, 0));
    expect(k.bindings.length).toBeGreaterThan(0);
    for (const b of k.bindings) {
      expect(k.variables.some((v) => v.name === b.tag)).toBe(true);
      expect(b.objectType).not.toBe("Unknown");
    }
    expect(k.alarms.every((a) => a.trigger && k.variables.some((v) => v.name === a.trigger))).toBe(true);
    expect(k.equipment.length).toBeGreaterThan(0);
    expect(k.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("records structure and names, never file contents", async () => {
    const k = await scanProject(demo("HMICopilot_PumpStation.eote"), "x.eote");
    const text = JSON.stringify(k);
    expect(text).not.toMatch(/SQLite format 3/);
    expect(Object.keys(k.tables["Variables.db"])).toContain("Variables");
  });
});

describe("scanning the older struct layout", () => {
  it("finds inline bindings, grid cells and variables by column name, and says it guessed the table", async () => {
    const k = await scanProject(await structProject(), "old.vxdz");
    expect(k.source).toMatchObject({ layout: "struct", appVersion: "3.1.100" });
    expect(k.target).toEqual({ model: "unknown", width: 480, height: 272 });
    expect(k.variables.map((v) => v.name)).toEqual(["Var2", "PumpRun"]);
    expect(k.problems.some((p) => /variable_root by column names/.test(p))).toBe(true);
    expect(k.bindings).toEqual([
      expect.objectContaining({ tag: "Var2", objectType: "Rectangle", property: "Animation.FillLevel.VerticalFill", via: "inline", dataType: "INT" }),
      expect.objectContaining({ tag: "PumpRun", objectType: "Lamp", property: "Value", via: "inline", dataType: "BOOL" }),
    ]);
    const fill = k.screens[0].objects.find((o) => o.name === "TankFill");
    expect(fill).toMatchObject({ depth: 1, cell: { row: 1, column: 2 } });
    expect(k.screens[0].rootType).toBe("Canvas");
    expect(k.screens[0].bound).toBe(2);
  });
});

describe("conventions", () => {
  it("ranks how each kind of tag is bound, with its support", async () => {
    const records = await Promise.all(["HMICopilot_PumpStation.eote", "HMICopilot_Bars.eote", "HMICopilot_TS.eote"].map(async (n) => scanProject(demo(n), n)));
    const c = aggregate(records);
    expect(c.projects).toBe(3);
    const run = precedentFor(c, "PMP_999_RUN", "BOOL");
    expect(run?.by).toBe("role");
    expect(run?.ranked[0].target).toBe("Lamp.CurrentValue");
    expect(run?.ranked[0].projects).toBeGreaterThanOrEqual(2);
    // An unknown word falls back to the data type.
    expect(precedentFor(c, "XYZ_1_QQQ", "REAL")?.by).toBe("dataType");
    expect(precedentFor(c, "Q", "WSTRING")).toBeNull();
    expect(c.screens.count).toBe(records.reduce((n, r) => n + r.screens.length, 0));
  });

  it("finds example screens that use the parts asked for", async () => {
    const records = [await scanProject(demo("HMICopilot_Bars.eote"), "Bars.eote")];
    const hits = exampleScreens(records, { partTypes: ["Lamp", "NumericDisplay"] });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.types.Lamp && h.types.NumericDisplay)).toBe(true);
    expect(exampleScreens(records, { equipment: ["centrifuge"] })).toEqual([]);
  });

  it("describes naming habits", () => {
    const n = namingStats(["PMP_101_RUN", "PMP_101_FLT", "FT_101_PV", "tankLevel", "Var2"]);
    expect(n.separators["_"]).toBe(3);
    expect(n.separators.camel).toBe(1);
    expect(n.prefixes.PMP).toBe(2);
    expect(n.suffixes.RUN).toBe(1);
  });
});

describe("the store", () => {
  let dir: string;
  const env = { ...process.env };
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "hmic-knowledge-"));
    process.env.KNOWLEDGE_DIR = dir;
    process.env.KNOWLEDGE_STORE = "filesystem";
  });
  afterAll(() => {
    process.env = env;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps one record per file, lists it, and forgets it on request", async () => {
    expect(knowledgeStore()).toBe("filesystem");
    const k = await scanProject(demo("HMICopilot_Minimal.eote"), "Minimal.eote");
    expect(await putKnowledge(k)).toEqual({ id: k.id, isNew: true });
    expect(await putKnowledge(k)).toEqual({ id: k.id, isNew: false });
    fs.writeFileSync(path.join(dir, `${"0".repeat(64)}.json`), "{ half a record");
    expect((await allKnowledge()).map((r) => r.id)).toEqual([k.id]);
    expect((await getKnowledge(k.id))?.fileName).toBe("Minimal.eote");
    expect(await getKnowledge("../../etc/passwd")).toBeNull();
    expect(await deleteKnowledge(k.id)).toBe(true);
    expect(await getKnowledge(k.id)).toBeNull();
  });

  it("is off by default when a shared database is configured", () => {
    const before = { ...process.env };
    delete process.env.KNOWLEDGE_STORE;
    process.env.MONGODB_URI = "mongodb://example.invalid";
    try {
      expect(knowledgeStore()).toBe("off");
    } finally {
      process.env = before;
    }
  });
});
