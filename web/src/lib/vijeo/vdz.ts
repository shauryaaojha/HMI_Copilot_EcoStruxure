/**
 * Vijeo Designer project backups (.vdz): what is in one, read-only.
 *
 * What is known, and from where:
 * - A .vdz is what Vijeo Designer writes on File > Backup project (and Vijeo
 *   Manager on export): Schneider FAQ FA268436, Machine Expert help.
 * - It is a ZIP holding one OLE compound file, `<name>.SwxCF`. Inside, each
 *   panel is a storage whose `GraphicalObject` stream is the screen:
 *     Targets/<target>/Component N/WindowList/BasePanelsList/PanelN        base panels
 *     Targets/<target>/Component N/PopupWindowList/<group>/PanelN          popups
 *     Targets/<target>/Component N/WindowList/DefinitionNodeStorage/<f>/PanelN   templates
 *   The panel's designer-visible name is the first UTF-16 string of its
 *   `WindowObject` stream; a popup group's, of `PageListProperties`. Screens
 *   name variables as UTF-16 text: `TagDB.<name>.<accessor>` in expressions
 *   (certain) and plain dotted names `FOLDER.VAR` (probable). The variable
 *   database is `Services/TagDatabase`; texts, images and the name server are
 *   definitions, never references.
 *   This layout was established by an independent reverse-engineering of
 *   Vijeo Designer 6.2 projects (github.com/apexsotjo-blip/vijeo-mcp, checked
 *   there against Vijeo's own load and save). This module is written here from
 *   those facts, not copied.
 *
 * What is done with it is deliberately modest. The panel stream is a binary
 * MFC serialisation nobody has published, so no object is modelled and nothing
 * is ever written. What can be read reliably is the inventory - targets,
 * panels by their designer names, and the variables each panel uses - which is
 * what a migration (lib/vijeo/migrate.ts), a knowledge-base record and the
 * question "which of these tags does the HMI actually use?" need.
 */

import JSZip from "jszip";
import { readCfb, type CompoundFile } from "@/lib/ingest/cfb";
import { IngestError } from "@/lib/ingest/errors";
import { guardZip } from "@/lib/ingest/zip";

export interface VijeoPanel {
  /** Stable id: "<target>/<kind>/[<group>/]PanelN". */
  id: string;
  /** The name the engineer sees in Vijeo Designer, or the storage name when unreadable. */
  name: string;
  target: string;
  kind: "base" | "popup" | "template";
  /** Popup window group, or template folder. */
  group: string;
  /** Variables named by a TagDB expression: certain. */
  tagdb: string[];
  /** Every variable-like dotted name, TagDB ones included: probable. */
  references: string[];
  /** Size of the GraphicalObject stream: a rough measure of how much is drawn. */
  bytes: number;
}

export interface VijeoInventory {
  container: string;
  streams: number;
  targets: string[];
  panels: VijeoPanel[];
  /** Every variable any panel references, sorted. */
  variables: string[];
  hasTagDatabase: boolean;
  hasTextTable: boolean;
}

/** UTF-16LE runs of printable ASCII, the way the streams store identifiers. */
export function utf16Strings(data: Uint8Array): string[] {
  const latin = new TextDecoder("latin1").decode(data);
  const out: string[] = [];
  for (const m of latin.matchAll(/(?:[\x20-\x7e]\x00){2,}/g)) out.push(m[0].replace(/\x00/g, ""));
  return out;
}

const NAME = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])+/g;
const ACCESSOR = /^(get|set|is)[A-Z]/;

/**
 * `TagDB.PUMPS.P5.Running.getIntValue` -> `PUMPS.P5.Running`, certain. A bare
 * `PUMPS.P5.Running` is probable. An accessor method ends the variable path.
 */
