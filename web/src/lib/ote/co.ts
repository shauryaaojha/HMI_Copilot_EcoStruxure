/**
 * Compound objects (.co): read, edit and write the product's reusable objects.
 *
 * A .co is a ZIP with BACKSLASH entry names, like a project, holding:
 *
 *   CompoundObject.objdef      identity: Name, Id, LayoutType (0 grid, 8 view box),
 *                              ModifiedAppVersion, AppBrand, ScriptMode, CommitId
 *   CompoundObjectSettings.dat {Type: "CompoundObjectSettings", UniqueId, Name, ConfirmPasswordOnExport?}
 *   Screen.dat                 the object's own tree. The root is
 *                              {Type: "CompoundObject", SubType: <Name>, UniqueId: <objdef Id>,
 *                               DesignWidth?, DesignHeight?, <exposed property values>, Children}
 *   Properties.propDef         the exposed properties, a JSON array of
 *                              {Id, PropertyName, PropertyType, DefaultValue?, Children?, ValidationInfo?, ...}
 *   Bindings.dat               how those properties drive the parts inside: Sources -> Bindings -> Targets
 *   Localization\<locale>.dat  display names and descriptions, keyed by property Id
 *   Script.dat                 optional: Blockly-style scripts (ScriptMode 0)
 *   Converters.db, LocalVariables.db, Validations.db   SQLite, the same schemas as a project's
 *   Resources.dat, _metadata   small JSON
 *
 * Every fact here was read from files, never guessed: the 14 objects the
 * product installs (Buildtime\TemplateCOs\COs.pkg, 4.4.20.0), the 21 objects
 * Schneider publishes as "EOTE Compound Objects" (Pro-face brand, 4.0), the
 * three objects this project generated in September (demo_objects/), and the
 * copy the licensed editor made of one of those on import. That last
 * comparison is what settles what a writer must get right: OTE took our file
 * as written, and changed only the identity (a new Id and a "1" suffix, because
 * the name was taken) and the version stamp. docs/CO_FORMAT.md has the whole
 * account.
 *
 * The bindings vocabulary, from the same files:
 *
 *   Source ObjectType 16  an exposed property: ObjectFullName "CompoundObject",
 *                         SubType = the object's Name, ObjectId = its Id (upper case),
 *                         PropertyFullName = the property path ("Color.ON")
 *   Source ObjectType  6  a local variable ($Local.X)
 *   Source ObjectType  8  a part inside the object
 *   Target ObjectType  8  a part, SubType = its Type; 19 a converter or expression;
 *                         100 a script block value (Value.ScreenObject / Value.LocalVariable);
 *                         6 a local variable
 *   Binding Type 15       BindingText "$CO.<property>"; Type 9 "$Local.<variable>"
 *   Binding.Sources       comma-separated Source ReferenceIds, as a string
 *   Binding.Target        a Target ReferenceId
 *
 * What is still unknown is how a placed instance is written into a project's
 * Screen.dat, because no file available holds one. Nothing here writes into a
 * project.
 */

import JSZip from "jszip";

const BS = "\\";

export interface CoObjDef {
  Name: string;
  Id: string;
  LayoutType?: number;
  CreatedDate?: string;
  ModifiedDate?: string;
  ModifiedAppVersion?: string;
  AppBrand?: string;
  ScriptMode?: number;
  ErrorLevel?: number;
  CommitId?: string;
  [key: string]: unknown;
}

export interface CoPropDef {
  Id: string;
  PropertyName: string;
  PropertyType: string;
  DefaultValue?: unknown;
  Children?: CoPropDef[];
  ValidationInfo?: { Type: string; Parameters?: Record<string, { Value: unknown }> }[];
  FirstLevelCategory?: string;
  SecondLevelCategory?: string;
  [key: string]: unknown;
}

export interface CoSource {
  ObjectType: number;
  ReferenceId: number;
  ObjectId?: string;
  SubType?: string;
  ParentIds?: string;
  ScreenId?: string;
  ObjectFullName?: string;
  PropertyFullName?: string;
  [key: string]: unknown;
}

export interface CoTarget {
  ObjectType: number;
  SubType?: string | null;
  ReferenceId: number;
  ObjectId?: string;
  ParentIds?: string;
  ScreenId?: string;
  ObjectFullName?: string;
  [key: string]: unknown;
}

export interface CoBinding {
  Type: number;
  Mode: number;
  BindingText: string;
  ConverterId: string | null;
  ConverterName: string | null;
  Target: number;
  TargetProperty: string;
  Sources: string;
  [key: string]: unknown;
}

