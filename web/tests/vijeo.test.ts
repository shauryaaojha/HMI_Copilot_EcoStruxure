/**
 * Vijeo Designer backups, read for their inventory.
 *
 * No real .vdz is available to this repository, so the fixture is built here:
 * a compound file written to [MS-CFB] by `writeCfb` below, in the layout
 * publicly documented for Vijeo Designer 6.2 backups (a ZIP holding
 * <name>.SwxCF; panels as storages under "Target 1/..." with a GraphicalObject
 * stream; variables named in UTF-16 as TagDB.<name>). The compound-file reader
 * itself was also checked against real Windows Installer files, which are the
 * same container. What this proves is the reading; that the layout matches a
 * real backup stays the open question docs/AUDIT_2026-10.md records.
 */

import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readCfb } from "@/lib/ingest/cfb";
import { IngestError } from "@/lib/ingest/errors";
import { refuse, sniff } from "@/lib/ingest/sniff";
import { inventoryVdz, tagReferences } from "@/lib/vijeo/vdz";
import { scanVijeo } from "@/lib/knowledge/scan";

type Node = { name: string; children?: Node[]; data?: Uint8Array };

/** A version-3 compound file, all streams in regular sectors (cutoff 1). */
function writeCfb(top: Node[]): Uint8Array {
  const S = 512;
  const flat: { node: Node; type: number; child: number; right: number; start: number; size: number }[] = [];
  const add = (nodes: Node[]): number => {
    const ids = nodes.map((node) => {
      flat.push({ node, type: node.children ? 1 : 2, child: -1, right: -1, start: 0, size: node.data?.length ?? 0 });
      return flat.length - 1;
    });
    ids.forEach((id, i) => {
      flat[id].right = ids[i + 1] ?? -1;
      if (nodes[i].children) flat[id].child = add(nodes[i].children!);
    });
    return ids[0] ?? -1;
  };
  flat.push({ node: { name: "Root Entry" }, type: 5, child: -1, right: -1, start: 0xfffffffe, size: 0 });
  flat[0].child = add(top);

  const dirSectors = Math.ceil((flat.length * 128) / S);
  let next = 1 + dirSectors;
  const fat: number[] = [0xfffffffd];
  for (let i = 0; i < dirSectors; i++) fat.push(i === dirSectors - 1 ? 0xfffffffe : 1 + i + 1);
  for (const e of flat) {
    if (e.type !== 2 || e.size === 0) continue;
    const n = Math.ceil(e.size / S);
    e.start = next;
    for (let i = 0; i < n; i++) fat[next + i] = i === n - 1 ? 0xfffffffe : next + i + 1;
    next += n;
  }
  const out = new Uint8Array(S * (next + 1));
  const v = new DataView(out.buffer);
  [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].forEach((b, i) => (out[i] = b));
  v.setUint16(0x18, 0x3e, true);
  v.setUint16(0x1a, 3, true);
  v.setUint16(0x1c, 0xfffe, true);
  v.setUint16(0x1e, 9, true);
  v.setUint16(0x20, 6, true);
  v.setUint32(0x2c, 1, true);
  v.setUint32(0x30, 1, true);
  v.setUint32(0x38, 1, true);
  v.setUint32(0x3c, 0xfffffffe, true);
  v.setUint32(0x44, 0xfffffffe, true);
  for (let i = 0; i < 109; i++) v.setUint32(0x4c + i * 4, i === 0 ? 0 : 0xffffffff, true);
  for (let i = 0; i < S / 4; i++) v.setUint32(S + i * 4, fat[i] ?? 0xffffffff, true);
  flat.forEach((e, i) => {
    const o = S * 2 + i * 128;
    const name = new TextEncoder().encode(e.node.name);
    name.forEach((c, j) => v.setUint16(o + j * 2, c, true));
    v.setUint16(o + 0x40, (name.length + 1) * 2, true);
    out[o + 0x42] = e.type;
    v.setUint32(o + 0x44, 0xffffffff, true);
    v.setUint32(o + 0x48, e.right < 0 ? 0xffffffff : e.right, true);
    v.setUint32(o + 0x4c, e.child < 0 ? 0xffffffff : e.child, true);
    v.setUint32(o + 0x74, e.start, true);
    v.setUint32(o + 0x78, e.size, true);
    if (e.node.data) out.set(e.node.data, S * (e.start + 1));
  });
  return out;
}

const u16 = (...strings: string[]) => {
  const parts = strings.flatMap((s) => [0, 0, 7, 0, ...[...s].flatMap((c) => [c.charCodeAt(0), 0])]);
  return new Uint8Array([...parts, ...new Array(600).fill(0)]);
};

