/**
 * Compound objects: read, edit, write and build .co files (lib/ote/co.ts,
 * lib/ote/co-build.ts, docs/CO_FORMAT.md).
 *
 * The fixture is HMICopilot_PumpSpeed.co from demo_objects/, which this
 * project generated in September and the licensed editor imported. The
 * rename expectations are what that editor wrote when it imported the file
 * under a taken name: a new Id and the name with a "1" suffix.
 *
 * The corpus half reads the product's installed library and Schneider's
 * published set where they are on this machine, and skips where they are not:
 * those files are never copied into the repository.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import JSZip from "jszip";
import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import {
  CoFormatError,
  checkCo,
  coFolders,
  coProperties,
  coWiring,
  readCo,
  readCoPackage,
  renameCo,
  setCoValues,
  summarizeCo,
  writeCo,
  type CompoundObject,
} from "@/lib/ote/co";
import { buildCo } from "@/lib/ote/co-build";

const FIXTURE = resolve(process.cwd(), "../demo_objects/HMICopilot_PumpSpeed.co");
const fixture = () => readCo(new Uint8Array(readFileSync(FIXTURE)));
const BS = "\\";

const sameEntries = (a: CompoundObject, b: CompoundObject, except: string[] = []) =>
  [...a.entries].filter(([n]) => !except.includes(n.replace(/\\/g, "/"))).every(([n, bytes]) => {
    const other = b.entries.get(n);
    return !!other && Buffer.compare(Buffer.from(bytes), Buffer.from(other)) === 0;
  });

describe("reading a compound object", () => {
  it("models identity, properties and what each property drives", async () => {
    const co = await fixture();
    expect(co.objdef.Name).toBe("HMICopilot_PumpSpeed");
    expect(co.screen.Type).toBe("CompoundObject");
    expect(String(co.screen.UniqueId)).toBe(co.objdef.Id);

    const props = coProperties(co).filter((p) => !p.group).map((p) => `${p.path}:${p.type}`);
    expect(props).toEqual([
      "CurrentValue:Double",
      "Min:Double",
      "Max:Double",
      "InnerRadius:Double",
      "Colors.ForegroundFill:Brush",
      "Colors.BorderFill:Brush",
      "Colors.BackgroundFill:Brush",
    ]);
    expect(coProperties(co).find((p) => p.path === "InnerRadius")).toMatchObject({ min: 0, max: 99, value: 70 });

    const wires = coWiring(co);
    expect(wires).toContainEqual({ source: "CurrentValue", target: "Arch_Top", targetType: "Arch", targetProperty: "EndAngle", converter: "Scale_to_135_405", mode: 2 });
    expect(wires).toContainEqual(expect.objectContaining({ source: "Max", target: "Scale_to_135_405", targetType: "Converter", targetProperty: "FromMax" }));
    expect(wires).toContainEqual(expect.objectContaining({ source: "Colors.ForegroundFill", target: "Arch_Top", targetProperty: "Fill.@StructBindingValue" }));
    expect(checkCo(co)).toEqual([]);
    expect(summarizeCo(co)).toMatchObject({ layout: "grid", parts: { Grid: 1, Arch: 2 }, wires: 8, scripts: 0 });
  });

  it("refuses what is not a compound object, by name", async () => {
    await expect(readCo(new Uint8Array([1, 2, 3]))).rejects.toThrow(CoFormatError);
    const zip = new JSZip();
    zip.file("Screen.dat", JSON.stringify({ Type: "Screen" }));
    await expect(readCo(await zip.generateAsync({ type: "uint8array" }))).rejects.toThrow(/CompoundObject\.objdef is missing/);
  });
});

describe("writing it back", () => {
  it("gives every entry back byte for byte when nothing changed", async () => {
    const co = await fixture();
    const back = await readCo(await writeCo(co));
    expect(back.entries.size).toBe(co.entries.size);
    expect([...back.entries.keys()]).toEqual([...co.entries.keys()]);
    expect(sameEntries(co, back)).toBe(true);
  });

  it("keeps backslash entry names in the bytes", async () => {
    const bytes = await writeCo(await fixture());
    const raw = Buffer.from(bytes).toString("latin1");
    expect(raw).toContain(`Localization${BS}en-US.dat`);
    expect(raw).not.toContain("Localization/en-US.dat");
  });
});

describe("setting the values a definition carries", () => {
  it("changes Screen.dat only, in the style it was written", async () => {
    const co = await fixture();
    const before = new TextDecoder().decode(co.entries.get("Screen.dat")!);
    setCoValues(co, { CurrentValue: 40, InnerRadius: 50 });
    const back = await readCo(await writeCo(co));
    expect(back.screen.CurrentValue).toBe(40);
    expect(back.screen.InnerRadius).toBe(50);
    expect(sameEntries(co, back, ["Screen.dat"])).toBe(true);
    const after = new TextDecoder().decode(back.entries.get("Screen.dat")!);
    expect(after.includes("\r\n")).toBe(before.includes("\r\n"));
    expect(/\n( +)"/.exec(after)?.[1].length).toBe(/\n( +)"/.exec(before)?.[1].length);
  });

  it("refuses a value the property cannot hold", async () => {
    const co = await fixture();
    expect(() => setCoValues(co, { InnerRadius: 150 })).toThrow(/at most 99/);
    expect(() => setCoValues(co, { CurrentValue: "fast" })).toThrow(/not a number/);
    expect(() => setCoValues(co, { Colors: 1 })).toThrow(/groups other properties/);
    expect(() => setCoValues(co, { Speed: 1 })).toThrow(/has no property Speed; it has CurrentValue/);
  });
});

describe("renaming, as the licensed editor does on import", () => {
  const OTE_NAME = "HMICopilot_PumpSpeed1";
  const OTE_ID = "105f09aa-26c1-4849-82eb-26fbc4874f7a";

  it("rewrites the identity everywhere the editor rewrote it, and nowhere else", async () => {
    const co = await fixture();
    const oldId = co.objdef.Id;
    renameCo(co, OTE_NAME, OTE_ID);

    expect(co.objdef).toMatchObject({ Name: OTE_NAME, Id: OTE_ID });
    expect(co.screen).toMatchObject({ Name: OTE_NAME, SubType: OTE_NAME, UniqueId: OTE_ID });
    for (const s of co.bindings.Sources) expect(s).toMatchObject({ ObjectId: OTE_ID.toUpperCase(), SubType: OTE_NAME });
    const parts = co.bindings.Targets.filter((t) => t.ObjectType === 8);
    for (const t of parts) expect(t).toMatchObject({ ParentIds: OTE_ID.toUpperCase(), ScreenId: OTE_ID.toUpperCase() });
    const converter = co.bindings.Targets.find((t) => t.ObjectType === 19)!;
    expect(converter.ScreenId).toBeUndefined();

    const back = await readCo(await writeCo(co));
    expect(checkCo(back)).toEqual([]);
    for (const [name, bytes] of back.entries) {
      if (name.endsWith(".db")) continue;
      expect(new TextDecoder().decode(bytes).toLowerCase()).not.toContain(oldId.toLowerCase());
    }
  });

  it("refuses a name the product would refuse", async () => {
    const co = await fixture();
    expect(() => renameCo(co, "2Pump")).toThrow(CoFormatError);
    expect(() => renameCo(co, "Pump Speed")).toThrow(CoFormatError);
  });
});

describe("building one from nothing", () => {
  const spec = () => ({
    name: "HMICopilot_LevelBar",
    description: "Level bar with a high mark",
    layout: "grid" as const,
    width: 60,
    height: 200,
    parts: [
      { Type: "Rectangle", Name: "Bar_Back", Location: { RowSpan: 10, ColumnSpan: 8 }, Fill: { Color: { ColorIndexEnabled: false, Value: 0xd9d9d9 } } },
      { Type: "Rectangle", Name: "Bar_Fill", Location: { RowSpan: 10, ColumnSpan: 8 }, Animation: { FillLevel: { Enable: true, VerticalFill: 50 } } },
    ],
    properties: [
      { name: "CurrentValue", type: "Double", label: "Current Value", value: 50 },
      { name: "Min", type: "Double", constant: true, value: 0 },
      { name: "Max", type: "Double", constant: true, value: 100 },
      { name: "Colors", type: "Struct", children: [{ name: "ForegroundFill", type: "Brush", label: "Bar" }] },
    ],
    wires: [
      { property: "CurrentValue", part: "Bar_Fill", partProperty: "Animation.FillLevel.VerticalFill", scale: "Scale_to_0_100" },
      { property: "Colors.ForegroundFill", part: "Bar_Fill", partProperty: "Fill" },
    ],
    scales: [{ name: "Scale_to_0_100", to: [0, 100] as [number, number], fromMin: "Min", fromMax: "Max" }],
  });

  it("writes an object our reader models and the invariants hold for", async () => {
    const bytes = await buildCo(spec());
    const co = await readCo(bytes);
    expect(checkCo(co)).toEqual([]);
    expect(co.objdef).toMatchObject({ Name: "HMICopilot_LevelBar", LayoutType: 0, AppBrand: "Schneider", ModifiedAppVersion: "4.4.20.0" });
    expect(co.screen).toMatchObject({ DesignWidth: 60, DesignHeight: 200, CurrentValue: 50, Min: 0, Max: 100 });
    expect([...co.entries.keys()].map((n) => n.replace(/\\/g, "/"))).toEqual([
      "Bindings.dat", "CompoundObject.objdef", "CompoundObjectSettings.dat", "Converters.db", "LocalVariables.db",
      "Properties.propDef", "Resources.dat", "Screen.dat", "Validations.db",
      ...["de-DE", "en-US", "es-ES", "fr-FR", "it-IT", "ja-JP", "ko-KR", "pt-BR", "zh-CHS", "zh-CHT"].map((l) => `Localization/${l}.dat`),
      "_metadata",
    ]);
    expect(Buffer.from(bytes).toString("latin1")).toContain(`Localization${BS}en-US.dat`);

    const wires = coWiring(co);
    expect(wires).toContainEqual(expect.objectContaining({ source: "CurrentValue", target: "Bar_Fill", targetProperty: "Animation.FillLevel.VerticalFill", converter: "Scale_to_0_100", mode: 2 }));
    expect(wires).toContainEqual(expect.objectContaining({ source: "Colors.ForegroundFill", target: "Bar_Fill", targetProperty: "Fill.@StructBindingValue", mode: 1 }));
    expect(wires).toContainEqual(expect.objectContaining({ source: "Max", target: "Scale_to_0_100", targetProperty: "FromMax" }));
    const fill = (co.screen.Children![0].Children!.find((p) => p.Name === "Bar_Fill") as Record<string, { "@StructBindingValue"?: null }>).Fill;
    expect(fill).toHaveProperty("@StructBindingValue", null);
    expect(coProperties(co).find((p) => p.path === "CurrentValue")?.label).toBe("Current Value");
  });

  it("puts the converter in Converters.db, in the product's schema and WAL mode", async () => {
    const co = await readCo(await buildCo(spec()));
    const dbBytes = co.entries.get("Converters.db")!;
    expect([dbBytes[18], dbBytes[19]]).toEqual([2, 2]);
    const SQL = await initSqlJs();
    const db = new SQL.Database(new Uint8Array(dbBytes));
    const rows = db.exec(`SELECT "Name","Order","ConverterType","Data" FROM "Converters"`)[0].values;
    db.close();
    expect(rows).toHaveLength(1);
    expect(rows[0].slice(0, 3)).toEqual(["Scale_to_0_100", 1, "Scale"]);
    expect(JSON.parse(String(rows[0][3]))).toMatchObject({ SubType: "Scale", FromMin: 0, FromMax: 100, ToMin: 0, ToMax: 100 });
  });

  it("refuses a wire to a part or property that is not there, and duplicate part names", async () => {
    await expect(buildCo({ ...spec(), wires: [{ property: "Speed", part: "Bar_Fill", partProperty: "Fill" }] })).rejects.toThrow(/Speed, which is not an exposed property/);
    await expect(buildCo({ ...spec(), wires: [{ property: "CurrentValue", part: "Needle", partProperty: "Angle" }] })).rejects.toThrow(/Needle, which is not a part/);
    const s = spec();
    s.parts[1].Name = "Bar_Back";
    await expect(buildCo(s)).rejects.toThrow(/two parts are called Bar_Back/);
    await expect(buildCo({ ...spec(), name: "Level Bar" })).rejects.toThrow(CoFormatError);
  });
});

/* ------------------------------------------------------------------ */

