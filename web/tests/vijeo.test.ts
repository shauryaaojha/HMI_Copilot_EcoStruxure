/**
 * Vijeo Designer backups, read for their inventory.
 *
 * No real .vdz is available to this repository, so the fixture is built here:
 * a compound file written to [MS-CFB] by `writeCfb` below, in the layout
 * publicly documented for Vijeo Designer 6.2 backups (a ZIP holding
 * <name>.SwxCF; panels as storages under "Targets/<t>/Component N/WindowList/
 * BasePanelsList/PanelN" with GraphicalObject and WindowObject streams;
 * variables named in UTF-16 as TagDB.<name> or FOLDER.NAME). The compound-file reader
 * itself was also checked against real Windows Installer files, which are the
 * same container. What this proves is the reading; that the layout matches a
 * real backup stays the open question docs/AUDIT_2026-10.md records.
 */

import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readCfb } from "@/lib/ingest/cfb";
import { IngestError } from "@/lib/ingest/errors";
import { refuse, sniff } from "@/lib/ingest/sniff";
import { inventoryVdz, namesIn, tagReferences } from "@/lib/vijeo/vdz";
import { planMigration, shortNames } from "@/lib/vijeo/migrate";
import { parseTagsFile } from "@/lib/tags/parse";
import { runPipeline } from "@/lib/ai/pipeline";
import type { GenerationEvent } from "@/types/events";
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

/** A panel storage: its screen, and the stream that holds its designer name. */
const panel = (storage: string, name: string, ...refs: string[]): Node => ({
  name: storage,
  children: [
    { name: "GraphicalObject", data: u16(...refs) },
    { name: "WindowObject", data: u16(name) },
  ],
});

