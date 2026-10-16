/**
 * A compound object from nothing: no template, no shipped object to copy.
 *
 * lib/ote/co.ts reads and edits the product's .co files; this writes a new
 * one from a description - the parts, the exposed properties and which part
 * property each one drives - in exactly the shape the samples hold
 * (docs/CO_FORMAT.md). The three SQLite files are created empty with the
 * product's own schemas, and a Scale converter becomes a row in
 * Converters.db plus a Target the Min and Max properties feed, the way the
 * shipped gauges and bar graphs do it.
 *
 * Node only: sql.js writes the databases.
 */

import JSZip from "jszip";
import { sqlEngine } from "./packager";
import {
  CO_LOCALES,
  CoFormatError,
  assertCoEntries,
  readCo,
  type CoBinding,
  type CoBindings,
  type CoNode,
  type CoPropDef,
  type CoSource,
  type CoTarget,
  type CompoundObject,
} from "./co";

export interface CoPropertySpec {
  name: string;
  /** Double, Int32, Boolean, String, Brush, Color, FontNameList... or Struct with children. */
  type: string;
  default?: unknown;
  /** The value this definition carries; written at the Screen.dat root. */
  value?: unknown;
  label?: string;
  description?: string;
  /** Where the editor lists it. Defaults to Function / Basic, Shape / Basic for brushes. */
  category?: [string, string];
  min?: number;
  max?: number;
  /** Constant-only (a range end, not something a tag drives). */
  constant?: boolean;
  children?: CoPropertySpec[];
}

export interface CoScaleSpec {
  /** Unique within the object, e.g. "Scale_to_135_405". */
  name: string;
  to: [number, number];
  /** Exposed properties that set the input range; their values are the defaults. */
  fromMin?: string;
  fromMax?: string;
}

export interface CoWireSpec {
  /** Exposed property path, "CurrentValue" or "Colors.ForegroundFill". */
  property: string;
  /** Name of the part it drives. */
  part: string;
  /** The part's property, "EndAngle". A Brush wires to "<prop>.@StructBindingValue" by itself. */
  partProperty: string;
  /** Through a Scale converter, by its name. */
  scale?: string;
}

export interface CoSpec {
  name: string;
  id?: string;
  description?: string;
  /** "grid": a Grid of rows and columns (LayoutType 0); "viewbox": a ViewBox that scales (8). */
  layout: "grid" | "viewbox";
  width?: number;
  height?: number;
  /** The parts. Under a Grid they place by Location Row/Column spans; under a ViewBox by Left/Top. */
  parts: CoNode[];
  /** Grid size, when layout is grid. The samples use 10 rows by 8 columns. */
  grid?: { rows: number; columns: number };
  properties: CoPropertySpec[];
  wires: CoWireSpec[];
  scales?: CoScaleSpec[];
  /** Stamped as ModifiedAppVersion. The licensed editor restamps on import. */
  appVersion?: string;
}

const uuid = () => crypto.randomUUID();
const BINDING_METADATA = (constantOnly: boolean) => ({
  BindToObject: false,
  AllowConverter: true,
  AllowIndirectBinding: true,
  CanRemoveBinding: true,
  CanShowBindingMarker: true,
  AllowCountBinding: false,
  AllowedValueType: constantOnly ? "Constant" : "Alarm, Variable, GraphicObject, Target, Recipe, LocalVariable, Equipment, Constant",
  SupportedTypes: "",
});