export interface CoBindings {
  Sources: CoSource[];
  Bindings: CoBinding[];
  Targets: CoTarget[];
  [key: string]: unknown;
}

export interface CoLocalization {
  TypeLocalizationInfo?: { Name: string | null; Description: string | null };
  PropertiesLocalizationInfo?: { PropertyId: string; Name: string | null; Description: string | null }[];
  [key: string]: unknown;
}

/** A node of the object's own tree. Loose on purpose: unknown keys travel untouched. */
export interface CoNode {
  Type: string;
  UniqueId?: string;
  Name?: string;
  Children?: CoNode[];
  [key: string]: unknown;
}

export interface CompoundObject {
  /**
   * Every entry, under the name the archive used and in its order. The
   * writer puts back the original bytes of anything whose model below is
   * unchanged, so a read and a write give the same entries.
   */
  entries: Map<string, Uint8Array>;
  objdef: CoObjDef;
  settings: Record<string, unknown>;
  screen: CoNode;
  properties: CoPropDef[];
  bindings: CoBindings;
  /** By locale, "en-US" etc. */
  localization: Map<string, CoLocalization>;
  scripts?: unknown[];
  /** The JSON as read, by entry name, to tell an edit from no edit. */
  readonly original: Map<string, string>;
}

/** The order the product writes, which a new object follows. */
export const CO_ENTRY_ORDER = [
  "Bindings.dat",
  "CompoundObject.objdef",
  "CompoundObjectSettings.dat",
  "Converters.db",
  "LocalVariables.db",
  "Properties.propDef",
  "Resources.dat",
  "Screen.dat",
  "Script.dat",
  "Validations.db",
  "Localization",
  "_metadata",
] as const;

export const CO_LOCALES = ["de-DE", "en-US", "es-ES", "fr-FR", "it-IT", "ja-JP", "ko-KR", "pt-BR", "zh-CHS", "zh-CHT"] as const;

export class CoFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoFormatError";
  }
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const slash = (name: string) => name.replace(/\\/g, "/");
const text = (bytes: Uint8Array) => decoder.decode(bytes).replace(/^﻿/, "");

/**
 * How an entry's JSON was written, so an edited entry goes back the way the
 * product wrote it: objdef, Bindings and propDef indented by two spaces with
 * CRLF (Newtonsoft's Indented on Windows), Screen.dat and the settings on one
 * line, the localization files indented with LF.
 */
interface JsonStyle {
  indent: number;
  eol: "\r\n" | "\n";
  bom: boolean;
}

const DEFAULT_STYLE: Record<string, JsonStyle> = {
  "Bindings.dat": { indent: 2, eol: "\r\n", bom: false },
  "CompoundObject.objdef": { indent: 2, eol: "\r\n", bom: false },
  "Properties.propDef": { indent: 2, eol: "\r\n", bom: false },
  "Screen.dat": { indent: 0, eol: "\n", bom: false },
  "CompoundObjectSettings.dat": { indent: 0, eol: "\n", bom: false },
  "Resources.dat": { indent: 0, eol: "\n", bom: false },
  "Script.dat": { indent: 0, eol: "\n", bom: false },
  _metadata: { indent: 2, eol: "\r\n", bom: false },
};
const LOCALE_STYLE: JsonStyle = { indent: 2, eol: "\n", bom: false };

function styleOf(bytes: Uint8Array | undefined, name: string): JsonStyle {
  const fallback = DEFAULT_STYLE[slash(name)] ?? (slash(name).startsWith("Localization/") ? LOCALE_STYLE : { indent: 2, eol: "\r\n", bom: false });
  if (!bytes) return fallback;
  const s = decoder.decode(bytes);
  const bom = s.charCodeAt(0) === 0xfeff;
  const body = bom ? s.slice(1) : s;
  const firstBreak = body.indexOf("\n");
  if (firstBreak < 0) return { indent: 0, eol: "\n", bom };
  const eol = body[firstBreak - 1] === "\r" ? "\r\n" : "\n";
  const indent = /\n( +)\S/.exec(body)?.[1].length ?? 2;
  return { indent, eol, bom };
}

function serialize(value: unknown, style: JsonStyle): Uint8Array {
  let s = style.indent ? JSON.stringify(value, null, style.indent) : JSON.stringify(value);
  if (style.eol === "\r\n") s = s.replace(/\n/g, "\r\n");
  return encoder.encode((style.bom ? "﻿" : "") + s);
}