async function vdz(name = "Station"): Promise<Uint8Array> {
  const cf = writeCfb([
    {
      name: "Target 1",
      children: [
        { name: "Base", children: [
          { name: "Panel1", children: [{ name: "GraphicalObject", data: u16("TagDB.PUMPS.P5.Running.getIntValue", "TagDB.TANK_LVL", "Pump 5") }] },
          { name: "Panel2", children: [{ name: "GraphicalObject", data: u16("TagDB.TANK_LVL.setIntValue", "TagDB.LAMPS01[3]") }] },
        ] },
        { name: "PopupWindows", children: [{ name: "Panel9", children: [{ name: "GraphicalObject", data: u16("TagDB.PUMPS.P5.Fault") }] }] },
      ],
    },
    { name: "Services", children: [{ name: "TagDatabase", data: new Uint8Array(700) }] },
  ]);
  const zip = new JSZip();
  zip.file(`${name}.SwxCF`, cf);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

describe("the compound-file reader", () => {
  it("walks storages and reads streams", async () => {
    const zip = await JSZip.loadAsync(await vdz());
    const cf = readCfb(await zip.file("Station.SwxCF")!.async("uint8array"));
    expect(cf.entries.filter((e) => e.type === "stream").map((e) => e.path)).toEqual([
      "Target 1/Base/Panel1/GraphicalObject",
      "Target 1/Base/Panel2/GraphicalObject",
      "Target 1/PopupWindows/Panel9/GraphicalObject",
      "Services/TagDatabase",
    ]);
    expect(cf.read("Services/TagDatabase")?.length).toBe(700);
    expect(cf.read("no/such")).toBeUndefined();
  });

  it("refuses a FAT that loops instead of spinning", async () => {
    const zip = await JSZip.loadAsync(await vdz());
    const bytes = await zip.file("Station.SwxCF")!.async("uint8array");
    const v = new DataView(bytes.buffer, bytes.byteOffset);
    // Point the directory's sector back at itself.
    v.setUint32(512 + 1 * 4, 1, true);
    expect(() => readCfb(bytes)).toThrow(IngestError);
  });

  it("refuses something that is not a compound file", () => {
    expect(() => readCfb(new Uint8Array(1024))).toThrow(/signature/);
  });
});

describe("a Vijeo Designer backup", () => {
  it("is recognised by its container, whatever it is called, and refused with what to do instead", async () => {
    const k = await sniff(await vdz(), "backup.zip");
    expect(k).toMatchObject({ kind: "vijeo-designer", variant: "vdz" });
    expect(refuse(k, "backup.zip")?.hint).toMatch(/Export the variables/);
  });

  it("lists panels by kind and the variables each references", async () => {
    const inv = await inventoryVdz(await vdz());
    expect(inv.container).toBe("Station");
    expect(inv.targets).toEqual(["Target 1"]);
    expect(inv.panels.map((p) => [p.id, p.kind, p.references])).toEqual([
      ["Target 1/Base/Panel1", "base", ["PUMPS.P5.Running", "TANK_LVL"]],
      ["Target 1/Base/Panel2", "base", ["LAMPS01[3]", "TANK_LVL"]],
      ["Target 1/PopupWindows/Panel9", "popup", ["PUMPS.P5.Fault"]],
    ]);
    expect(inv.variables).toEqual(["LAMPS01[3]", "PUMPS.P5.Fault", "PUMPS.P5.Running", "TANK_LVL"]);
    expect(inv.hasTagDatabase).toBe(true);
  });

  it("takes only TagDB expressions, cut at the accessor", () => {
    expect(tagReferences(["TagDB.A.B.getBoolValue", "A.B.C", "x TagDB.Q_1 y"])).toEqual(["A.B", "Q_1"]);
  });

  it("scans into the knowledge base honestly: references, no invented objects", async () => {
    const k = await scanVijeo(await vdz(), "Station.vdz");
    expect(k.source).toEqual({ product: "Vijeo Designer", layout: "vijeo" });
    expect(k.counts).toMatchObject({ screens: 2, contentScreens: 1, objects: 0, variables: 4, bindings: 5 });
    expect(k.problems[0]).toMatch(/binary format/);
  });

  it("refuses a ZIP with no container", async () => {
    const zip = new JSZip();
    zip.file("readme.txt", "hi");
    await expect(inventoryVdz(await zip.generateAsync({ type: "uint8array" }))).rejects.toThrow(/no \.SwxCF/);
  });
});
