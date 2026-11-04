/**
 * Audit 2026-11, stream S1: the .eote writer. Each `it` proves one bug in
 * docs/audit/BUGS.md and FAILS on the code it was written against (5fd701d).
 * Built from a project the app itself writes (the local skeleton), never from
 * an engineer's file, so it runs on any checkout that has web/skeleton/.
 *
 *   cd web && MONGODB_URI= npx vitest run --config scripts/audit/vitest.config.mts scripts/audit/s1-eote-writer.test.ts
 */
import { existsSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { openDatabase, packageProject } from "@/lib/ote/packager";
import { readProject } from "@/lib/ote/reader";
import { numericDisplay, rectangle } from "@/lib/ote/parts";
import { unsupportedParts } from "@/lib/backend/types";
import { OTE } from "@/lib/backend/ote";
import type { Part, Screen, Variable } from "@/lib/ote/schema";
import type { Wire } from "@/lib/ote/bindings";

const SKELETON = existsSync(path.join(__dirname, "..", "..", "skeleton", "manifest.json"));

type J = Record<string, any>;
const v = (Name: string): Variable => ({ Name, DataType: "INT", Comments: "", DeviceAddress: "" });

/** One screen, three parts, each bound to its own tag: a project the app writes. */
async function base() {
  const a = rectangle("PartA", { left: 10, top: 10, width: 50, height: 50 });
  const b = rectangle("PartB", { left: 100, top: 10, width: 50, height: 50 });
  const c = numericDisplay("PartC", { left: 200, top: 10, width: 80, height: 30 });
  const screen: Screen = {
    Type: "Screen",
    UniqueId: "4a1b2c3d-0000-4000-8000-000000000001",
    Name: "Main",
    Children: [{ Type: "Canvas", UniqueId: "4a1b2c3d-0000-4000-8000-000000000002", Name: "Root", Children: [a, b, c] }],
  } as Screen;
  const wires: Wire[] = [
    { part: a, tag: "TagA", property: "Animation.FillLevel.VerticalFill", screenId: screen.UniqueId },
    { part: b, tag: "TagB", property: "Animation.FillLevel.VerticalFill", screenId: screen.UniqueId },
    { part: c, tag: "TagC", property: "CurrentValue", screenId: screen.UniqueId },
  ];
  const bytes = await packageProject({ name: "Audit", target: { model: "HMIST6500AWADI", width: 1024, height: 600 }, screens: [screen], variables: [v("TagA"), v("TagB"), v("TagC")], alarms: [], wires });
  return { bytes, a, b, c, screen };
}

/** Rewrites entries of a project with JSZip, as a hand edit of the file would. */
async function patch(bytes: Uint8Array, edit: (zip: JSZip, json: (n: string) => Promise<J>, put: (n: string, v: unknown) => void) => Promise<void>) {
  const zip = await JSZip.loadAsync(bytes);
  const name = (n: string) => Object.keys(zip.files).find((k) => k.split("\\").join("/").toLowerCase() === n.toLowerCase())!;
  const json = async (n: string) => JSON.parse((await zip.files[name(n)].async("string")).replace(/^\uFEFF/, ""));
  const put = (n: string, value: unknown) => zip.file(name(n) ?? n, JSON.stringify(value, null, 2), { createFolders: false });
  await edit(zip, json, put);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
const screenDat = (s: Screen) => `Screens/${s.UniqueId}/Screen.dat`;
async function graph(bytes: Uint8Array): Promise<J> {
  const zip = await JSZip.loadAsync(bytes);
  const n = Object.keys(zip.files).find((k) => /^Bindings\.dat$/i.test(k))!;
  return JSON.parse((await zip.files[n].async("string")).replace(/^\uFEFF/, ""));
}
const targetOf = (g: J, row: J) => g.Targets.find((t: J) => t.ReferenceId === row.Target);

/** The store's export of a read project after `screens` and `wires` changed: what /api/export writes. */
async function exportAfter(bytes: Uint8Array, change: (read: Awaited<ReturnType<typeof readProject>>) => { screens: Screen[]; wires: Wire[]; variables?: Variable[] }) {
  const read = await readProject(bytes, "audit.eote");
  const { screens, wires, variables } = change(read);
  const fresh = await readProject(bytes);
  return OTE.write({ name: read.name, target: read.target, screens, variables: variables ?? read.variables, alarms: read.alarms, wires }, fresh.preserved);
}
const without = (screens: Screen[], id: string) =>
  screens.map((s) => ({ ...s, Children: [{ ...s.Children[0], Children: s.Children[0].Children.filter((p) => p.UniqueId !== id) }] }) as Screen);

describe.skipIf(!SKELETON)("S1 .eote writer", () => {
  it("S1-01 the export gate accepts a project holding a Compound Object instance", () => {
    // The export route (app/api/export/route.ts:99) refuses with 409 whatever this returns.
    const co = { Type: "CompoundObject", Definition: "Switch_PB04", UniqueId: "4a1b2c3d-0000-4000-8000-0000000000c0", Name: "Btn", Location: { Left: 0, Top: 0 }, Width: 80, Height: 40 } as unknown as Part;
    const screen = { Type: "Screen", UniqueId: "4a1b2c3d-0000-4000-8000-0000000000c1", Name: "S", Children: [{ Type: "Canvas", UniqueId: "4a1b2c3d-0000-4000-8000-0000000000c2", Name: "R", Children: [co] }] } as Screen;
    const refused = unsupportedParts([screen], OTE).map((m) => m.type);
    expect(refused, "export route would answer 409 'cannot write CompoundObject'").toEqual([]);
  });

  it("S1-02 a binding rebuild keeps a Compound Object target's SubType and the source's PropertyFullName", async () => {
    const { bytes, a, b } = await base();
    // B is a Compound Object instance, bound as the product writes it.
    const edited = await patch(bytes, async (_z, json, put) => {
      const { screen } = await base();
      const sd = await json(screenDat({ ...screen, UniqueId: (await readProject(bytes)).screens[0].UniqueId } as Screen));
      for (const p of sd.Children[0].Children) if (p.UniqueId === b.UniqueId) p.Type = "CompoundObject.Def";
      put(`Screens/${(await readProject(bytes)).screens[0].UniqueId}/Screen.dat`, sd);
      const g = await json("Bindings.dat");
      for (const t of g.Targets) if (t.ObjectId === b.UniqueId) t.SubType = "CompoundObject.Def";
      for (const s of g.Sources) s.PropertyFullName = "Value";
      put("Bindings.dat", g);
    });
    // The engineer deletes A: its wire goes, so Bindings.dat is rebuilt.
    const out = await exportAfter(edited, (read) => ({ screens: without(read.screens, a.UniqueId), wires: read.wires.filter((w) => w.part.UniqueId !== a.UniqueId) }));
    const g = await graph(out);
    const rowB = g.Bindings.find((r: J) => targetOf(g, r)?.ObjectId === b.UniqueId);
    expect(targetOf(g, rowB).SubType, "the untouched CO binding's target SubType").toBe("CompoundObject.Def");
    const src = g.Sources.find((s: J) => s.ReferenceId === Number(rowB.Sources));
    expect(src.PropertyFullName, "the untouched binding's source PropertyFullName").toBe("Value");
  });

  it("S1-03 an edit to one tag keeps every other variable's InitialValue", async () => {
    const { bytes } = await base();
    const zip = await JSZip.loadAsync(bytes);
    const vn = Object.keys(zip.files).find((k) => /^Variables\.db$/i.test(k))!;
    const db = await openDatabase(await zip.files[vn].async("uint8array"));
    db.run(`UPDATE Variables SET "InitialValue" = '42' WHERE "Name" = 'TagA'`);
    zip.file(vn, db.export(), { createFolders: false });
    db.close();
    const withInit = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    // The engineer changes TagC's comment and nothing else.
    const out = await exportAfter(withInit, (read) => ({
      screens: read.screens,
      wires: read.wires,
      variables: read.variables.map((x) => (x.Name === "TagC" ? { ...x, Comments: "edited" } : x)),
    }));
    const z2 = await JSZip.loadAsync(out);
    const db2 = await openDatabase(await z2.files[vn].async("uint8array"));
    const init = db2.exec(`SELECT "InitialValue" FROM Variables WHERE "Name" = 'TagA'`)[0].values[0][0];
    db2.close();
    expect(init, "TagA's InitialValue after an edit to TagC").toBe("42");
  });

  it("S1-04 deleting a part leaves no binding row that targets it", async () => {
    const { bytes, b } = await base();
    // B's binding goes through a converter the reader cannot model, so it is carried, not a wire.
    const edited = await patch(bytes, async (_z, json, put) => {
      const g = await json("Bindings.dat");
      for (const r of g.Bindings) if (targetOf(g, r)?.ObjectId === b.UniqueId) {
        r.ConverterId = "11111111-2222-4333-8444-555555555555";
        r.ConverterName = "SomeExpression";
      }
      put("Bindings.dat", g);
    });
    const read = await readProject(edited);
    expect(read.wires.some((w) => w.part.UniqueId === b.UniqueId)).toBe(false);
    // The engineer deletes B. No modelled wire changes, so Bindings.dat is kept as it was.
    const out = await exportAfter(edited, (r) => ({ screens: without(r.screens, b.UniqueId), wires: r.wires }));
    const g = await graph(out);
    const dangling = g.Bindings.filter((r: J) => targetOf(g, r)?.ObjectId === b.UniqueId).length;
    expect(dangling, "binding rows still targeting the deleted part").toBe(0);
  });

  it("S1-05 a carried binding on a part that also has a modelled wire keeps pointing at that part after a rebuild", async () => {
    const { bytes, a, b, c } = await base();
    // B gets a second binding, through an unmodelled converter, on the same Target row as its wire.
    const edited = await patch(bytes, async (_z, json, put) => {
      const g = await json("Bindings.dat");
      const row = g.Bindings.find((r: J) => targetOf(g, r)?.ObjectId === b.UniqueId);
      g.Bindings.push({ ...row, TargetProperty: "Visibility", ConverterId: "11111111-2222-4333-8444-555555555555", ConverterName: "SomeExpression", Mode: 1 });
      put("Bindings.dat", g);
    });
    // Deleting A rebuilds the graph: the carried row is re-appended by appendExtra.
    const out = await exportAfter(edited, (read) => ({ screens: without(read.screens, a.UniqueId), wires: read.wires.filter((w) => w.part.UniqueId !== a.UniqueId) }));
    const g = await graph(out);
    const vis = g.Bindings.find((r: J) => r.TargetProperty === "Visibility");
    expect(targetOf(g, vis)?.ObjectId, `the Visibility binding now targets ${targetOf(g, vis)?.ObjectId === c.UniqueId ? "PartC" : String(targetOf(g, vis)?.ObjectId)}`).toBe(b.UniqueId);
  });
});