/** Reads a .co. Throws CoFormatError on anything that is not one. */
export async function readCo(bytes: Uint8Array): Promise<CompoundObject> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new CoFormatError("not a ZIP archive, so not a compound object");
  }
  const entries = new Map<string, Uint8Array>();
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    entries.set(name, await file.async("uint8array"));
  }
  return fromEntries(entries);
}

function fromEntries(entries: Map<string, Uint8Array>): CompoundObject {
  const byPath = new Map<string, string>();
  for (const name of entries.keys()) byPath.set(slash(name).toLowerCase(), name);
  const original = new Map<string, string>();
  const json = <T>(path: string, required: boolean): T | undefined => {
    const name = byPath.get(path.toLowerCase());
    if (!name) {
      if (required) throw new CoFormatError(`${path} is missing, so this is not a compound object`);
      return undefined;
    }
    const raw = text(entries.get(name)!);
    try {
      const value = JSON.parse(raw) as T;
      original.set(name, JSON.stringify(value));
      return value;
    } catch {
      throw new CoFormatError(`${path} is not JSON`);
    }
  };

  const objdef = json<CoObjDef>("CompoundObject.objdef", true)!;
  const screen = json<CoNode>("Screen.dat", true)!;
  if (screen.Type !== "CompoundObject") throw new CoFormatError(`Screen.dat root is ${screen.Type}, not CompoundObject`);
  const localization = new Map<string, CoLocalization>();
  for (const [path, name] of byPath) {
    const m = /^localization\/(.+)\.dat$/.exec(path);
    if (m) localization.set(slash(name).slice("Localization/".length, -4), json<CoLocalization>(slash(name), false)!);
  }
  return {
    entries,
    objdef,
    screen,
    settings: json<Record<string, unknown>>("CompoundObjectSettings.dat", false) ?? {},
    properties: json<CoPropDef[]>("Properties.propDef", false) ?? [],
    bindings: json<CoBindings>("Bindings.dat", false) ?? { Sources: [], Bindings: [], Targets: [] },
    localization,
    scripts: json<unknown[]>("Script.dat", false),
    original,
  };
}

/**
 * Writes a .co. Entries whose model is unchanged go back byte for byte; an
 * edited one is serialized in the style it was read in. Names keep their
 * backslashes, which is asserted on the produced bytes.
 */
export async function writeCo(co: CompoundObject): Promise<Uint8Array> {
  const byPath = new Map<string, string>();
  for (const name of co.entries.keys()) byPath.set(slash(name).toLowerCase(), name);
  const out = new Map<string, Uint8Array>(co.entries);

  const put = (path: string, value: unknown) => {
    if (value === undefined) return;
    const name = byPath.get(path.toLowerCase()) ?? path.replace(/\//g, BS);
    const before = co.original.get(name);
    if (before !== undefined && before === JSON.stringify(value) && co.entries.has(name)) return;
    out.set(name, serialize(value, styleOf(co.entries.get(name), path)));
  };
  put("CompoundObject.objdef", co.objdef);
  put("CompoundObjectSettings.dat", co.settings);
  put("Screen.dat", co.screen);
  put("Properties.propDef", co.properties);
  put("Bindings.dat", co.bindings);
  if (co.scripts !== undefined) put("Script.dat", co.scripts);
  for (const [locale, value] of co.localization) put(`Localization/${locale}.dat`, value);

  const zip = new JSZip();
  for (const name of ordered([...out.keys()])) {
    zip.file(name, out.get(name)!, { createFolders: false, binary: true });
  }
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 }, platform: "DOS" });
  assertCoEntries(bytes, [...out.keys()]);
  return bytes;
}

/** Existing names first in their own order; anything new in the product's order. */
function ordered(names: string[]): string[] {
  const rank = (name: string) => {
    const top = slash(name).split("/")[0];
    const i = CO_ENTRY_ORDER.indexOf(top as (typeof CO_ENTRY_ORDER)[number]);
    return i < 0 ? CO_ENTRY_ORDER.length : i;
  };
  return [...names].sort((a, b) => rank(a) - rank(b) || slash(a).localeCompare(slash(b)));
}

/** The product reads nested entries by backslash only. Checked on the raw bytes. */
export function assertCoEntries(bytes: Uint8Array, names: string[]): void {
  const raw = Buffer.from(bytes).toString("latin1");
  for (const name of names) {
    if (name.includes("/")) throw new CoFormatError(`entry ${name} uses a forward slash; the product reads backslashes only`);
    if (name.includes(BS) && !raw.includes(name)) throw new CoFormatError(`entry ${name} is not in the archive as written`);
  }
}

