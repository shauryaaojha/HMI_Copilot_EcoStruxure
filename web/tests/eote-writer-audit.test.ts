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
});