/** Struct-valued properties: they bind to "<prop>.@StructBindingValue" on the part. */
const BRUSHES = new Set(["Brush", "Brush_NoneSolidBlink", "Color"]);
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function propDefOf(p: CoPropertySpec): CoPropDef {
  if (!NAME.test(p.name)) throw new CoFormatError(`property name ${p.name} is not one the product accepts`);
  if (p.children?.length) {
    return {
      Id: uuid(),
      PropertyName: p.name,
      PropertyType: "Struct",
      WriteMode: "None",
      SupportedBindingMode: "None",
      AllowAsBindingSource: false,
      PresentationType: "",
      AltDescriptionLocalizationKey: null,
      BindingMetadata: { ...BINDING_METADATA(false), AllowedValueType: "None" },
      Children: p.children.map(propDefOf),
      ListStartIndex: 0,
    };
  }
  const brush = BRUSHES.has(p.type);
  const [first, second] = p.category ?? (brush ? ["Shape", "Basic"] : ["Function", "Basic"]);
  const validation: NonNullable<CoPropDef["ValidationInfo"]> = [];
  if (!brush && p.type !== "String") validation.push({ Type: "Required" });
  if (p.min !== undefined || p.max !== undefined) {
    validation.push({ Type: "Range", Parameters: { ...(p.min !== undefined ? { Min: { Value: p.min } } : {}), ...(p.max !== undefined ? { Max: { Value: p.max } } : {}) } });
  }
  if (brush) {
    return {
      Id: uuid(),
      PropertyName: p.name,
      PropertyType: p.type,
      WriteMode: "None",
      SupportedBindingMode: "None",
      AllowAsBindingSource: false,
      PresentationType: p.type === "Color" ? "" : "FillBrushDisplay",
      FirstLevelCategory: first,
      SecondLevelCategory: second,
      AltDescriptionLocalizationKey: null,
      BindingMetadata: { ...BINDING_METADATA(false), AllowedValueType: "None" },
      ListStartIndex: 0,
    };
  }
  return {
    Id: uuid(),
    PropertyName: p.name,
    PropertyType: p.type,
    DefaultValue: p.default ?? defaultFor(p.type),
    ...(p.constant ? { WriteMode: "Constant", SupportedBindingMode: "OneWay" } : {}),
    PresentationType: "",
    FirstLevelCategory: first,
    SecondLevelCategory: second,
    AltDescriptionLocalizationKey: null,
    BindingMetadata: BINDING_METADATA(!!p.constant),
    ...(p.constant ? {} : { SupportedBindingSources: "CompoundObject, defaultWithLocalVariable" }),
    ...(validation.length ? { ValidationInfo: validation } : {}),
    ListStartIndex: 0,
  };
}

function defaultFor(type: string): unknown {
  if (type === "Boolean") return false;
  if (type === "String") return "";
  if (/^U?Int|^Double$|^Single$|^Decimal$/.test(type)) return 0;
  return null;
}

