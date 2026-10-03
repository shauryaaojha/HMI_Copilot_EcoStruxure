/**
 * Content screens, and the screens the reader carries rather than models.
 *
 * Schneider's gadget templates keep their work in content screens -
 * Contents\<guid>\Screen.dat, under ContentFolders in Contents\Hierarchy.dat,
 * rooted in a "Content" with a ContentID - and keep their one real screen on a
 * Grid. Read only Screens\, most of them opened as an empty canvas.
 */

import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readProject } from "@/lib/ote/reader";
import { packageProject, type PackageInput } from "@/lib/ote/packager";
import { rectangle } from "@/lib/ote/parts";
import { critiqueNavigation } from "@/lib/critic/coverage";
import { refreshNavigation } from "@/lib/ote/layout";
import { validateProject } from "@/lib/validation/rules";

const FILE = path.join(__dirname, "..", "..", "demo_project", "HMICopilot_PumpStation.eote");

const CONTENT = "11111111-2222-4333-8444-555555555555";
const FOLDER = "22222222-3333-4444-8555-666666666666";
const GRID = "33333333-4444-4555-8666-777777777777";

const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v, null, 2));

/** The demo project, plus a content screen in a folder and a screen on a Grid. */
async function withContents(): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(fs.readFileSync(FILE));
  const hierarchyName = Object.keys(zip.files).find((n) => /^Screens[\\/]Hierarchy\.dat$/i.test(n))!;
  const hierarchy = JSON.parse((await zip.files[hierarchyName].async("string")).replace(/^\uFEFF/, ""));
  const pill = rectangle("Pill", { left: 10, top: 10, width: 100, height: 40 });
  zip.file(`Contents\\Hierarchy.dat`, enc([{ ObjectId: FOLDER, Children: [{ ObjectId: CONTENT }] }]));
  zip.file(`Contents\\${FOLDER}\\Folder.dat`, enc({ Type: "ContentFolder", UniqueId: FOLDER, Name: "Large" }));
  zip.file(`Contents\\${CONTENT}\\Screen.dat`, enc({
    Type: "Content", UniqueId: CONTENT, Name: "Slider_L", ContentID: 4,
    Children: [{ Type: "ScrollCanvas", UniqueId: "44444444-5555-4666-8777-888888888888", Name: "ScrollCanvas", Options: 108, ScrollDirection: 1, Width: 950, Height: 82, Children: [pill] }],
  }));
  zip.file(`Contents\\${CONTENT}\\Metadata.dat`, enc({ Id: 8, LayoutType: 0, ObjectType: 10, Name: "Slider_L", Order: 0 }));
  // A screen on a Grid: its child is placed by Row and Column.
  zip.file(`Screens\\${GRID}\\Screen.dat`, enc({
    Type: "Screen", UniqueId: GRID, Name: "GridScreen",
    Children: [{ Type: "Grid", UniqueId: "55555555-6666-4777-8888-999999999999", Name: "Grid1", Rows: [{}], Columns: [{}], Children: [{ Type: "ContentDisplay", UniqueId: "66666666-7777-4888-8999-aaaaaaaaaaaa", Name: "CD1", ScreenId: 4, Location: { Row: 1 } }] }],
  }));
  zip.file(`Screens\\${GRID}\\Metadata.dat`, enc({ LayoutType: 0, Id: 2, ObjectType: 9, Name: "GridScreen", Order: 1 }));
  zip.file(hierarchyName, enc([...hierarchy, { ObjectId: GRID }]));
  return zip.generateAsync({ type: "uint8array" });
}

const inputOf = (read: Awaited<ReturnType<typeof readProject>>): PackageInput => ({
  name: read.name, target: read.target, screens: read.screens, variables: read.variables, alarms: read.alarms, wires: read.wires,
});

