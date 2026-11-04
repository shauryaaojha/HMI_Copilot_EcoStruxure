/**
 * The .eote writer keeps what the engineer's file holds. Regression tests for the
 * writer bugs of docs/audit/BUGS.md (S1-0x), moved here from web/scripts/audit/
 * as each one was fixed. Built from a project the app itself writes (the local
 * skeleton), never from an engineer's file.
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

const SKELETON = existsSync(path.join(__dirname, "..", "skeleton", "manifest.json"));

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

describe.skipIf(!SKELETON)("the .eote writer keeps what the file holds", () => {
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


  it("S1-03 a change of data type still resets the initial value to the new type's default", async () => {
    const { bytes } = await base();
    const zip = await JSZip.loadAsync(bytes);
    const vn = Object.keys(zip.files).find((k) => /^Variables\.db$/i.test(k))!;
    const db = await openDatabase(await zip.files[vn].async("uint8array"));
    db.run(`UPDATE Variables SET "InitialValue" = '42' WHERE "Name" = 'TagA'`);
    zip.file(vn, db.export(), { createFolders: false });
    db.close();
    const withInit = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const out = await exportAfter(withInit, (read) => ({
      screens: read.screens,
      wires: read.wires,
      variables: read.variables.map((x) => (x.Name === "TagA" ? { ...x, DataType: "BOOL" } : x)),
    }));
    const z2 = await JSZip.loadAsync(out);
    const db2 = await openDatabase(await z2.files[vn].async("uint8array"));
    const [type, init] = db2.exec(`SELECT "DataType", "InitialValue" FROM Variables WHERE "Name" = 'TagA'`)[0].values[0];
    db2.close();
    expect(type).toBe("BOOL");
    expect(init, "42 is not a BOOL, so the type's default replaces it").not.toBe("42");
  });

  describe("a STRING tag gets the Type and Size the product writes", () => {
    const row = async (bytes: Uint8Array, name: string) => {
      const zip = await JSZip.loadAsync(bytes);
      const key = Object.keys(zip.files).find((k) => /(^|[\/])Variables.db$/i.test(k))!;
      const db = await openDatabase(new Uint8Array(await zip.files[key].async("uint8array")));
      const r = db.exec('SELECT "Type", "Size" FROM Variables WHERE "Name" = ?', [name])[0];
      return r?.values[0];
    };
    const string = (Name: string): Variable => ({ Name, DataType: "STRING", Comments: "", DeviceAddress: "" });

    it("on a new project", async () => {
      const a = rectangle("PartA", { left: 10, top: 10, width: 50, height: 50 });
      const screen = { Type: "Screen", UniqueId: "4a1b2c3d-0000-4000-8000-000000000003", Name: "Main", Children: [{ Type: "Canvas", UniqueId: "4a1b2c3d-0000-4000-8000-000000000004", Name: "Root", Children: [a] }] } as Screen;
      const out = await packageProject({ name: "Audit", target: { model: "HMIST6500AWADI", width: 1024, height: 600 }, screens: [screen], variables: [string("Text"), v("Number")], alarms: [], wires: [] });
      expect(await row(out, "Text")).toEqual([2048, 32]);
      expect(await row(out, "Number")).toEqual([1, 0]);
    });

    it("when added to an opened project", async () => {
      const { bytes } = await base();
      const out = await exportAfter(bytes, (read) => ({ screens: read.screens, wires: read.wires, variables: [...read.variables, string("Text")] }));
      expect(await row(out, "Text")).toEqual([2048, 32]);
    });

    it("when an existing tag becomes one, and back", async () => {
      const { bytes } = await base();
      const out = await exportAfter(bytes, (read) => ({ screens: read.screens, wires: read.wires, variables: read.variables.map((x) => (x.Name === "TagA" ? { ...x, DataType: "STRING" } : x)) }));
      expect(await row(out, "TagA")).toEqual([2048, 32]);
      const back = await exportAfter(out, (read) => ({ screens: read.screens, wires: read.wires, variables: read.variables.map((x) => (x.Name === "TagA" ? { ...x, DataType: "INT" } : x)) }));
      expect(await row(back, "TagA")).toEqual([1, 0]);
    });

    it("leaves a row of an unchanged type as it was", async () => {
      const { bytes } = await base();
      const edited = await patch(bytes, async (zip) => {
        const key = Object.keys(zip.files).find((k) => /(^|[\/])Variables.db$/i.test(k))!;
        const db = await openDatabase(new Uint8Array(await zip.files[key].async("uint8array")));
        db.run('UPDATE Variables SET "Type" = 16 WHERE "Name" = ?', ["TagA"]);
        zip.file(key, db.export());
      });
      const out = await exportAfter(edited, (read) => ({ screens: read.screens, wires: read.wires, variables: read.variables.map((x) => (x.Name === "TagA" ? { ...x, Comments: "edited" } : x)) }));
      expect(await row(out, "TagA")).toEqual([16, 0]);
    });
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

  it("S1-01 the export gate accepts a project holding a Compound Object instance", () => {
    // The export route (app/api/export/route.ts:99) refuses with 409 whatever this returns.
    const co = { Type: "CompoundObject", Definition: "Switch_PB04", UniqueId: "4a1b2c3d-0000-4000-8000-0000000000c0", Name: "Btn", Location: { Left: 0, Top: 0 }, Width: 80, Height: 40 } as unknown as Part;
    const screen = { Type: "Screen", UniqueId: "4a1b2c3d-0000-4000-8000-0000000000c1", Name: "S", Children: [{ Type: "Canvas", UniqueId: "4a1b2c3d-0000-4000-8000-0000000000c2", Name: "R", Children: [co] }] } as Screen;
    const refused = unsupportedParts([screen], OTE).map((m) => m.type);
    expect(refused, "export route would answer 409 'cannot write CompoundObject'").toEqual([]);
  });

  it("S1-02 a binding rebuild keeps a Compound Object target's SubType", async () => {
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
  });

  describe("S1-02 a binding rebuild keeps a source's PropertyFullName", () => {
    /** Every source as a Compound Object's binding has it in the product's own file. */
    const withProperty = (bytes: Uint8Array) => patch(bytes, async (_z, json, put) => {
      const g = await json("Bindings.dat");
      for (const s of g.Sources) s.PropertyFullName = "Value";
      put("Bindings.dat", g);
    });
    /** A wire as the client's store holds it: neither of the file's own details comes back. */
    const asClient = (w: Wire): Wire => ({ part: w.part, tag: w.tag, property: w.property, screenId: w.screenId });
    const sourceOf = (g: J, partId: string) => {
      const row = g.Bindings.find((r: J) => targetOf(g, r)?.ObjectId === partId);
      return g.Sources.find((s: J) => s.ReferenceId === Number(row.Sources));
    };

    it("on a deleted part's neighbour", async () => {
      const { bytes, a, b } = await base();
      const out = await exportAfter(await withProperty(bytes), (read) => ({
        screens: without(read.screens, a.UniqueId),
        wires: read.wires.filter((w) => w.part.UniqueId !== a.UniqueId).map(asClient),
      }));
      expect(sourceOf(await graph(out), b.UniqueId).PropertyFullName).toBe("Value");
    });

    it("on every binding when only a tag's comment changes", async () => {
      const { bytes } = await base();
      const out = await exportAfter(await withProperty(bytes), (read) => ({
        screens: read.screens,
        wires: read.wires.map(asClient),
        variables: read.variables.map((x, i) => (i === 0 ? { ...x, Comments: "edited" } : x)),
      }));
      const g = await graph(out);
      expect(g.Sources.map((s: J) => s.PropertyFullName)).toEqual(["Value", "Value", "Value"]);
    });

    it("when a binding moves to another tag", async () => {
      const { bytes, a } = await base();
      const out = await exportAfter(await withProperty(bytes), (read) => ({
        screens: read.screens,
        wires: read.wires.map(asClient).map((w) => (w.part.UniqueId === a.UniqueId ? { ...w, tag: "TagB" } : w)),
      }));
      const g = await graph(out);
      expect(sourceOf(g, a.UniqueId).ObjectFullName).toBe("TagB");
      expect(sourceOf(g, a.UniqueId).PropertyFullName).toBe("Value");
    });

    it("one tag used both ways keeps a source for each", async () => {
      const { bytes, a, b, c } = await base();
      // A reads TagA bare. B reads the same tag through a source of its own that names the property.
      const edited = await patch(bytes, async (_z, json, put) => {
        const g = await json("Bindings.dat");
        const rowOf = (id: string) => g.Bindings.find((r: J) => targetOf(g, r)?.ObjectId === id);
        const bare = g.Sources.find((s: J) => s.ReferenceId === Number(rowOf(a.UniqueId).Sources));
        const ref = Math.max(...g.Sources.map((s: J) => s.ReferenceId)) + 1;
        g.Sources.push({ ...bare, ReferenceId: ref, PropertyFullName: "Value" });
        rowOf(b.UniqueId).Sources = String(ref);
        put("Bindings.dat", g);
      });
      const out = await exportAfter(edited, (read) => ({
        screens: without(read.screens, c.UniqueId),
        wires: read.wires.filter((w) => w.part.UniqueId !== c.UniqueId).map(asClient),
      }));
      const g = await graph(out);
      const [fromA, fromB] = [sourceOf(g, a.UniqueId), sourceOf(g, b.UniqueId)];
      expect(fromA.ObjectFullName).toBe(fromB.ObjectFullName);
      expect(fromA.PropertyFullName).toBeUndefined();
      expect(fromB.PropertyFullName).toBe("Value");
    });

    it("a new wire takes what the file's other wires name", async () => {
      const { bytes } = await base();
      const edited = await withProperty(bytes);
      const added = numericDisplay("PartNew", { left: 300, top: 10, width: 80, height: 30 });
      const out = await exportAfter(edited, (read) => ({
        screens: read.screens.map((s, i) => (i === 0 ? ({ ...s, Children: [{ ...s.Children[0], Children: [...s.Children[0].Children, added] }] }) as Screen : s)),
        wires: [...read.wires.map(asClient), { part: added, tag: "TagA", property: "CurrentValue", screenId: read.screens[0].UniqueId }],
      }));
      expect(sourceOf(await graph(out), added.UniqueId).PropertyFullName).toBe("Value");
    });

    it("a new wire on a file that names none writes none", async () => {
      const { bytes } = await base();
      const added = numericDisplay("PartNew", { left: 300, top: 10, width: 80, height: 30 });
      const out = await exportAfter(bytes, (read) => ({
        screens: read.screens.map((s, i) => (i === 0 ? ({ ...s, Children: [{ ...s.Children[0], Children: [...s.Children[0].Children, added] }] }) as Screen : s)),
        wires: [...read.wires.map(asClient), { part: added, tag: "TagA", property: "CurrentValue", screenId: read.screens[0].UniqueId }],
      }));
      expect(sourceOf(await graph(out), added.UniqueId).PropertyFullName).toBeUndefined();
    });

    it("writes none on a project whose file had none", async () => {
      const { bytes } = await base();
      const out = await exportAfter(bytes, (read) => ({
        screens: read.screens,
        wires: read.wires.map(asClient),
        variables: read.variables.map((x, i) => (i === 0 ? { ...x, Comments: "edited" } : x)),
      }));
      const g = await graph(out);
      expect(g.Sources.some((s: J) => "PropertyFullName" in s)).toBe(false);
    });
  });
});
