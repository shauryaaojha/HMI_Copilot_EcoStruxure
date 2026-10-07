/**
 * Vijeo Designer project backups (.vdz): what is in one, read-only.
 *
 * What is known, and from where:
 * - A .vdz is what Vijeo Designer writes on File > Backup project (and Vijeo
 *   Manager on export): Schneider FAQ FA268436, Machine Expert help.
 * - It is a ZIP holding one OLE compound file, `<name>.SwxCF`; panels are
 *   storages under `Target N/...` whose `GraphicalObject` stream is the screen,
 *   and a screen refers to a variable as a UTF-16 expression `TagDB.<name>`.
 *   The variable database is `Services/TagDatabase`, the text table
 *   `LangManager/LangManagerData`. This layout was established by an
 *   independent reverse-engineering of Vijeo Designer 6.2 projects
 *   (github.com/apexsotjo-blip/vijeo-mcp, verified there against Vijeo's own
 *   load and save); this module is written here from those facts, not copied.
 *
 * What this does with it is deliberately modest. The panel stream is a
 * binary MFC serialisation nobody has published, so no object is modelled and
 * nothing is ever written. What *can* be read reliably is the inventory: which
 * targets and panels exist, what each panel is called in the container, and
 * which variables each one references by `TagDB.` expression - which is
 * exactly what a migration estimate, a knowledge-base record, and the question
 * "which of these 2,900 tags does the HMI actually use?" need.
 */

import JSZip from "jszip";
import { readCfb, type CompoundFile } from "@/lib/ingest/cfb";
import { IngestError } from "@/lib/ingest/errors";
import { guardZip } from "@/lib/ingest/zip";

export interface VijeoPanel {
  /** Container path of the panel's storage, e.g. "Target 1/Base/Panel18". */
  id: string;
  target: string;
  kind: "base" | "popup" | "template" | "other";
  /** Variables the panel's expressions name, without the TagDB. prefix or accessor. */
  references: string[];
  /** Size of the GraphicalObject stream: a rough measure of how much is drawn. */
  bytes: number;
}

export interface VijeoInventory {
  container: string;
  streams: number;
  targets: string[];
  panels: VijeoPanel[];
  /** Every variable referenced by any panel, sorted. */
  variables: string[];
  /** Whether the variable database and text table streams exist. */
  hasTagDatabase: boolean;
  hasTextTable: boolean;
}

const U16 = /(?:[\x20-\x7e]\x00){4,}/g;

/** UTF-16LE runs of printable ASCII, the way the panel stream stores identifiers. */
function utf16Strings(data: Uint8Array): string[] {
  const latin = new TextDecoder("latin1").decode(data);
  const out: string[] = [];
  for (const m of latin.matchAll(U16)) out.push(m[0].replace(/\x00/g, ""));
  return out;
}

/**
 * `TagDB.PUMPS.P5.Running.getIntValue` -> `PUMPS.P5.Running`. Accessor methods
 * (get/set/is + capital) end the variable path; only expressions that start
 * TagDB. are taken, because a bare dotted string may be anything.
 */
export function tagReferences(strings: string[]): string[] {
  const out = new Set<string>();
  for (const s of strings) {
    for (const m of s.matchAll(/TagDB\.([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*)/g)) {
      const parts = m[1].split(".");
      const cut = parts.findIndex((p, i) => i > 0 && /^(get|set|is)[A-Z]/.test(p));
      out.add((cut > 0 ? parts.slice(0, cut) : parts).join("."));
    }
  }
  return [...out].sort();
}

function kindOf(path: string): VijeoPanel["kind"] {
  const p = path.toLowerCase();
  if (/(^|\/)base(\/|$)/.test(p)) return "base";
  if (/(^|\/)popup/.test(p)) return "popup";
  if (/(^|\/)template/.test(p)) return "template";
  return "other";
}

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
  const panels: VijeoPanel[] = [];
  for (const e of cf.entries) {
    if (e.type !== "stream" || !/\/GraphicalObject$/.test(e.path)) continue;
    const id = e.path.replace(/\/GraphicalObject$/, "");
    const data = cf.read(e.path) ?? new Uint8Array(0);
    panels.push({ id, target: id.split("/")[0], kind: kindOf(id), references: tagReferences(utf16Strings(data)), bytes: data.length });
  }
  panels.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
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