/* ------------------------------------------------------------------ */
/* Exposed properties                                                   */
/* ------------------------------------------------------------------ */

export interface CoProperty {
  /** "CurrentValue", "Color.ON". */
  path: string;
  id: string;
  type: string;
  /** The English display name, when the object has one. */
  label?: string;
  description?: string;
  defaultValue?: unknown;
  /** The value this definition carries, from the Screen.dat root. */
  value?: unknown;
  min?: number;
  max?: number;
  category?: string;
  /** True when other properties nest under it; it holds no value itself. */
  group: boolean;
}

const getPath = (root: Record<string, unknown>, path: string): unknown =>
  path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), root);

function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let node = root;
  for (const k of keys.slice(0, -1)) {
    if (!node[k] || typeof node[k] !== "object") node[k] = {};
    node = node[k] as Record<string, unknown>;
  }
  node[keys[keys.length - 1]] = value;
}

/** Every exposed property, flattened, with its English name and current value. */
export function coProperties(co: CompoundObject): CoProperty[] {
  const names = new Map<string, { Name: string | null; Description: string | null }>();
  for (const p of co.localization.get("en-US")?.PropertiesLocalizationInfo ?? []) names.set(p.PropertyId, p);
  const out: CoProperty[] = [];
  const walk = (list: CoPropDef[], prefix: string) => {
    for (const p of list) {
      const path = prefix + p.PropertyName;
      const range = p.ValidationInfo?.find((v) => v.Type === "Range")?.Parameters;
      const group = !!p.Children?.length;
      out.push({
        path,
        id: p.Id,
        type: p.PropertyType,
        label: names.get(p.Id)?.Name ?? undefined,
        description: names.get(p.Id)?.Description ?? undefined,
        defaultValue: p.DefaultValue,
        value: group ? undefined : getPath(co.screen, path),
        min: typeof range?.Min?.Value === "number" ? range.Min.Value : undefined,
        max: typeof range?.Max?.Value === "number" ? range.Max.Value : undefined,
        category: [p.FirstLevelCategory, p.SecondLevelCategory].filter(Boolean).join(" / ") || undefined,
        group,
      });
      if (group) walk(p.Children!, path + ".");
    }
  };
  walk(co.properties, "");
  return out;
}

const NUMERIC = new Set(["Int32", "Int16", "Int64", "UInt32", "Double", "Single", "Decimal"]);

/**
 * Sets the values this definition carries for its exposed properties, as the
 * root of Screen.dat holds them. Each value is checked against the property's
 * type and declared range; nothing else in the object changes.
 */
export function setCoValues(co: CompoundObject, values: Record<string, unknown>): void {
  const props = new Map(coProperties(co).map((p) => [p.path, p]));
  for (const [path, value] of Object.entries(values)) {
    const p = props.get(path);
    if (!p) throw new CoFormatError(`${co.objdef.Name} has no property ${path}; it has ${[...props.keys()].filter((k) => !props.get(k)!.group).join(", ")}`);
    if (p.group) throw new CoFormatError(`${path} groups other properties and holds no value of its own`);
    if (NUMERIC.has(p.type)) {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new CoFormatError(`${path} is ${p.type}; ${JSON.stringify(value)} is not a number`);
      if (p.type.startsWith("Int") || p.type.startsWith("UInt")) {
        if (!Number.isInteger(value)) throw new CoFormatError(`${path} is ${p.type}; ${value} is not a whole number`);
      }
      if (p.min !== undefined && value < p.min) throw new CoFormatError(`${path} must be at least ${p.min}`);
      if (p.max !== undefined && value > p.max) throw new CoFormatError(`${path} must be at most ${p.max}`);
    } else if (p.type === "Boolean" && typeof value !== "boolean") {
      throw new CoFormatError(`${path} is Boolean; ${JSON.stringify(value)} is not true or false`);
    } else if (p.type === "String" && typeof value !== "string") {
      throw new CoFormatError(`${path} is String; ${JSON.stringify(value)} is not text`);
    }
    setPath(co.screen, path, value);
  }
}

/* ------------------------------------------------------------------ */
/* What each property drives                                            */
/* ------------------------------------------------------------------ */

export interface CoWire {
  /** The exposed property, or "$Local.X" for a local variable. */
  source: string;
  /** The part or element it drives, by name. */
  target: string;
  targetType: string;
  targetProperty: string;
  converter?: string;
  /** Binding Mode as written: 1 or 2. */
  mode: number;
}