async function entry(zip: Uint8Array, name: string): Promise<string | undefined> {
  const z = await JSZip.loadAsync(zip);
  const key = Object.keys(z.files).find((k) => k.replace(/\//g, "\\").toLowerCase() === name.toLowerCase());
  return key ? (await z.files[key].async("string")).replace(/^\uFEFF/, "") : undefined;
}

describe("content screens", () => {
  it("are read from the content tree, through its folders, on their scrolling root", async () => {
    const read = await readProject(await withContents());
    const content = read.screens.find((s) => s.UniqueId === CONTENT)!;
    expect(content).toMatchObject({ Type: "Content", Name: "Slider_L", ContentID: 4 });
    expect(content.Children[0].Type).toBe("ScrollCanvas");
    expect(content.Children[0].Children.map((p) => p.Name)).toEqual(["Pill"]);
    // After the real screens, never among them.
    expect(read.screens[0].Type).toBe("Screen");
  });

  it("says what it carried and why, once, instead of an empty canvas", async () => {
    const read = await readProject(await withContents());
    expect(read.carried.screens).toBe(1);
    expect(read.carried.roots).toEqual({ Grid: 1 });
    expect(read.warnings.filter((w) => /could not be modelled/.test(w))).toHaveLength(1);
    expect(read.warnings.join(" ")).toMatch(/row and column/);
  });

  it("writes back byte-identical when nothing changed", async () => {
    const bytes = await withContents();
    const read = await readProject(bytes);
    const out = await packageProject(inputOf(read), undefined, read.preserved);
    for (const name of [`Contents\\${CONTENT}\\Screen.dat`, "Contents\\Hierarchy.dat", "Screens\\Hierarchy.dat", `Screens\\${GRID}\\Screen.dat`]) {
      expect(await entry(out, name), name).toBe(await entry(bytes, name));
    }
  });

  it("writes an edited content screen back under Contents, keeping what it does not model", async () => {
    const read = await readProject(await withContents());
    const content = read.screens.find((s) => s.UniqueId === CONTENT)!;
    content.Children[0].Children[0].Location.Left = 40;
    const out = await packageProject(inputOf(read), undefined, read.preserved);
    const written = JSON.parse((await entry(out, `Contents\\${CONTENT}\\Screen.dat`))!);
    expect(written.Type).toBe("Content");
    expect(written.ContentID).toBe(4);
    expect(written.Children[0].ScrollDirection).toBe(1);
    expect(written.Children[0].Children[0].Location.Left).toBe(40);
    expect(await entry(out, `Screens\\${CONTENT}\\Screen.dat`)).toBeUndefined();
    const screensHierarchy = JSON.parse((await entry(out, "Screens\\Hierarchy.dat"))!);
    expect(screensHierarchy.map((h: { ObjectId: string }) => h.ObjectId)).not.toContain(CONTENT);
  });

  it("keeps a carried screen in the hierarchy when the screen list changes", async () => {
    const read = await readProject(await withContents());
    const first = read.screens[0];
    const copy = structuredClone(first);
    copy.UniqueId = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
    copy.Name = "Added";
    const out = await packageProject({ ...inputOf(read), screens: [...read.screens, copy] }, undefined, read.preserved);
    const ids = JSON.parse((await entry(out, "Screens\\Hierarchy.dat"))!).map((h: { ObjectId: string }) => h.ObjectId);
    // The Grid screen the reader could not model is still in the project, in its place.
    expect(ids).toEqual([first.UniqueId, GRID, copy.UniqueId]);
    expect(await entry(out, `Screens\\${GRID}\\Screen.dat`)).toBeDefined();
  });

  it("removes a deleted content screen from its folder and leaves the folder", async () => {
    const read = await readProject(await withContents());
    const out = await packageProject({ ...inputOf(read), screens: read.screens.filter((s) => s.Type !== "Content") }, undefined, read.preserved);
    expect(JSON.parse((await entry(out, "Contents\\Hierarchy.dat"))!)).toEqual([{ ObjectId: FOLDER, Children: [] }]);
    expect(await entry(out, `Contents\\${CONTENT}\\Screen.dat`)).toBeUndefined();
    expect(await entry(out, `Contents\\${FOLDER}\\Folder.dat`)).toBeDefined();
  });

  it("is never a navigation chip, never unreachable, and never measured against the panel", async () => {
    const read = await readProject(await withContents());
    expect(critiqueNavigation(read.screens).some((f) => f.message.includes("Slider_L"))).toBe(false);
    const { screens } = refreshNavigation(read.screens, read.target);
    const chips = screens.flatMap((s) => s.Children[0].Children).filter((p) => p.Type === "TextBox" && p.Name.startsWith("NavLbl_"));
    expect(chips.some((p) => p.Type === "TextBox" && p.Text === "Slider_L")).toBe(false);
    const findings = validateProject(inputOf(read));
    expect(findings.some((f) => f.rule === "standards" && f.message.includes("Slider_L"))).toBe(false);
  });
});

/** The real corpus, where it is on disk; skipped everywhere else. */
const CORPUS = "C:/Users/shaur/Downloads/EOTE_Template_v7";
const corpus = fs.existsSync(CORPUS) ? describe : describe.skip;

corpus("the template corpus", () => {
  const find = (name: string): string | undefined => {
    const walk = (d: string): string | undefined => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        const hit = e.isDirectory() ? walk(p) : e.name === name ? p : undefined;
        if (hit) return hit;
      }
    };
    return walk(CORPUS);
  };

  it("opens GPS_Slider01 on its content screens, and writes it back unchanged", async () => {
    const bytes = new Uint8Array(fs.readFileSync(find("GPS_Slider01.vxdz")!));
    const read = await readProject(bytes, "GPS_Slider01.vxdz");
    expect(read.screens.filter((s) => s.Type === "Content").length).toBe(18);
    expect(read.carried.roots.Grid).toBe(1);
    const out = await packageProject(inputOf(read), undefined, read.preserved);
    // Entry by entry: a re-zipped archive is never the same bytes, its entries are.
    const a = await JSZip.loadAsync(bytes);
    const b = await JSZip.loadAsync(out);
    const names = Object.keys(a.files).filter((n) => !a.files[n].dir);
    expect(Object.keys(b.files).filter((n) => !b.files[n].dir).sort()).toEqual([...names].sort());
    for (const n of names) {
      expect(Buffer.from(await b.files[n].async("uint8array")).equals(Buffer.from(await a.files[n].async("uint8array"))), n).toBe(true);
    }
  }, 60000);

  it("opens all 24 of HVAC_Symbol01's screens now that a ScrollCanvas and a ZoomCanvas are roots", async () => {
    const read = await readProject(new Uint8Array(fs.readFileSync(find("HVAC_Symbol01.vxdz")!)), "HVAC_Symbol01.vxdz");
    expect(read.screens.filter((s) => s.Type === "Screen").length).toBe(24);
    expect(read.carried.screens).toBe(0);
  }, 30000);
});