const INSTALL_PKG = "C:/Program Files/Schneider Electric/EcoStruxure Operator Terminal Expert 4.4/Buildtime/TemplateCOs/COs.pkg";
const PUBLISHED = join(homedir(), "Downloads", "Compound Object");

describe.skipIf(!existsSync(INSTALL_PKG))("the installed library", () => {
  it("reads all 14, foldered, consistent, and writes each back entry-identical", async () => {
    const pkg = await readCoPackage(new Uint8Array(readFileSync(INSTALL_PKG)));
    expect(pkg.objects).toHaveLength(14);
    const folders = coFolders(pkg.hierarchy);
    expect(new Set(folders.values())).toEqual(new Set(["BarGraphs", "Gauges"]));
    for (const co of pkg.objects) {
      expect(checkCo(co), co.objdef.Name).toEqual([]);
      expect(sameEntries(co, await readCo(await writeCo(co))), co.objdef.Name).toBe(true);
    }
  });
});

describe.skipIf(!existsSync(PUBLISHED))("Schneider's published set", () => {
  it("reads every object, consistent, entry-identical on write, and still consistent after a rename", async () => {
    const files = readdirSync(PUBLISHED).filter((f) => f.endsWith(".co"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const co = await readCo(new Uint8Array(readFileSync(join(PUBLISHED, f))));
      expect(checkCo(co), f).toEqual([]);
      expect(sameEntries(co, await readCo(await writeCo(co))), f).toBe(true);
      renameCo(co, `${co.objdef.Name}_Copy`);
      expect(checkCo(await readCo(await writeCo(co))), f).toEqual([]);
    }
  });
});
