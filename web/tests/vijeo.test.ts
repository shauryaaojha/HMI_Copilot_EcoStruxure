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

import { EXPORT, vdz } from "./helpers/vdz";

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