/** Writes a new .co and returns its bytes. Reads its own output back before returning. */
export async function buildCo(spec: CoSpec): Promise<Uint8Array> {
  if (!NAME.test(spec.name)) throw new CoFormatError(`${spec.name} is not a name the product accepts (letters, digits, _; not starting with a digit)`);
  const id = (spec.id ?? uuid()).toLowerCase();
  const ID = id.toUpperCase();

  // --- the tree ------------------------------------------------------
  const named = new Map<string, CoNode>();
  const stamp = (n: CoNode) => {
    if (!n.UniqueId) n.UniqueId = uuid();
    if (n.Name) {
      if (named.has(n.Name)) throw new CoFormatError(`two parts are called ${n.Name}; a binding finds its part by name`);
      named.set(n.Name, n);
    }
    for (const c of n.Children ?? []) stamp(c);
  };
  const parts = structuredClone(spec.parts);
  parts.forEach(stamp);
  const container: CoNode =
    spec.layout === "grid"
      ? {
          Type: "Grid",
          UniqueId: uuid(),
          Name: "Grid",
          Options: 104,
          Rows: Array.from({ length: spec.grid?.rows ?? 10 }, () => ({})),
          Columns: Array.from({ length: spec.grid?.columns ?? 8 }, () => ({})),
          Fill: { Type: 0 },
          Children: parts,
        }
      : { Type: "ViewBox", UniqueId: uuid(), Name: "ViewBox", Options: 104, Fill: { Type: 0 }, Children: parts };

  // --- properties ----------------------------------------------------
  const properties = spec.properties.map(propDefOf);
  const leaves = new Map<string, { def: CoPropDef; spec: CoPropertySpec }>();
  const index = (defs: CoPropDef[], specs: CoPropertySpec[], prefix: string) => {
    defs.forEach((d, i) => {
      const path = prefix + d.PropertyName;
      if (d.Children?.length) index(d.Children, specs[i].children!, path + ".");
      else leaves.set(path, { def: d, spec: specs[i] });
    });
  };
  index(properties, spec.properties, "");

  const screen: CoNode = { Type: "CompoundObject", SubType: spec.name, UniqueId: id, Name: spec.name };
  if (spec.description) screen.Description = spec.description;
  if (spec.width !== undefined) screen.DesignWidth = spec.width;
  if (spec.height !== undefined) screen.DesignHeight = spec.height;
  for (const [path, { spec: p }] of leaves) {
    if (p.value === undefined) continue;
    let node = screen as Record<string, unknown>;
    const keys = path.split(".");
    for (const k of keys.slice(0, -1)) node = (node[k] ??= {}) as Record<string, unknown>;
    node[keys[keys.length - 1]] = p.value;
  }
  screen.Children = [container];

  // --- converters ----------------------------------------------------
  const scales = new Map<string, { id: string; spec: CoScaleSpec }>();
  for (const s of spec.scales ?? []) {
    if (scales.has(s.name)) throw new CoFormatError(`two converters are called ${s.name}`);
    scales.set(s.name, { id: uuid(), spec: s });
  }

  // --- bindings --------------------------------------------------------
  const bindings: CoBindings = { Sources: [], Targets: [], Bindings: [] };
  const sourceOf = new Map<string, number>();
  const source = (path: string): number => {
    if (!leaves.has(path)) throw new CoFormatError(`a wire reads ${path}, which is not an exposed property`);
    let ref = sourceOf.get(path);
    if (ref === undefined) {
      ref = bindings.Sources.length;
      sourceOf.set(path, ref);
      const s: CoSource = { ObjectType: 16, SubType: spec.name, ReferenceId: ref, ObjectId: ID, ObjectFullName: "CompoundObject", PropertyFullName: path };
      bindings.Sources.push(s);
    }
    return ref;
  };
  const targetOf = new Map<string, number>();
  const partTarget = (name: string): number => {
    const part = named.get(name);
    if (!part) throw new CoFormatError(`a wire drives ${name}, which is not a part of this object`);
    let ref = targetOf.get(name);
    if (ref === undefined) {
      ref = bindings.Targets.length;
      targetOf.set(name, ref);
      const t: CoTarget = { ObjectType: 8, SubType: part.Type, ReferenceId: ref, ObjectId: part.UniqueId, ParentIds: ID, ScreenId: ID, ObjectFullName: name };
      bindings.Targets.push(t);
    }
    return ref;
  };
  const scaleTarget = (name: string): number => {
    const key = `scale:${name}`;
    let ref = targetOf.get(key);
    if (ref === undefined) {
      ref = bindings.Targets.length;
      targetOf.set(key, ref);
      bindings.Targets.push({ ObjectType: 19, SubType: "Scale", ReferenceId: ref, ObjectId: scales.get(name)!.id, ObjectFullName: name });
    }
    return ref;
  };
  const bind = (path: string, target: number, targetProperty: string, mode: number, converter?: { id: string; name: string }) => {
    const b: CoBinding = {
      Type: 15,
      Mode: mode,
      BindingText: `$CO.${path}`,
      ConverterId: converter?.id ?? null,
      ConverterName: converter?.name ?? null,
      Target: target,
      TargetProperty: targetProperty,
      Sources: String(source(path)),
    };
    bindings.Bindings.push(b);
  };

  for (const w of spec.wires) {
    const leaf = leaves.get(w.property);
    if (!leaf) throw new CoFormatError(`a wire reads ${w.property}, which is not an exposed property`);
    const brush = BRUSHES.has(leaf.def.PropertyType);
    const target = partTarget(w.part);
    const prop = brush && !w.partProperty.endsWith(".@StructBindingValue") ? `${w.partProperty}.@StructBindingValue` : w.partProperty;
    if (brush) {
      // The part keeps an explicit slot the brush lands in, as every sample does.
      // At the full path: Fill, or Animation.FillLevel.BackColor.
      let node = named.get(w.part)! as Record<string, unknown>;
      for (const key of prop.replace(/\.@StructBindingValue$/, "").split(".")) {
        if (!node[key] || typeof node[key] !== "object") node[key] = {};
        node = node[key] as Record<string, unknown>;
      }
      node["@StructBindingValue"] = null;
    }
    let converter: { id: string; name: string } | undefined;
    if (w.scale) {
      const s = scales.get(w.scale);
      if (!s) throw new CoFormatError(`a wire uses converter ${w.scale}, which is not declared`);
      converter = { id: s.id, name: w.scale };
    }
    bind(w.property, target, prop, brush ? 1 : 2, converter);
  }
  for (const [name, { spec: s }] of scales) {
    if (s.fromMax) bind(s.fromMax, scaleTarget(name), "FromMax", 1);
    if (s.fromMin) bind(s.fromMin, scaleTarget(name), "FromMin", 1);
  }

  // --- localization -------------------------------------------------
  const labels: { PropertyId: string; Name: string | null; Description: string | null }[] = [];
  const label = (defs: CoPropDef[], specs: CoPropertySpec[]) =>
    defs.forEach((d, i) => {
      if (specs[i].label || specs[i].description) labels.push({ PropertyId: d.Id, Name: specs[i].label ?? null, Description: specs[i].description ?? null });
      if (d.Children?.length) label(d.Children, specs[i].children!);
    });
  label(properties, spec.properties);

  // --- databases ----------------------------------------------------
  const SQL = await sqlEngine();
  const database = (schema: string[], fill?: (db: import("sql.js").Database) => void) => {
    const db = new SQL.Database();
    for (const statement of schema) db.run(statement);
    fill?.(db);
    const bytes = db.export();
    db.close();
    // The product's files are in WAL mode (header bytes 18 and 19 are 2).
    bytes[18] = 2;
    bytes[19] = 2;
    return bytes;
  };
  const converters = database(CONVERTERS_SCHEMA, (db) => {
    let order = 1;
    for (const [name, { id: cid, spec: s }] of scales) {
      const fromMax = s.fromMax ? Number(leaves.get(s.fromMax)?.spec.value ?? leaves.get(s.fromMax)?.spec.default ?? 100) : 100;
      const fromMin = s.fromMin ? Number(leaves.get(s.fromMin)?.spec.value ?? leaves.get(s.fromMin)?.spec.default ?? 0) : 0;
      const data = { Type: "Converter", SubType: "Scale", UniqueId: cid, Name: name, Order: order, FromMin: fromMin, FromMax: fromMax, ToMin: s.to[0], ToMax: s.to[1] };
      db.run(`INSERT INTO "Converters" ("UniqueId","Name","Order","ConverterType","Description","Data") VALUES (?,?,?,?,?,?)`, [cid.toUpperCase(), name, order, "Scale", "", JSON.stringify(data)]);
      order++;
    }
  });

  // --- archive ------------------------------------------------------
  const crlf = (v: unknown) => new TextEncoder().encode(JSON.stringify(v, null, 2).replace(/\n/g, "\r\n"));
  const lf = (v: unknown) => new TextEncoder().encode(JSON.stringify(v, null, 2));
  const line = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
  const now = new Date().toISOString().replace(/(\.\d{3})Z$/, "$10000Z");
  const entries: [string, Uint8Array][] = [
    ["Bindings.dat", crlf(bindings)],
    [
      "CompoundObject.objdef",
      crlf({
        LayoutType: spec.layout === "grid" ? 0 : 8,
        CreatedDate: now,
        ModifiedDate: now,
        ModifiedAppVersion: spec.appVersion ?? "4.4.20.0",
        AppBrand: "Schneider",
        ScriptMode: 0,
        ErrorLevel: 0,
        CommitId: uuid().toUpperCase(),
        Name: spec.name,
        Id: id,
      }),
    ],
    ["CompoundObjectSettings.dat", line({ Type: "CompoundObjectSettings", UniqueId: uuid(), Name: "CompoundObjectSettings" })],
    ["Converters.db", converters],
    ["LocalVariables.db", database(LOCAL_VARIABLES_SCHEMA)],
    ["Properties.propDef", crlf(properties)],
    ["Resources.dat", line({})],
    ["Screen.dat", line(screen)],
    ["Validations.db", database(VALIDATIONS_SCHEMA)],
    ...CO_LOCALES.map((locale): [string, Uint8Array] => [
      `Localization\\${locale}.dat`,
      lf({
        TypeLocalizationInfo: { Name: null, Description: locale === "en-US" ? spec.description ?? null : null },
        PropertiesLocalizationInfo: locale === "en-US" ? labels : [],
      }),
    ]),
    ["_metadata", crlf({ EncryptionInfo: null, SignatureInfo: null, AdditionalMetadata: {}, Hint: null })],
  ];
  const zip = new JSZip();
  for (const [name, bytes] of entries) zip.file(name, bytes, { createFolders: false, binary: true });
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 }, platform: "DOS" });
  assertCoEntries(bytes, entries.map(([n]) => n));
  await readCo(bytes); // refuse to hand over a file our own reader rejects
  return bytes;
}