/** A backup in the layout documented for Vijeo Designer 6.2. */
async function vdz(name = "Station"): Promise<Uint8Array> {
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
const EXPORT = [
  "Vijeo-Designer variable export",
  "Type,Name,Data Type,Data Source,Description,Scan Group,Device Address",
  "Folder,PUMPS,,,,,",
  'Variable,PUMPS.PMP_101_RUN,BOOL,Internal,"Pump 1 running",,',
  'Variable,PUMPS.PMP_101_FLT,BOOL,Internal,"Pump 1 fault",,',
  'Variable,PUMPS.PMP_102_RUN,BOOL,Internal,"Pump 2 running",,',
  "Folder,TANKS,,,,,",
  'Variable,TANKS.TNK_1_LEVEL,REAL,Internal,"Tank 1 level",,',
].join("\r\n");

describe("the compound-file reader", () => {
  it("walks storages and reads streams", async () => {
    const zip = await JSZip.loadAsync(await vdz());
    const cf = readCfb(await zip.file("Station.SwxCF")!.async("uint8array"));
    const streams = cf.entries.filter((e) => e.type === "stream").map((e) => e.path);
    expect(streams).toContain("Targets/Target1/Component 1/WindowList/BasePanelsList/Panel1/GraphicalObject");
    expect(streams).toContain("Services/TagDatabase");
    expect(cf.read("Services/TagDatabase")?.length).toBe(700);
    expect(cf.read("no/such")).toBeUndefined();
  });

  it("refuses a FAT that loops instead of spinning", async () => {
    const zip = await JSZip.loadAsync(await vdz());
    const bytes = await zip.file("Station.SwxCF")!.async("uint8array");
    const v = new DataView(bytes.buffer, bytes.byteOffset);
    v.setUint32(512 + 1 * 4, 1, true);
    expect(() => readCfb(bytes)).toThrow(IngestError);
  });

  it("refuses something that is not a compound file", () => {
    expect(() => readCfb(new Uint8Array(1024))).toThrow(/signature/);
  });
});

describe("a Vijeo Designer backup", () => {
  it("is recognised by its container, whatever it is called, and refused for opening with what to do instead", async () => {
    const k = await sniff(await vdz(), "backup.zip");
    expect(k).toMatchObject({ kind: "vijeo-designer", variant: "vdz" });
    expect(refuse(k, "backup.zip")?.hint).toMatch(/Export the variables/);
  });

  it("lists panels by designer name and kind, with what each references", async () => {
    const inv = await inventoryVdz(await vdz());
    expect(inv.container).toBe("Station");
    expect(inv.targets).toEqual(["Target1"]);
    expect(inv.panels.map((p) => [p.id, p.name, p.kind, p.group])).toEqual([
      ["Target1/base/Panel1", "Pump House", "base", ""],
      ["Target1/base/Panel2", "Tanks", "base", ""],
      ["Target1/base/Panel3", "About", "base", ""],
      ["Target1/popup/Pump popups/Panel9", "Pump detail", "popup", "Pump popups"],
      ["Target1/template/Faceplates/Panel7", "PumpTemplate", "template", "Faceplates"],
    ]);
    const house = inv.panels[0];
    expect(house.tagdb).toEqual(["PUMPS.PMP_101_FLT", "PUMPS.PMP_101_RUN"]);
    expect(house.references).toEqual(["PUMPS.PMP_101_FLT", "PUMPS.PMP_101_RUN", "PUMPS.PMP_102_RUN"]);
    expect(inv.hasTagDatabase).toBe(true);
  });

  it("reads TagDB expressions as certain and dotted names as probable, cut at the accessor", () => {
    const n = namesIn(["TagDB.A.B.getBoolValue", "A.B.C", "x TagDB.Q_1 y", "Pump 1"]);
    expect([...n.tagdb].sort()).toEqual(["A.B", "Q_1"]);
    expect([...n.dotted].sort()).toEqual(["A.B", "A.B.C", "Q_1"]);
    expect(tagReferences(["TagDB.A.B.getBoolValue"])).toEqual(["A.B"]);
  });

  it("scans into the knowledge base honestly: references, no invented objects", async () => {
    const k = await scanVijeo(await vdz(), "Station.vdz");
    expect(k.source).toEqual({ product: "Vijeo Designer", layout: "vijeo" });
    expect(k.screens.map((s) => s.name)).toContain("Pump House");
    expect(k.counts.objects).toBe(0);
    expect(k.problems[0]).toMatch(/binary format/);
  });

  it("refuses a ZIP with no container", async () => {
    const zip = new JSZip();
    zip.file("readme.txt", "hi");
    await expect(inventoryVdz(await zip.generateAsync({ type: "uint8array" }))).rejects.toThrow(/no \.SwxCF/);
  });
});

describe("migrating to OTE", () => {
  const PANEL = { width: 1024, height: 768 };

  it("names variables known only by path after their shortest telling tail", () => {
    expect(shortNames(["PUMPS.PMP_101_RUN", "A.P5.Running", "B.P6.Running", "LAMPS01[3]"])).toEqual(["PMP_101_RUN", "P5_Running", "P6_Running", "LAMPS01_3"]);
  });

  it("with the variable export: one screen per base panel, its units, the real types", async () => {
    const parsed = await parseTagsFile(new TextEncoder().encode(EXPORT), "vars.csv");
    expect(parsed.variables.map((v) => v.Name)).toEqual(["PMP_101_RUN", "PMP_101_FLT", "PMP_102_RUN", "TNK_1_LEVEL"]);
    const plan = planMigration(await inventoryVdz(await vdz()), PANEL, parsed);
    expect(plan.report.migrated).toEqual([
      { panel: "Pump House", screen: "Pump_House", units: ["PMP_101", "PMP_102"] },
      { panel: "Tanks", screen: "Tanks", units: ["TNK_1"] },
    ]);
    expect(plan.programs.map((p) => [p.name, p.title, p.faceplates])).toEqual([
      ["Pump_House", "Pump House", ["PMP_101", "PMP_102"]],
      ["Tanks", "Tanks", ["TNK_1"]],
    ]);
    expect(plan.programs[0].sections).toContain("alarms");
    expect(plan.report.assumedTypes).toEqual([]);
    expect(plan.report.unknownReferences).toEqual([]);
    const not = Object.fromEntries(plan.report.notMigrated.map((n) => [n.panel, n.reason]));
    expect(not["About"]).toMatch(/names no variable/);
    expect(not["Pump detail"]).toMatch(/popup/);
    expect(not["PumpTemplate"]).toMatch(/template/);
  });

  it("without it: the same screens, every assumed data type listed", async () => {
    const plan = planMigration(await inventoryVdz(await vdz()), PANEL);
    expect(plan.programs.map((p) => p.name)).toEqual(["Pump_House", "Tanks"]);
    expect(plan.report.assumedTypes).toContainEqual({ tag: "PMP_101_RUN", dataType: "BOOL" });
    expect(plan.report.assumedTypes).toContainEqual({ tag: "TNK_1_LEVEL", dataType: "REAL" });
  });

  it("compiles exactly those screens, and nothing the source did not have", async () => {
    process.env.AI_PROVIDER = "none";
    const parsed = await parseTagsFile(new TextEncoder().encode(EXPORT), "vars.csv");
    const plan = planMigration(await inventoryVdz(await vdz()), PANEL, parsed);
    const events: GenerationEvent[] = [];
    for await (const e of runPipeline({ intent: "migrate", variables: plan.variables, panel: { model: "HMIGTO6310", ...PANEL }, programs: plan.programs })) events.push(e);
    const screens = events.filter((e): e is Extract<GenerationEvent, { type: "program" }> => e.type === "program").map((e) => e.screenName);
    expect(screens).toEqual(["Pump_House", "Tanks"]);
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(events.filter((e) => e.type === "binding").length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "alarm")).toBe(true);
  });
});
