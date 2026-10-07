/**
 * The older project layout (3.1 - 3.3), converted. lib/ote/struct.ts.
 *
 * The fixture is built here, property record by property record, in the shape
 * docs/VXDZ_FINDINGS.md §2 documents from the real files - Schneider's own
 * templates never enter the repository. The corpus tests at the bottom run
 * against them where they are on disk.
 */

import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/ote/packager";
import { layoutOf } from "@/lib/ote/reader";
import { readStructProject, stableId, unprop } from "@/lib/ote/struct";

const prop = (FullName: string, Type: string, Value: unknown) => ({
  Name: FullName.split(".").pop()!,
  FullName,
  Type,
  Value,
});
const color = (at: string, index: number) => prop(at, "Color", [prop(`${at}.Value`, "Int", index)]);
const brush = (at: string, index: number) => prop(at, "Brush", [color(`${at}.Color`, index)]);

async function database(statements: string[]): Promise<Uint8Array> {
  const db = await openDatabase(new Uint8Array());
  for (const s of statements) db.run(s);
  const bytes = db.export();
  db.close();
  return bytes;
}

async function structProject() {
  const zip = new JSZip();
  zip.file(
    "Project.dat",
    JSON.stringify({ Brand: "Schneider", AppVersion: "3.1.100", Target: [{ Resolution: { Width: 800, Height: 480 } }] }),
  );
  zip.file(
    "Target.dat",
    JSON.stringify({ Type: "Target", Properties: [prop("TargetInfo", "TargetInfo", [prop("TargetInfo.RuntimeModel", "String", "HMIST6400")])] }),
  );
  zip.file("hierarchy.inf", JSON.stringify({ Hierarchy: { Folder: true, Children: [{ Folder: false, PanelID: 1, Name: "Main" }] } }));
  zip.file("contents.inf", JSON.stringify({ Hierarchy: { Folder: true, Children: [] } }));
  zip.file(
    "Screens/panel1.dat",
    JSON.stringify({
      Type: "Screen",
      Name: "Main",
      Properties: [prop("ScreenID", "Int", 1)],
      GraphicalObjects: {
        Type: "Canvas",
        Name: "Canvas",
        Properties: [],
        Children: [
          {
            Type: "Rectangle",
            Name: "Panel",
            Properties: [
              prop("Location", "Struct", [prop("Location.Left", "Int", 10), prop("Location.Top", "Int", 20)]),
              prop("Width", "Int", 200),
              prop("Height", "Int", 100),
              brush("Fill", 22),
            ],
          },
          {
            Type: "Grid",
            Name: "Grid1",
            Properties: [
              prop("Location", "Struct", [prop("Location.Left", "Int", 400), prop("Location.Top", "Int", 0)]),
              prop("Width", "Int", 400),
              prop("Height", "Int", 200),
              prop("Rows", "List", [{ Value: [prop("Rows.0.Height", "String", "50")] }, { Value: [] }]),
              prop("Columns", "List", [{ Value: [] }, { Value: [] }]),
            ],
            Children: [
              {
                Type: "NumericDisplay",
                Name: "Speed",
                Properties: [
                  prop("Location", "Struct", [prop("Location.Row", "Int", 1), prop("Location.Column", "Int", 1)]),
                  brush("TextColor", 1),
                  prop("Font", "Struct", [
                    prop("Font.Type", "Enum", { Type: "Resource", ResourceType: "FontType", Source: { FontType: 0, Type: "FontType" } }),
                  ]),
                  prop("Value", "Double", {
                    Type: "Binding",
                    BindingType: "Variable",
                    Source: { VariableName: "MotorSpeed", Property: "Value", Expression: -1, Type: "IdentifierName", ObjectType: "Variable" },
                    FallbackValue: 0,
                    Mode: "TwoWay",
                    Converter: null,
                  }),
                ],
              },
            ],
          },
        ],
      },
    }),
  );
  zip.file(
    "Variables.db",
    await database([
      'CREATE TABLE VariableFolderList (id INTEGER, Name TEXT, TableName TEXT, Offset INTEGER, Count INTEGER)',
      "INSERT INTO VariableFolderList VALUES (1, '', 'variable_root', 1, 2)",
      'CREATE TABLE variable_root (id INTEGER, Name TEXT, Type INTEGER, Source TEXT, Address TEXT, TypeName TEXT)',
      "INSERT INTO variable_root VALUES (1, 'MotorSpeed', 4, 'Internal', '', 'INT')",
      "INSERT INTO variable_root VALUES (2, 'Running', 1, 'Internal', '%M10', 'BOOL')",
    ]),
  );
  zip.file(
    "Alarm.db",
    await database([
      'CREATE TABLE alarm_definition (alarm_id INTEGER, group_id INTEGER, type_id INTEGER, variable TEXT, variable_id INTEGER, equ_name TEXT, msg TEXT, msg_index INTEGER, severity INTEGER, parameter INTEGER)',
      "INSERT INTO alarm_definition VALUES (1, 3, 1, 'Running', 2, 'Internal', 'Motor stopped', NULL, 2, 0)",
      "INSERT INTO alarm_definition VALUES (2, 3, 2, 'MotorSpeed', 1, 'Internal', 'Speed high', NULL, 5, 0)",
      'CREATE TABLE bool_alarm (alarm_id INTEGER, condition INTEGER)',
      'INSERT INTO bool_alarm VALUES (1, 0)',
      'CREATE TABLE level_alarm (alarm_id INTEGER, level TEXT, deadband INTEGER)',
      "INSERT INTO level_alarm VALUES (2, '90', 0)",
    ]),
  );
  return zip.generateAsync({ type: "uint8array" });
}