/** Build and read back, for callers that want the model. */
export async function buildCoModel(spec: CoSpec): Promise<CompoundObject> {
  return readCo(await buildCo(spec));
}

/* The product's schemas, as its own files declare them (Converters.db,
   LocalVariables.db and Validations.db inside every sample). The views call
   functions the product registers at run time; SQLite resolves those only
   when a view is queried, so declaring them here is safe. */

const CONVERTERS_SCHEMA = [
  `CREATE TABLE "Converters" (
    "UniqueId" TEXT NOT NULL CONSTRAINT "PK_Converters" PRIMARY KEY,
    "Name" TEXT NOT NULL,
    "Order" INTEGER NOT NULL,
    "ConverterType" TEXT NOT NULL,
    "Description" TEXT NULL,
    "Data" TEXT NULL
)`,
  `CREATE UNIQUE INDEX "IX_Converters_Name" ON "Converters" ("Name")`,
  `CREATE UNIQUE INDEX "IX_Converters_Order" ON "Converters" ("Order")`,
  `CREATE VIEW ConvertersView([UniqueId], [Name], [Order], [ConverterType], [ConverterTypeDisplayName], [Description], [Data])
 AS
SELECT [UniqueId], [Name], [Order], [ConverterType], LocalizeConverter([ConverterType]) [ConverterTypeDisplayName], [Description], [Data]
FROM [Converters]`,
];

