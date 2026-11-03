/**
 * A real project from Schneider's "HMI Panel - 1" training rig: an HMIST6600
 * talking Machine Expert network protocol to an M251 PLC, which drives an
 * ATV340 over Ethernet. Every tag is a PLC symbol, so a binding has to name it
 * `MachineExpertEquipment1.<POU>.<tag>` with the folder ids in ParentIds; a
 * bare `Motor_Current.Value` binds to nothing on the panel.
 *
 * samples/hmi-panel-1/README.md has the reverse-engineered picture.
 */

import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readProject } from "@/lib/ote/reader";
import { packageProject } from "@/lib/ote/packager";
import type { BindingGraph } from "@/lib/ote/bindings";

const FILE = path.join(__dirname, "..", "..", "samples", "hmi-panel-1", "auto-manual.eote");
const bytes = () => new Uint8Array(fs.readFileSync(FILE));

const graphOf = async (b: Uint8Array) => {
  const zip = await JSZip.loadAsync(b);
  const raw = await zip.file("Bindings.dat")!.async("string");
  return JSON.parse(raw.replace(/^﻿/, "")) as BindingGraph;
};
const entry = async (b: Uint8Array, name: string) => {
  const zip = await JSZip.loadAsync(b);
  const norm = (n: string) => n.replace(/\\/g, "/").toLowerCase();
  return Object.values(zip.files).find((f) => norm(f.name) === norm(name))!.async("uint8array");
};

const GVL = "F9BDED1A-071E-4DE7-9790-60B738DB4376,2D81897A-70C2-4273-AFB6-FC1EAE3642D5";

// The project is local only: it carries the rig's PLC connection.
describe.skipIf(!fs.existsSync(FILE))("a real Machine Expert symbol project", () => {
  it("reads each symbol tag's full binding name and parent ids", async () => {
    const read = await readProject(bytes(), "auto-manual.eote");
    const refs = read.preserved.variableRefs ?? {};
    expect(refs.Motor_Current).toEqual({ fullName: "MachineExpertEquipment1.GVL.Motor_Current", parentIds: GVL });
    expect(refs["AUTOOFF.IN"].fullName).toBe("MachineExpertEquipment1.Main.AUTOOFF.IN");
    // An HMI-internal tag at the top level has no folder and keeps its bare name.
    expect(refs.Drive_Status).toBeUndefined();
    expect(read.wires.map((w) => w.tag)).toContain("AUTOMAN");
  });

  it("rewrites bindings with the names the product wrote", async () => {
    const original = await graphOf(bytes());
    const read = await readProject(bytes(), "auto-manual.eote");
    // Rebind Screen1's display from the reference to the output frequency:
    // the whole graph is rebuilt from the wires, so every binding is rewritten.
    // The mode is dropped as the client drops it; the writer has it from the file.
    const wires = read.wires.map(({ mode: _mode, ...w }) =>
      w.tag === "Reference_Frequency" ? { ...w, tag: "Motor_Freq" } : w,
    );
    const out = await packageProject({ ...read, wires }, undefined, read.preserved);
    const graph = await graphOf(out);

    const freq = graph.Sources.find((s) => s.ObjectFullName.endsWith("Motor_Freq"));
    expect(freq).toMatchObject({ ObjectFullName: "MachineExpertEquipment1.GVL.Motor_Freq", ParentIds: GVL });
    const texts = new Set(graph.Bindings.map((b) => b.BindingText));
    expect(texts).toContain("MachineExpertEquipment1.GVL.Motor_Freq.Value");
    expect(texts).not.toContain("Motor_Freq.Value");

    // Every other binding comes back with the same text, mode and property.
    const key = (b: BindingGraph["Bindings"][number]) => `${b.Type}|${b.Mode}|${b.TargetProperty}|${b.BindingText}`;
    const before = original.Bindings.map(key).filter((k) => !k.includes("Reference_Frequency.Value"));
    const after = graph.Bindings.map(key).filter((k) => !k.includes("Motor_Freq.Value"));
    expect(after.sort()).toEqual(before.sort());
    // And every variable source keeps its full name and parent ids.
    const sourceKey = (s: BindingGraph["Sources"][number]) => `${s.ObjectFullName}|${s.ParentIds ?? ""}`;
    const kept = new Set(graph.Sources.map(sourceKey));
    for (const s of original.Sources) {
      if (s.ObjectType === 4 && !s.ObjectFullName.endsWith("Reference_Frequency")) expect(kept).toContain(sourceKey(s));
    }
  });

  it("numbers a new screen past the ones the project has, folder included", async () => {
    const read = await readProject(bytes(), "auto-manual.eote");
    const extra = { ...read.screens.find((s) => s.Name === "Screen2")!, UniqueId: "11111111-2222-3333-4444-555555555555", Name: "Added" };
    const out = await packageProject({ ...read, screens: [...read.screens, extra] }, undefined, read.preserved);
    const zip = await JSZip.loadAsync(out);
    const ids = await Promise.all(
      Object.keys(zip.files)
        .filter((n) => /^Screens[\\/][^\\/]+[\\/]Metadata\.dat$/.test(n))
        .map(async (n) => JSON.parse((await zip.file(n)!.async("string")).replace(/^﻿/, "")).Id as number),
    );
    // Screen1..3 are 1, 3, 4 and Folder1 is 2.
    expect(ids.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it("hangs a new screen under the master screen, so it gets the project's header", async () => {
    const read = await readProject(bytes(), "auto-manual.eote");
    const extra = { ...read.screens.find((s) => s.Name === "Screen2")!, UniqueId: "11111111-2222-3333-4444-555555555555", Name: "Added" };
    const out = await packageProject({ ...read, screens: [...read.screens, extra] }, undefined, read.preserved);
    const tree = JSON.parse(new TextDecoder().decode(await entry(out, "Screens/Hierarchy.dat")).replace(/^﻿/, ""));
    // One top-level node, the MasterScreen; its screens, and now ours, under it.
    expect(tree).toHaveLength(1);
    expect(tree[0].Children.map((c: { ObjectId: string }) => c.ObjectId)).toContain(extra.UniqueId);

    // And a deleted screen leaves the master's branch rather than staying listed.
    const gone = read.screens.find((s) => s.Name === "Screen2")!;
    const less = await packageProject({ ...read, screens: read.screens.filter((s) => s !== gone) }, undefined, read.preserved);
    const after = JSON.parse(new TextDecoder().decode(await entry(less, "Screens/Hierarchy.dat")).replace(/^﻿/, ""));
    expect(JSON.stringify(after)).not.toContain(gone.UniqueId);
  });

  it("leaves the PLC connection and the tag database as they were", async () => {
    const read = await readProject(bytes(), "auto-manual.eote");
    const wires = read.wires.map((w) => (w.tag === "Reference_Frequency" ? { ...w, tag: "Motor_Freq" } : w));
    const out = await packageProject({ ...read, wires }, undefined, read.preserved);
    for (const name of ["DriverConfig.db", "Variables.db", "Target.dat", "GlobalScripts.dat"]) {
      expect(Buffer.from(await entry(out, name)).equals(Buffer.from(await entry(bytes(), name)))).toBe(true);
    }
  });
});
