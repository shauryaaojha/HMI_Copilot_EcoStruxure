/**
 * The project's own objects, used for the ones we add.
 *
 * An engineer who adds a START button to a project copies the START button
 * already in it: the same object, its colours, its font, bound the same way.
 * We drew ours from our own factories instead (lib/ote/parts.ts), so a screen
 * we added never looked like the project it was in, and whether the editor
 * that made the project accepts our shapes was a guess. The rig's push
 * buttons, for one, are Pro-face Compound Objects bound through an exposed
 * property (`CompoundObject.Switch_PB04`, `CV`), not Switches.
 *
 * `harvest` reads the opened file for one example of each kind of thing an
 * operator touches or reads, by the role of the tag it is bound to (infer.ts
 * `roleOf`), and how it is bound. `nativise` writes each part we generated
 * that has an example as a clone of it: the example's object, ours where it
 * counts (identity, box, label, unit, digits), and the wire moved to the
 * property and mode the example is bound by. A part with no example stays
 * ours. The canvas still draws ours; `written` says what each became.
 *
 * It reads only the file being edited, and nothing of it is stored anywhere
 * else: the knowledge base keeps structure, never an engineer's objects
 * (docs/PRODUCTION.md §1). docs/PLAN_PROJECT_NATIVE.md, phase 2.
 */

import type { Part, Variable } from "./schema";
import type { BindingGraph, Wire } from "./bindings";
import type { Preserved } from "./reader";
import type { PackageInput } from "./packager";
import { roleOf } from "@/lib/ai/infer";

type Json = Record<string, unknown>;

export type Kind = "pushbutton" | "toggle" | "entry" | "reading" | "status";

export interface Exemplar {
  kind: Kind;
  /** The object as the file has it. */
  raw: Json;
  /** The tag it is bound to, and how. */
  tag: string;
  property: string;
  mode: number;
  /** How many objects of this kind the project draws this way. */
  uses: number;
  /** The size it is drawn at, where the file says or its layout resolves it. */
  box?: { width: number; height: number };
}

export type Exemplars = Partial<Record<Kind, Exemplar>>;

const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const NUMERIC = new Set(["INT", "DINT", "UINT", "UDINT", "SINT", "USINT", "LINT", "ULINT", "WORD", "DWORD", "REAL", "LREAL", "BYTE"]);
const isCo = (type: unknown) => typeof type === "string" && type.startsWith("CompoundObject.");

/** What an object bound to this tag shows the operator, if it is one of the kinds. */
function kindOf(raw: Json, tag: string, dataType: string | undefined): Kind | null {
  const role = roleOf(tag);
  const type = raw.Type;
  if (dataType === "BOOL") {
    if ((role === "command" || role === "reset") && (type === "Switch" || isCo(type))) return "pushbutton";
    if (role === "mode" && (type === "ToggleSwitch" || isCo(type))) return "toggle";
    return null;
  }
  if (dataType === "STRING") return type === "StringDisplay" ? "status" : null;
  if (!dataType || !NUMERIC.has(dataType)) return null;
  if (role === "setpoint") return type === "NumericDisplay" ? (raw.IsInputModeEnabled === false ? null : "entry") : isCo(type) ? "entry" : null;
  return type === "NumericDisplay" && raw.IsInputModeEnabled === false ? "reading" : null;
}

const entry = (preserved: Preserved, name: string) => {
  const want = name.replace(/\\/g, "/").toLowerCase();
  for (const [n, bytes] of preserved.entries) if (n.replace(/\\/g, "/").toLowerCase() === want) return bytes;
  return undefined;
};
const json = (bytes: Uint8Array | undefined): unknown =>
  bytes ? JSON.parse(new TextDecoder().decode(bytes).replace(/^﻿/, "")) : undefined;

/** Every object on every screen and content screen of the file, by id. */
function objectsOf(preserved: Preserved): Map<string, Json> {
  const found = new Map<string, Json>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!isObject(node)) return;
    if (typeof node.UniqueId === "string" && typeof node.Type === "string") found.set(node.UniqueId.toLowerCase(), node);
    for (const v of Object.values(node)) if (v && typeof v === "object") walk(v);
  };
  for (const [name, bytes] of preserved.entries) {
    if (/^(Screens|Contents)[\\/][^\\/]+[\\/]Screen\.dat$/i.test(name)) walk((json(bytes) as Json | undefined)?.Children);
  }
  return found;
}

/** The drawn size of every object, from its own Width and Height or the grid it sits in. */
function sizesOf(preserved: Preserved): Map<string, { width: number; height: number }> {
  const sizes = new Map<string, { width: number; height: number }>();
  for (const kept of preserved.screens.values()) {
    if (kept.tree) for (const leaf of kept.tree.laid.leaves) sizes.set(leaf.uid.toLowerCase(), { width: leaf.box.width, height: leaf.box.height });
    else
      for (const [id, raw] of kept.parts)
        if (typeof raw.Width === "number" && typeof raw.Height === "number") sizes.set(id.toLowerCase(), { width: raw.Width, height: raw.Height });
  }
  return sizes;
}

