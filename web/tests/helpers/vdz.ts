/**
 * A Vijeo Designer backup built to the documented 6.2 layout, for tests and
 * route checks: a ZIP holding <name>.SwxCF, a compound file written to
 * [MS-CFB]. No real .vdz is available to this repository.
 */

import JSZip from "jszip";

export type Node = { name: string; children?: Node[]; data?: Uint8Array };

/** A version-3 compound file, all streams in regular sectors (cutoff 1). */
export function writeCfb(top: Node[]): Uint8Array {
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

export const u16 = (...strings: string[]) => {
  const parts = strings.flatMap((s) => [0, 0, 7, 0, ...[...s].flatMap((c) => [c.charCodeAt(0), 0])]);
  return new Uint8Array([...parts, ...new Array(600).fill(0)]);
};

/** A panel storage: its screen, and the stream that holds its designer name. */
export const panel = (storage: string, name: string, ...refs: string[]): Node => ({
  name: storage,
  children: [
    { name: "GraphicalObject", data: u16(...refs) },
    { name: "WindowObject", data: u16(name) },
  ],
});

/** A backup in the layout documented for Vijeo Designer 6.2. */
export async function vdz(name = "Station"): Promise<Uint8Array> {
  const cf = writeCfb([
    {
      name: "Targets",
      children: [
        {
          name: "Target1",
          children: [
            {
              name: "Component 1",
              children: [
                {
                  name: "WindowList",
                  children: [
                    {
                      name: "BasePanelsList",
                      children: [
                        panel("Panel1", "Pump House", "TagDB.PUMPS.PMP_101_RUN.getIntValue", "TagDB.PUMPS.PMP_101_FLT", "PUMPS.PMP_102_RUN", "Pump 1"),
                        panel("Panel2", "Tanks", "TagDB.TANKS.TNK_1_LEVEL.getRealValue"),
                        panel("Panel3", "About", "Version 2.1"),
                      ],
                    },
                    { name: "DefinitionNodeStorage", children: [{ name: "Faceplates", children: [panel("Panel7", "PumpTemplate", "TagDB.PUMPS.PMP_101_RUN")] }] },
                  ],
                },
                {
                  name: "PopupWindowList",
                  children: [{ name: "Group1", children: [{ name: "PageListProperties", data: u16("Pump popups") }, panel("Panel9", "Pump detail", "TagDB.PUMPS.PMP_101_FLT")] }],
                },
              ],
            },
          ],
        },
      ],
    },
    { name: "Services", children: [{ name: "TagDatabase", data: new Uint8Array(700) }] },
  ]);
  const zip = new JSZip();
  zip.file(`${name}.SwxCF`, cf);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** The Vijeo variable export that would go with it. */
export const EXPORT = [
  "Vijeo-Designer variable export",
  "Type,Name,Data Type,Data Source,Description,Scan Group,Device Address",
  "Folder,PUMPS,,,,,",
  'Variable,PUMPS.PMP_101_RUN,BOOL,Internal,"Pump 1 running",,',
  'Variable,PUMPS.PMP_101_FLT,BOOL,Internal,"Pump 1 fault",,',
  'Variable,PUMPS.PMP_102_RUN,BOOL,Internal,"Pump 2 running",,',
  "Folder,TANKS,,,,,",
  'Variable,TANKS.TNK_1_LEVEL,REAL,Internal,"Tank 1 level",,',
].join("\r\n");