/**
 * The object's wiring: which inner part each exposed property drives, and
 * through which converter. This is how an object "works", and what a preview
 * needs to apply a property value to the parts.
 */
export function coWiring(co: CompoundObject): CoWire[] {
  const sources = new Map(co.bindings.Sources.map((s) => [s.ReferenceId, s]));
  const targets = new Map(co.bindings.Targets.map((t) => [t.ReferenceId, t]));
  const kind: Record<number, string> = { 6: "LocalVariable", 8: "Part", 16: "Property", 19: "Converter", 100: "ScriptValue" };
  const out: CoWire[] = [];
  for (const b of co.bindings.Bindings) {
    const t = targets.get(b.Target);
    const first = sources.get(Number(String(b.Sources).split(",")[0]));
    const source =
      b.BindingText?.replace(/^\$CO\./, "") ||
      (first?.ObjectType === 16 ? first.PropertyFullName : first?.ObjectFullName) ||
      "?";
    out.push({
      source,
      target: t?.ObjectFullName ?? `#${b.Target}`,
      targetType: t ? (t.ObjectType === 8 ? String(t.SubType) : kind[t.ObjectType] ?? String(t.ObjectType)) : "?",
      targetProperty: b.TargetProperty,
      converter: b.ConverterName ?? undefined,
      mode: b.Mode,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Identity                                                             */
/* ------------------------------------------------------------------ */

export const newCoId = () => crypto.randomUUID();

/**
 * Gives the object a new name and Id everywhere they are written, which is
 * what the licensed editor itself does when an import collides with an
 * existing name: objdef, the Screen.dat root, the settings, every Source that
 * names the object (ObjectType 16) and every Target's ScreenId and first
 * ParentIds entry. Case is kept as each field had it.
 */
export function renameCo(co: CompoundObject, name: string, id: string = newCoId()): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new CoFormatError(`${name} is not a name the product accepts (letters, digits, _; not starting with a digit)`);
  const old = co.objdef.Id;
  const swap = (v: unknown) => {
    if (typeof v !== "string") return v;
    if (v.toLowerCase() !== old.toLowerCase()) return v;
    return v === v.toUpperCase() ? id.toUpperCase() : id.toLowerCase();
  };
  const swapList = (v: unknown) => (typeof v === "string" ? v.split(",").map(swap).join(",") : v);
  const oldName = co.objdef.Name;
  co.objdef.Name = name;
  co.objdef.Id = id.toLowerCase();
  co.screen.Name = name;
  co.screen.SubType = name;
  co.screen.UniqueId = id.toLowerCase();
  if (co.settings && typeof co.settings === "object" && co.settings.Name === oldName) co.settings.Name = name;
  for (const s of co.bindings.Sources) {
    s.ObjectId = swap(s.ObjectId) as string | undefined;
    s.ParentIds = swapList(s.ParentIds) as string | undefined;
    s.ScreenId = swap(s.ScreenId) as string | undefined;
    if (s.ObjectType === 16 && s.SubType === oldName) s.SubType = name;
  }
  for (const t of co.bindings.Targets) {
    t.ObjectId = swap(t.ObjectId) as string | undefined;
    t.ParentIds = swapList(t.ParentIds) as string | undefined;
    t.ScreenId = swap(t.ScreenId) as string | undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Packages                                                             */
/* ------------------------------------------------------------------ */

export interface CoFolder {
  Id: string;
  Name?: string;
  Type: "Folder" | "CompoundObject";
  Children?: CoFolder[];
  [key: string]: unknown;
}

/**
 * A library package, like the product's own Buildtime\TemplateCOs\COs.pkg:
 * a ZIP of `<Id>.co` entries plus `Hierarchy.dat`, the folder tree that
 * lists them by Id.
 */
export async function readCoPackage(bytes: Uint8Array): Promise<{ hierarchy: CoFolder[]; objects: CompoundObject[] }> {
  const zip = await JSZip.loadAsync(bytes);
  const objects: CompoundObject[] = [];
  let hierarchy: CoFolder[] = [];
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    if (/\.co$/i.test(name)) objects.push(await readCo(await file.async("uint8array")));
    else if (/(^|[\\/])Hierarchy\.dat$/i.test(name)) hierarchy = JSON.parse(text(await file.async("uint8array"))) as CoFolder[];
  }
  return { hierarchy, objects };
}

/** Folder path of each object in a package, by Id: "BarGraphs", "Gauges". */
export function coFolders(hierarchy: CoFolder[]): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (nodes: CoFolder[], path: string[]) => {
    for (const n of nodes) {
      if (n.Type === "Folder") walk(n.Children ?? [], [...path, n.Name ?? ""]);
      else out.set(n.Id.toLowerCase(), path.join("/"));
    }
  };
  walk(hierarchy, []);
  return out;
}

/* ------------------------------------------------------------------ */
/* Summary                                                              */
/* ------------------------------------------------------------------ */

export interface CoSummary {
  name: string;
  id: string;
  version?: string;
  brand?: string;
  layout: "grid" | "viewbox" | string;
  size?: { width?: number; height?: number };
  parts: Record<string, number>;
  properties: CoProperty[];
  wires: number;
  scripts: number;
  entries: string[];
}

export function summarizeCo(co: CompoundObject): CoSummary {
  const parts: Record<string, number> = {};
  const walk = (n: CoNode, root: boolean) => {
    if (!root) parts[n.Type] = (parts[n.Type] ?? 0) + 1;
    for (const c of n.Children ?? []) walk(c, false);
  };
  walk(co.screen, true);
  const layout = co.objdef.LayoutType === 0 ? "grid" : co.objdef.LayoutType === 8 ? "viewbox" : String(co.objdef.LayoutType);
  const w = co.screen.DesignWidth, h = co.screen.DesignHeight;
  return {
    name: co.objdef.Name,
    id: co.objdef.Id,
    version: co.objdef.ModifiedAppVersion,
    brand: co.objdef.AppBrand,
    layout,
    size: typeof w === "number" || typeof h === "number" ? { width: w as number | undefined, height: h as number | undefined } : undefined,
    parts,
    properties: coProperties(co),
    wires: co.bindings.Bindings.length,
    scripts: co.scripts?.length ?? 0,
    entries: [...co.entries.keys()].map(slash),
  };
}

/**
 * The invariants every sample holds, as problems. An empty list means the
 * object is internally consistent the way the product writes one.
 */
export function checkCo(co: CompoundObject): string[] {
  const problems: string[] = [];
  const id = co.objdef.Id?.toLowerCase();
  if (String(co.screen.UniqueId).toLowerCase() !== id) problems.push(`Screen.dat UniqueId ${co.screen.UniqueId} is not the objdef Id ${co.objdef.Id}`);
  if (co.screen.SubType !== co.objdef.Name) problems.push(`Screen.dat SubType ${String(co.screen.SubType)} is not the objdef Name ${co.objdef.Name}`);
  if (co.screen.Name !== co.objdef.Name) problems.push(`Screen.dat Name ${String(co.screen.Name)} is not the objdef Name ${co.objdef.Name}`);
  const paths = new Set(coProperties(co).map((p) => p.path));
  for (const s of co.bindings.Sources) {
    if (s.ObjectType !== 16) continue;
    if (String(s.ObjectId).toLowerCase() !== id) problems.push(`Source ${s.ReferenceId} names object ${s.ObjectId}, not ${co.objdef.Id}`);
    if (s.SubType !== co.objdef.Name) problems.push(`Source ${s.ReferenceId} names ${s.SubType}, not ${co.objdef.Name}`);
    if (s.PropertyFullName && !paths.has(s.PropertyFullName)) problems.push(`Source ${s.ReferenceId} reads property ${s.PropertyFullName}, which is not exposed`);
  }
  const sourceIds = new Set(co.bindings.Sources.map((s) => s.ReferenceId));
  const targetIds = new Set(co.bindings.Targets.map((t) => t.ReferenceId));
  for (const b of co.bindings.Bindings) {
    if (!targetIds.has(b.Target)) problems.push(`Binding ${b.BindingText} points at missing Target ${b.Target}`);
    for (const ref of String(b.Sources).split(",").filter(Boolean)) {
      if (!sourceIds.has(Number(ref))) problems.push(`Binding ${b.BindingText} reads missing Source ${ref}`);
    }
  }
  const names = new Set<string>();
  const walk = (n: CoNode) => {
    if (n.Name) names.add(n.Name);
    for (const c of n.Children ?? []) walk(c);
  };
  walk(co.screen);
  for (const t of co.bindings.Targets) {
    if (t.ObjectType === 8 && t.ObjectFullName && !names.has(t.ObjectFullName.split(".")[0])) {
      problems.push(`Target ${t.ReferenceId} drives ${t.ObjectFullName}, which is not in the tree`);
    }
  }
  return problems;
}