describe("property records", () => {
  it("fold into the typed layout's keys", () => {
    expect(
      unprop([
        prop("Location", "Struct", [prop("Location.Row", "Int", 2)]),
        brush("Fill", 22),
        prop("Rows", "List", [{ Value: [prop("Rows.0.Height", "String", "30")] }, { Value: [] }]),
      ]),
    ).toEqual({ Location: { Row: 2 }, Fill: { Color: { Value: 22 } }, Rows: [{ Height: "30" }, {}] });
  });

  it("give a bound property its fallback and report the binding", () => {
    const bindings: { property: string; bindingType: string; variable?: string }[] = [];
    const out = unprop(
      [prop("Animation.FillLevel.VerticalFill", "Int", { Type: "Binding", BindingType: "Variable", Source: { VariableName: "Level" }, FallbackValue: 100 })],
      bindings,
    );
    expect(out).toEqual({ VerticalFill: 100 });
    expect(bindings).toEqual([{ property: "Animation.FillLevel.VerticalFill", bindingType: "Variable", variable: "Level" }]);
  });

  it("make stable ids the schema accepts", () => {
    expect(stableId("a")).toBe(stableId("a"));
    expect(stableId("a")).not.toBe(stableId("b"));
    expect(stableId("a")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("a 3.1 project", () => {
  it("is recognised as the older layout", async () => {
    expect(await layoutOf(await structProject())).toBe("struct");
  });

  it("opens with its screen, parts at their places, variables, alarms and wires", async () => {
    const read = await readStructProject(await structProject(), "Pump.vxdz");
    expect(read.target).toEqual({ model: "HMIST6400", width: 800, height: 480 });
    expect(read.screens).toHaveLength(1);
    const parts = read.screens[0].Children[0].Children;
    const panel = parts.find((p) => p.Name === "Panel")!;
    expect(panel.Location).toEqual({ Left: 10, Top: 20 });
    // In the grid: row 1 starts after the 50px row, column 1 halfway across.
    const speed = parts.find((p) => p.Name === "Speed")!;
    expect(speed.Location).toEqual({ Left: 600, Top: 50 });
    expect([speed.Width, speed.Height]).toEqual([200, 150]);
    expect(read.wires).toEqual([expect.objectContaining({ tag: "MotorSpeed", property: "Value" })]);
    expect(read.variables.map((v) => [v.Name, v.DataType, v.DeviceAddress])).toEqual([
      ["MotorSpeed", "INT", ""],
      ["Running", "BOOL", "%M10"],
    ]);
    expect(read.alarms).toEqual([
      expect.objectContaining({ Trigger: "Running", AlarmRecordType: 1, AlarmType: 1, Value: "0" }),
      expect.objectContaining({ Trigger: "MotorSpeed", AlarmRecordType: 2, AlarmType: 2, Value: "90" }),
    ]);
    expect(read.warnings[0]).toMatch(/Converted from the 3\.1\.100 project layout/);
  });
});

/** The real corpus, where it is on disk; skipped everywhere else. */
const CORPUS = "C:/Users/shaur/Downloads/EOTE_Template_v7";
const corpus = fs.existsSync(CORPUS) ? describe : describe.skip;

corpus("the struct half of the template corpus", () => {
  it("opens every one of the 85 files, with every screen it lists", async () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".vxdz")) files.push(p);
      }
    };
    walk(CORPUS);
    let struct = 0;
    for (const file of files) {
      const bytes = new Uint8Array(fs.readFileSync(file));
      if ((await layoutOf(bytes)) !== "struct") continue;
      struct++;
      const read = await readStructProject(bytes, path.basename(file));
      expect(read.screens.length, file).toBeGreaterThan(0);
    }
    expect(struct).toBe(85);
  }, 300_000);
});