export function namesIn(strings: string[]): { tagdb: Set<string>; dotted: Set<string> } {
  const tagdb = new Set<string>();
  const dotted = new Set<string>();
  for (const s of strings) {
    for (const m of s.matchAll(NAME)) {
      const isTag = m[0].startsWith("TagDB.");
      const parts = (isTag ? m[0].slice(6) : m[0]).split(".");
      const cut = parts.findIndex((p, i) => i > 0 && ACCESSOR.test(p));
      const name = (cut > 0 ? parts.slice(0, cut) : parts).join(".");
      if (!name) continue;
      if (isTag) tagdb.add(name);
      if (isTag || name.includes(".")) dotted.add(name);
    }
  }
  return { tagdb, dotted };
}

/** The older single-purpose helper, kept for callers that only want certain references. */
export const tagReferences = (strings: string[]) => [...namesIn(strings).tagdb].sort();

const PANEL = new RegExp(
  "^Targets/(?<t>[^/]+)/Component \\d+/(?:" +
    "WindowList/BasePanelsList/(?<base>Panel\\d+)" +
    "|PopupWindowList/(?<grp>[^/]+)/(?<pop>Panel\\d+)" +
    "|WindowList/DefinitionNodeStorage/(?<fold>[^/]+)/(?<tpl>Panel\\d+)" +
    ")/GraphicalObject$",
);

/** Streams that define things rather than use them: scanning them would make every variable look used. */
const DEFINITIONS = ["Services/", "/BitmapManager/", "/JpegList", "/LangManager/", "/JpegThumbnails"];

/** The compound file inside a .vdz, or an IngestError saying why not. */
export async function openVdz(bytes: Uint8Array): Promise<{ name: string; cf: CompoundFile }> {
  const entries = guardZip(bytes);
  const container = entries.find((e) => !e.dir && /\.swxcf$/i.test(e.name));
  if (!container) {
    throw new IngestError(
      "unsupported-format",
      "This archive has no .SwxCF project container, so it is not a Vijeo Designer backup.",
      "In Vijeo Designer, use File > Backup project to make one.",
    );
  }
  const zip = await JSZip.loadAsync(bytes);
  const blob = await zip.file(container.name)!.async("uint8array");
  return { name: container.name.replace(/^.*[\\/]/, "").replace(/\.swxcf$/i, ""), cf: readCfb(blob) };
}

export async function inventoryVdz(bytes: Uint8Array): Promise<VijeoInventory> {
  const { name, cf } = await openVdz(bytes);
  const first = (path: string) => {
    const data = cf.read(path);
    return data ? (utf16Strings(data)[0] ?? "") : "";
  };
  const panels: VijeoPanel[] = [];
  for (const e of cf.entries) {
    if (e.type !== "stream") continue;
    const m = e.path.match(PANEL);
    if (!m?.groups) continue;
    if (DEFINITIONS.some((d) => `/${e.path}`.includes(d))) continue;
    const g = m.groups;
    const root = e.path.slice(0, -"/GraphicalObject".length);
    const storage = root.split("/").pop()!;
    const kind: VijeoPanel["kind"] = g.base ? "base" : g.pop ? "popup" : "template";
    const group = g.pop ? first(`${root.split("/").slice(0, -1).join("/")}/PageListProperties`) || g.grp : g.fold ?? "";
    const data = cf.read(e.path) ?? new Uint8Array(0);
    const { tagdb, dotted } = namesIn(utf16Strings(data));
    panels.push({
      id: `${g.t}/${kind}/${group ? `${group}/` : ""}${storage}`,
      name: first(`${root}/WindowObject`) || storage,
      target: g.t,
      kind,
      group,
      tagdb: [...tagdb].sort(),
      references: [...dotted].sort(),
      bytes: data.length,
    });
  }
  panels.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const variables = [...new Set(panels.flatMap((p) => p.references))].sort();
  const has = (re: RegExp) => cf.entries.some((e) => re.test(e.path));
  return {
    container: name,
    streams: cf.entries.filter((e) => e.type === "stream").length,
    targets: [...new Set(panels.map((p) => p.target))],
    panels,
    variables,
    hasTagDatabase: has(/(^|\/)Services\/TagDatabase$/),
    hasTextTable: has(/LangManager\/LangManagerData$/),
  };
}