const LOCAL_VARIABLES_SCHEMA = [
  `CREATE TABLE "LocalVariables" (
    "UniqueId" TEXT NOT NULL CONSTRAINT "PK_LocalVariables" PRIMARY KEY,
    "DataType" TEXT NOT NULL,
    "Type" INTEGER NOT NULL,
    "IsArray" INTEGER NOT NULL,
    "Dimension" TEXT NULL,
    "EnableVariableLength" INTEGER NOT NULL,
    "Size" INTEGER NULL,
    "InitialValue" TEXT NULL,
    "InputRange" INTEGER NOT NULL,
    "Min" TEXT NULL,
    "Max" TEXT NULL,
    "Comments" TEXT NULL,
    "Value" TEXT NULL,
    "Order" INTEGER NOT NULL,
    "ParentId" TEXT NULL,
    "Name" TEXT NOT NULL,
    CONSTRAINT "FK_LocalVariables_LocalVariables_ParentId" FOREIGN KEY ("ParentId") REFERENCES "LocalVariables" ("UniqueId") ON DELETE CASCADE
)`,
  `CREATE UNIQUE INDEX "IX_LocalVariables_Name" ON "LocalVariables" ("Name")`,
  `CREATE INDEX "IX_LocalVariables_ParentId" ON "LocalVariables" ("ParentId")`,
  `CREATE UNIQUE INDEX "IX_LocalVariables_Order_ParentId" ON "LocalVariables" ("Order", "ParentId")`,
  `CREATE VIEW VariablePaginationView AS
            SELECT [UniqueId],[Name],[DataType],[Type],[IsArray],[Dimension],[EnableVariableLength],[Size],[ParentId],
	        CASE WHEN (DataType='DATE_AND_TIME' AND InitialValue IS NOT NULL) THEN
					FormatDateTime(InitialValue) ELSE InitialValue END [InitialValue],
            InputRange,
            CASE InputRange WHEN TRUE THEN
				 (CASE WHEN (DataType='DATE_AND_TIME' AND [Min] IS NOT NULL) THEN
					FormatDateTime([Min]) ELSE [Min] END)
			ELSE NULL END[Min],
            CASE InputRange WHEN TRUE THEN
				 (CASE WHEN (DataType='DATE_AND_TIME' AND [Max] IS NOT NULL) THEN
					FormatDateTime([Max]) ELSE [Max] END)
			ELSE NULL END[Max],
            (SELECT COUNT(*) FROM LocalVariables WHERE ParentId = LV.UniqueId AND Type > 0) AS NoOfElements,
            [Comments],[Value],[Order]
            FROM LocalVariables LV`,
];

const VALIDATIONS_SCHEMA = [
  `CREATE TABLE "Validations" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Validations" PRIMARY KEY,
    "ErrorLevel" INTEGER NOT NULL,
    "ErrorMessageKey" TEXT NOT NULL,
    "MetaData" TEXT NULL,
    "ObjectFullName" TEXT NULL,
    "ObjectType" TEXT NULL,
    "Subtype" TEXT NULL,
    "ObjectUniqueId" TEXT NULL,
    "ParentIds" TEXT NULL,
    "PropertyFullName" TEXT NULL,
    "IsInlineValidation" INTEGER NOT NULL,
    "ScriptIndex" INTEGER NULL
)`,
  `CREATE INDEX "IX_Validations_ObjectUniqueId" ON "Validations" ("ObjectUniqueId")`,
  `CREATE INDEX "IX_Validations_PropertyFullName" ON "Validations" ("PropertyFullName")`,
];