export function harvest(preserved: Preserved, variables: Variable[]): Exemplars {
  const graph = json(entry(preserved, "Bindings.dat")) as BindingGraph | undefined;
  if (!graph?.Bindings) return {};
  const objects = objectsOf(preserved);
  const sizes = sizesOf(preserved);
  const types = new Map(variables.map((v) => [v.Name, v.DataType as string]));
  // A binding names a symbol tag by its full name; the variable list by its own.
  const byFullName = new Map(Object.entries(preserved.variableRefs ?? {}).map(([name, ref]) => [ref.fullName, name]));
  const tagOf = (fullName: string) => byFullName.get(fullName) ?? fullName;

  const targets = new Map(graph.Targets.map((t) => [t.ReferenceId, t]));
  const sources = new Map(graph.Sources.map((s) => [s.ReferenceId, s]));
  const seen = new Map<string, Exemplar>();
  for (const row of graph.Bindings) {
    const target = targets.get(row.Target);
    const source = sources.get(Number(String(row.Sources).split(",")[0]));
    if (!target || !source || source.ObjectType !== 4) continue;
    const raw = objects.get(String(target.ObjectId).toLowerCase());
    if (!raw) continue;
    const tag = tagOf(source.ObjectFullName);
    const kind = kindOf(raw, tag, types.get(tag));
    if (!kind) continue;
    const key = `${kind}|${raw.Type}`;
    const was = seen.get(key);
    if (was) was.uses++;
    else {
      const box = sizes.get(String(target.ObjectId).toLowerCase());
      seen.set(key, { kind, raw, tag, property: row.TargetProperty, mode: row.Mode, uses: 1, ...(box ? { box } : {}) });
    }
  }
  // The way the project draws a kind most often is its way.
  const out: Exemplars = {};
  for (const ex of seen.values()) if (!out[ex.kind] || ex.uses > out[ex.kind]!.uses) out[ex.kind] = ex;
  return out;
}

/** The kind of a part we generated, from what it is and how it is wired. */
function ours(part: Part, wired: boolean): Kind | null {
  if (!wired) return null;
  switch (part.Type) {
    case "Switch":
      return "pushbutton";
    case "ToggleSwitch":
      return "toggle";
    case "NumericDisplay":
      return part.IsInputModeEnabled === false ? "reading" : "entry";
    case "StringDisplay":
      return "status";
    default:
      return null;
  }
}

/** Where a part is and who it is: always ours. */
const PLACE = ["UniqueId", "Name", "Location", "Width", "Height", "Margin", "ObjectAlignment"];
/** What belongs to the example's own signal: kept only when it is the same tag. */
const SIGNAL = ["Range", "Min", "Max", "Minimum", "Maximum", "Suffix", "Prefix"];
/** What says how a value is shown: ours, where the example has the same object type. */
const FORMAT = ["FloatDigits", "IntegerDigits", "Suffix", "Prefix", "IsInputModeEnabled"];

const omit = (o: Json, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

/** Our label for a face: OFF, ON, or the one label a push button has. */
function labelOf(part: Json, state: "off" | "on" | "any"): string | undefined {
  const text = (face: unknown) => (isObject(face) && typeof face.Text === "string" ? face.Text : undefined);
  if (part.Type === "ToggleSwitch") return state === "on" ? text(part.On) : text(part.Off);
  return text(part.Release) ?? text(part.Press) ?? (typeof part.Text === "string" ? part.Text : undefined);
}

/** Every string under a Text key of the example becomes ours, face by face. */
function relabel(node: unknown, mine: Json, path: string[] = []): unknown {
  if (Array.isArray(node)) return node.map((v) => relabel(v, mine, path));
  if (isObject(node)) return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, relabel(v, mine, [...path, k])]));
  if (typeof node !== "string" || !path.includes("Text")) return node;
  const state = path.some((p) => /^(OFF|Off|Release)$/.test(p)) ? "off" : path.some((p) => /^(ON|On|Press)$/.test(p)) ? "on" : "any";
  return labelOf(mine, state) ?? labelOf(mine, "any") ?? node;
}

/** A font this many times the box's height still fits on one line. */
const LINE = 0.62;

/** Fonts and borders no bigger than the box allows: the example's size where it fits. */
function fitted(node: unknown, height: number): unknown {
  if (Array.isArray(node)) return node.map((v) => fitted(v, height));
  if (!isObject(node)) return node;
  const font = Math.max(8, Math.floor(height * LINE));
  const border = Math.max(1, Math.round(height / 12));
  return Object.fromEntries(
    Object.entries(node).map(([key, v]) => {
      if (typeof v !== "number") return [key, fitted(v, height)];
      if (key === "Size" || key === "SizeOFF" || key === "SizeON") return [key, Math.min(v, font)];
      if (key === "Thickness") return [key, Math.min(v, border)];
      return [key, v];
    }),
  );
}

/**
 * The example, as ours: its object, our identity, box, label and format. Its
 * font and border are kept where they fit our box and made to fit where they
 * do not: the rig's Font 24 sits in a grid cell 90 px high, and ours in a row
 * of 24. A Compound Object scales its own content to the box it is given, so
 * it is left as it is.
 */
