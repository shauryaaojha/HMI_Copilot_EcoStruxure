/**
 * What a file is, decided by its bytes - never by its extension alone.
 *
 * Engineers rename files, mail strips extensions, and three Schneider formats
 * that matter here are easy to confuse. The facts this module is built on, and
 * where each comes from:
 *
 * - **.eote** is EcoStruxure Operator Terminal Expert 4.0 and later. A ZIP of
 *   JSON .dat files and SQLite .db files, backslash separators.
 * - **.vxdz** is the *same product* before 4.0. OTE was called Vijeo XD until
 *   3.0, and "starting from version 4.0, the project file extension ... has
 *   changed from vxdz to eote" (OTE 4.4 featureguide, What's New, 4.0). It is
 *   not Vijeo Designer. Pro-face sells the same editor as Pro-face BLUE, which
 *   is why `Project.dat` in a template pack says `Brand: Pro-face`. Inside, it
 *   comes in two layouts (docs/VXDZ_FINDINGS.md): **typed** from 3.4.1, the
 *   layout this tool reads and writes, and **struct** from 3.1 to 3.3.
 * - **.vdz** is a Vijeo Designer (6.x) project archive, exported from Vijeo
 *   Manager (Schneider FAQ FA268436; Machine Expert help, "Import / Export
 *   Vijeo-Designer Project"). A different product with a different, closed
 *   format. Nothing in this repository has ever held one.
 * - **.zdat** is what Vijeo Designer exports *for the VJD-to-OTE migration
 *   tool*, which Schneider has "put on hold temporarily" (FAQ FAQ000273797).
 *   It is a migration intermediate, not a project.
 * - **.co** is an OTE compound object: `CompoundObject.objdef`,
 *   `Properties.propDef`, a `Screen.dat`.
 * - **.xsy / .xvm / .xef / .xdd** are Control Expert (Unity Pro) XML exchange
 *   files. The root element names the kind: `VariablesExchangeFile`,
 *   `DDTExchangeFile`, `FEFExchangeFile`, and so on.
 * - **.csv / .txt / .xlsx** are tag lists, including OTE's own variable
 *   export, whose .xlsx puts a Summary sheet first.
 */

import JSZip from "jszip";
import { IngestError } from "./errors";
import { guardZip, isZip, type ZipEntry } from "./zip";

export type ProjectLayout = "typed" | "struct";

export type FileKind =
  | {
      kind: "ote-project";
      /** What the bytes say, regardless of the name it arrived under. */
      layout: ProjectLayout;
      /** "4.4.0" or "3.1.100", from Project.dat when it says. */
      appVersion?: string;
      /** "Schneider" or "Pro-face". */
      brand?: string;
      /** The product as an engineer would name it, for messages. */
      product: string;
      entries: ZipEntry[];
    }
  | { kind: "compound-object"; entries: ZipEntry[] }
  | { kind: "spreadsheet"; entries: ZipEntry[] }
  | { kind: "control-expert-xml"; root: string }
  | { kind: "xml"; root: string }
  | { kind: "text-table" }
  | { kind: "sqlite" }
  | { kind: "vijeo-designer"; variant: "vdz" | "zdat"; entries?: ZipEntry[] }
  | { kind: "zip"; entries: ZipEntry[] };