export function adopt(part: Part, ex: Exemplar, tag: string): Json {
  const mine = part as unknown as Json;
  const same = tag === ex.tag;
  let base = omit(ex.raw, PLACE);
  if (!isCo(ex.raw.Type) && typeof mine.Height === "number") base = fitted(base, mine.Height) as Json;
  if (!same) base = omit(base, SIGNAL);
  if (ex.raw.Type === part.Type) {
    base = omit(base, FORMAT);
    for (const k of FORMAT) if (mine[k] !== undefined) base[k] = mine[k];
  } else if (!same && "Suffix" in ex.raw && typeof mine.Suffix === "string") {
    base.Suffix = mine.Suffix;
  }
  const out = relabel(base, mine) as Json;
  for (const k of PLACE) if (mine[k] !== undefined) out[k] = mine[k];
  return out;
}

export interface Native {
  input: PackageInput;
  /** Each part written as the project's object: our name, and what it became. */
  written: { part: string; as: string; like: string }[];
  /** Wires a clone could not take: the example has no such property. */
  dropped: { part: string; tag: string; property: string }[];
}

/** The wire that carries a part's value: a button's, read back from a file, is its click action's. */
const VALUE = new Set(["CurrentValue", "ClickTrigger.Destination"]);

/**
 * Writes each part we generated as the project's own object where it has one.
 * `existing` are the ids of parts the file already had: those are the
 * engineer's and never change kind.
 */
export function nativise(input: PackageInput, exemplars: Exemplars, existing: Set<string>): Native {
  const written: Native["written"] = [];
  const dropped: Native["dropped"] = [];
  if (!Object.keys(exemplars).length) return { input, written, dropped };

  const valueTag = new Map<string, string>();
  for (const w of input.wires) if (VALUE.has(w.property)) valueTag.set(w.part.UniqueId, w.tag);
  const swapped = new Map<string, { part: Part; ex: Exemplar }>();

  const screens = input.screens.map((screen) => {
    const children = screen.Children[0].Children.map((part) => {
      if (existing.has(part.UniqueId.toLowerCase())) return part;
      const tag = valueTag.get(part.UniqueId);
      const kind = ours(part, tag !== undefined);
      const ex = kind ? exemplars[kind] : undefined;
      if (!ex || tag === undefined) return part;
      const clone = adopt(part, ex, tag) as unknown as Part;
      swapped.set(part.UniqueId, { part: clone, ex });
      written.push({ part: part.Name, as: String(ex.raw.Type), like: String(ex.raw.Name ?? ex.raw.Type) });
      return clone;
    });
    return { ...screen, Children: [{ ...screen.Children[0], Children: children }] } as typeof screen;
  });

  const wires: Wire[] = [];
  for (const w of input.wires) {
    const s = swapped.get(w.part.UniqueId);
    if (!s) wires.push(w);
    else if (VALUE.has(w.property)) wires.push({ ...w, part: s.part, property: s.ex.property, mode: s.ex.mode });
    else dropped.push({ part: w.part.Name, tag: w.tag, property: w.property });
  }
  return { input: { ...input, screens, wires }, written, dropped };
}

/** Ids of every part the file has, modelled or carried. */
export function partsOf(preserved: Preserved): Set<string> {
  return new Set(objectsOf(preserved).keys());
}

/** One of the project's own objects, as the Copilot is told about it. */
export interface OwnObject {
  kind: Kind;
  type: string;
  name: string;
  uses: number;
  /** How it is bound: the property and the mode. */
  bound: string;
  size?: string;
  font?: number;
  bold?: boolean;
  /** Its labels, OFF and ON for a two-state object. */
  text?: string[];
}

/** The exemplars, compact and free of anything but how they look and bind. */
export function describeOwn(exemplars: Exemplars): OwnObject[] {
  return Object.values(exemplars).map((e) => {
    const font = isObject(e!.raw.Font) ? e!.raw.Font : undefined;
    const texts: string[] = [];
    const collect = (node: unknown, inText = false) => {
      if (typeof node === "string" && inText) texts.push(node);
      else if (Array.isArray(node)) node.forEach((v) => collect(v, inText));
      else if (isObject(node)) for (const [k, v] of Object.entries(node)) collect(v, inText || k === "Text");
    };
    collect(e!.raw);
    const size = typeof font?.Size === "number" ? font.Size : typeof font?.SizeOFF === "number" ? font.SizeOFF : undefined;
    return {
      kind: e!.kind,
      type: String(e!.raw.Type),
      name: String(e!.raw.Name ?? ""),
      uses: e!.uses,
      bound: `${e!.property}, mode ${e!.mode}`,
      ...(e!.box ? { size: `${Math.round(e!.box.width)}x${Math.round(e!.box.height)}` } : {}),
      ...(size !== undefined ? { font: size } : {}),
      ...(isObject(font?.Attribute) && font.Attribute.Bold === true ? { bold: true } : {}),
      ...(texts.length ? { text: [...new Set(texts)].slice(0, 4) } : {}),
    };
  });
}