const ext = (name: string) => (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();

const has = (entries: ZipEntry[], re: RegExp) => entries.some((e) => re.test(e.name));

/** Control Expert XML roots end in ExchangeFile; this is the list seen in the product's XSDs. */
const CONTROL_EXPERT_ROOTS = /^(Variables|DDT|FEF|ST|LD|FBD|SFC|IL|FB|IO|Project)ExchangeFile$/;

function product(layout: ProjectLayout, appVersion?: string, brand?: string): string {
  const major = appVersion ? Number(appVersion.split(".")[0]) : NaN;
  const name = brand && /pro-?face/i.test(brand) ? "Pro-face BLUE" : "EcoStruxure Operator Terminal Expert";
  if (Number.isFinite(major) && major < 4) return `${name} ${appVersion} (.vxdz)`;
  if (appVersion) return `${name} ${appVersion}`;
  return layout === "struct" ? `${name} 3.1-3.3 (.vxdz)` : name;
}

/** The root element of an XML document, skipping the prolog and comments. */
export function xmlRoot(text: string): string | null {
  const body = text.replace(/^﻿/, "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<!DOCTYPE[^>]*>/gi, "");
  return body.match(/<\s*([A-Za-z_][\w.-]*)/)?.[1] ?? null;
}

async function projectDat(bytes: Uint8Array, entries: ZipEntry[]): Promise<{ appVersion?: string; brand?: string }> {
  const entry = entries.find((e) => /^Project\.dat$/i.test(e.name));
  if (!entry || entry.uncompressedSize > 4 * 1024 * 1024) return {};
  try {
    const zip = await JSZip.loadAsync(bytes);
    const file = zip.file(entry.name);
    if (!file) return {};
    const json = JSON.parse((await file.async("string")).replace(/^﻿/, "")) as Record<string, unknown>;
    const appVersion = typeof json.AppVersion === "string" ? json.AppVersion : undefined;
    const brand = typeof json.Brand === "string" ? json.Brand : undefined;
    return { appVersion, brand };
  } catch {
    // Project.dat is a label here, not a requirement: a file whose screens are
    // where a project's are is still a project if its identity will not parse.
    return {};
  }
}

/**
 * Classify the bytes. Throws IngestError only for a file that is unsafe or
 * unreadable as what it claims to be; an unrecognised file comes back as its
 * nearest kind ("zip", "xml", "text-table") for the caller to refuse by name.
 */
export async function sniff(bytes: Uint8Array, fileName = ""): Promise<FileKind> {
  if (bytes.length === 0) throw new IngestError("empty", "The file is empty.");
  const e = ext(fileName);

  if (isZip(bytes)) {
    const entries = guardZip(bytes);
    const files = entries.filter((x) => !x.dir);
    if (files.length === 0) throw new IngestError("no-content", "The archive is empty.");

    if (has(files, /^CompoundObject\.objdef$/i)) return { kind: "compound-object", entries };
    // A Vijeo Designer backup: one OLE compound file, <name>.SwxCF.
    if (has(files, /\.swxcf$/i)) return { kind: "vijeo-designer", variant: "vdz", entries };
    if (has(files, /^\[Content_Types\]\.xml$/) && has(files, /^xl[\\/]workbook\.xml$/i)) return { kind: "spreadsheet", entries };

    const typed = has(files, /^Screens[\\/][0-9a-f-]{36}[\\/]Screen\.dat$/i);
    const struct = has(files, /^(Contents|Screens)[\\/]panel\d+\.dat$/i) || has(files, /^(contents|hierarchy)\.inf$/i);
    const isProject = has(files, /^Project\.dat$/i) && (typed || struct || has(files, /^Variables\.db$/i));
    if (isProject) {
      const layout: ProjectLayout = typed ? "typed" : struct ? "struct" : "typed";
      const id = await projectDat(bytes, files);
      return { kind: "ote-project", layout, ...id, product: product(layout, id.appVersion, id.brand), entries };
    }
    if (e === "vdz" || e === "zdat") return { kind: "vijeo-designer", variant: e, entries };
    return { kind: "zip", entries };
  }

  if (e === "vdz" || e === "zdat") return { kind: "vijeo-designer", variant: e };

  if (bytes.length >= 16 && new TextDecoder("latin1").decode(bytes.subarray(0, 15)) === "SQLite format 3") {
    return { kind: "sqlite" };
  }

  // Text. A UTF-16 BOM is honoured because Excel's "Unicode text" writes one.
  const head = bytes.subarray(0, Math.min(bytes.length, 4096));
  const text =
    head[0] === 0xff && head[1] === 0xfe
      ? new TextDecoder("utf-16le").decode(head)
      : head[0] === 0xfe && head[1] === 0xff
        ? new TextDecoder("utf-16be").decode(head)
        : new TextDecoder("utf-8").decode(head);
  const trimmed = text.replace(/^﻿/, "").trimStart();
  if (trimmed.startsWith("<")) {
    const root = xmlRoot(trimmed) ?? "";
    return CONTROL_EXPERT_ROOTS.test(root) ? { kind: "control-expert-xml", root } : { kind: "xml", root };
  }
  // Binary that is none of the above: refuse rather than read it as a tag list
  // and report a thousand rows of nonsense.
  const control = [...head.subarray(0, 512)].filter((c) => c < 9 || (c > 13 && c < 32)).length;
  if (control > 8 && !(head[0] === 0xff || head[0] === 0xfe)) {
    throw new IngestError(
      "unknown-format",
      `${fileName || "This file"} is binary and is not a format HMI Copilot reads.`,
      "Supported: .eote, .vxdz (3.4.1 and later), .co, OTE variable exports (.csv, .txt, .xlsx), Control Expert exports (.xsy, .xvm), and tag lists as CSV or Excel.",
    );
  }
  return { kind: "text-table" };
}

/** Why a recognised-but-unopenable project kind is refused, as an IngestError. */
export function refuse(kind: FileKind, fileName: string): IngestError | null {
  if (kind.kind === "ote-project" && kind.layout === "struct") {
    return new IngestError(
      "unsupported-format",
      `${fileName} is a ${kind.product} project in the older layout, which keeps its screens as Contents\\panelN.dat ` +
        "and binds inside each property rather than in one Bindings.dat. HMI Copilot can scan it for its tags, " +
        "structure and bindings, but cannot open it for editing.",
      "Open it once in Operator Terminal Expert 4.4 and save it - the product upgrades it to .eote - then import the saved file.",
      { layout: kind.layout, appVersion: kind.appVersion, brand: kind.brand },
    );
  }
  if (kind.kind === "vijeo-designer") {
    return new IngestError(
      "unsupported-format",
      kind.variant === "zdat"
        ? `${fileName} is a Vijeo Designer migration export (.zdat). Schneider's own VJD-to-OTE migration tool, which reads it, is on hold, and its format is not public.`
        : `${fileName} is a Vijeo Designer project archive (.vdz). Vijeo Designer is a different product from Operator Terminal Expert, and its project format is closed.`,
      "Export the variables from Vijeo Designer (or the PLC's .xvm / .xsy) and import those here: the screens are regenerated for OTE from the tags, and the HMI structure carries over through the Plant Model rather than through the file.",
      { variant: kind.variant },
    );
  }
  return null;
}
