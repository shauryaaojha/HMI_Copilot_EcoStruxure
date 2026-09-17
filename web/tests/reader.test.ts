/**
 * Read before write, and never lose what you did not understand.
 *
 * The invariant, as tests: open a project and export it unchanged, and every
 * entry comes back byte-identical. Change one thing, and exactly the entries
 * that hold that thing change. An object the schema cannot model survives in
 * its place. docs/PLAN_PHASE1.md.
 *
 * Runs without a skeleton: the file under test is our own generated project,
 * committed in demo_project/, and an opened project is written back into its
 * own entries rather than the skeleton's.
 */

import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readProject } from "@/lib/ote/reader";
import { packageProject, type PackageInput } from "@/lib/ote/packager";
import { rectangle } from "@/lib/ote/parts";

const FILE = path.join(__dirname, "..", "..", "demo_project", "HMICopilot_PumpStation.eote");
const bytes = () => new Uint8Array(fs.readFileSync(FILE));

async function entriesOf(zip: Uint8Array) {
  const z = await JSZip.loadAsync(zip);
  const out = new Map<string, Uint8Array>();
  for (const [name, file] of Object.entries(z.files)) if (!file.dir) out.set(name, await file.async("uint8array"));
  return out;
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Which entries differ between two archives, by name. */
async function diff(a: Uint8Array, b: Uint8Array) {
  const ea = await entriesOf(a);
  const eb = await entriesOf(b);
  const names = new Set([...ea.keys(), ...eb.keys()]);
  return [...names].filter((n) => {
    const x = ea.get(n);
    const y = eb.get(n);
    return !x || !y || !same(x, y);
  });
}

const inputOf = (read: Awaited<ReturnType<typeof readProject>>): PackageInput => ({
  name: read.name,
  target: read.target,
  screens: read.screens,
  variables: read.variables,
  alarms: read.alarms,
  wires: read.wires,
});

describe("reading our own generated project", () => {
  it("models the screen, the tags, the alarms and the bindings", async () => {
    const read = await readProject(bytes(), "HMICopilot_PumpStation.eote");
    expect(read.name).toBe("HMICopilot_PumpStation");
    expect(read.target.width).toBe(1024);
    expect(read.screens).toHaveLength(1);
    expect(read.screens[0].Children[0].Children.length).toBeGreaterThan(10);
    expect(read.variables).toHaveLength(7);
    expect(read.alarms).toHaveLength(5);
    for (const alarm of read.alarms) expect(alarm.Trigger).not.toBe("");
    expect(read.wires.length).toBeGreaterThan(0);
    const tags = new Set(read.variables.map((v) => v.Name));
    for (const wire of read.wires) expect(tags.has(wire.tag)).toBe(true);
    expect(read.warnings).toEqual([]);
  });

  it("keeps every entry, including the ones it does not model", async () => {
    const read = await readProject(bytes());
    const original = await entriesOf(bytes());
    expect(read.preserved.entries.size).toBe(original.size);
    expect([...read.preserved.entries.keys()].some((n) => /Recipe\.db$/i.test(n))).toBe(true);
  });
});

describe("the round trip", () => {
  it("returns an unchanged project byte-identical, every entry", async () => {
    const read = await readProject(bytes());
    const out = await packageProject(inputOf(read), undefined, read.preserved);
    expect(await diff(bytes(), out)).toEqual([]);
  });

  it("changes only the screen, and the modified stamp, when one object is added", async () => {
    const read = await readProject(bytes());
    const input = inputOf(read);
    const screen = input.screens[0];
    screen.Children[0].Children.push(
      rectangle("Added_Panel", { left: 600, top: 320, width: 100, height: 20 }, {}),
    );
    const out = await packageProject(input, undefined, read.preserved);
    const changed = await diff(bytes(), out);
    expect(changed.some((n) => /Screen\.dat$/i.test(n))).toBe(true);
    expect(changed.filter((n) => !/Screen\.dat$|^Project\.dat$/i.test(n))).toEqual([]);

    const again = await readProject(out);
    expect(again.screens[0].Children[0].Children.some((p) => p.Name === "Added_Panel")).toBe(true);
  });

  it("keeps a part the schema cannot model, in its place, through an edit", async () => {
    // Inject an object of a type the editor does not know into the screen.
    const zip = await JSZip.loadAsync(bytes());
    const screenName = Object.keys(zip.files).find((n) => /Screen\.dat$/i.test(n))!;
    const raw = JSON.parse(await zip.file(screenName)!.async("string"));
    const alien = { Type: "TrendGraph", UniqueId: "11111111-2222-3333-4444-555555555555", Name: "Trend_Alien", Location: { Left: 0, Top: 0 }, Width: 10, Height: 10, Pens: [{ Colour: 3 }] };
    raw.Children[0].Children.splice(2, 0, alien);
    zip.file(screenName, JSON.stringify(raw, null, 2));
    const withAlien = await zip.generateAsync({ type: "uint8array" });

    const read = await readProject(withAlien);
    expect(read.carried.opaqueParts).toBe(1);
    expect(read.screens[0].Children[0].Children.some((p) => p.Name === "Trend_Alien")).toBe(false);

    // Edit the screen, then look at what was written.
    const input = inputOf(read);
    input.screens[0].Children[0].Children.push(rectangle("Edit", { left: 600, top: 320, width: 50, height: 20 }, {}));
    const out = await packageProject(input, undefined, read.preserved);
    const written = await entriesOf(out);
    const name = [...written.keys()].find((n) => /Screen\.dat$/i.test(n))!;
    const json = JSON.parse(new TextDecoder().decode(written.get(name)!));
    const children = json.Children[0].Children as { Name: string; Type: string; Pens?: unknown }[];
    expect(children[2].Name).toBe("Trend_Alien");
    expect(children[2].Pens).toEqual([{ Colour: 3 }]);
    expect(children.at(-1)!.Name).toBe("Edit");
  });

  it("keeps a property the schema does not model on a part it does", async () => {
    const zip = await JSZip.loadAsync(bytes());
    const screenName = Object.keys(zip.files).find((n) => /Screen\.dat$/i.test(n))!;
    const raw = JSON.parse(await zip.file(screenName)!.async("string"));
    raw.Children[0].Children[0].FutureProperty = { kept: true };
    zip.file(screenName, JSON.stringify(raw, null, 2));
    const modified = await zip.generateAsync({ type: "uint8array" });

    const read = await readProject(modified);
    const input = inputOf(read);
    input.screens[0].Children[0].Children[0].Width += 1;
    const out = await packageProject(input, undefined, read.preserved);
    const written = await entriesOf(out);
    const name = [...written.keys()].find((n) => /Screen\.dat$/i.test(n))!;
    const json = JSON.parse(new TextDecoder().decode(written.get(name)!));
    expect(json.Children[0].Children[0].FutureProperty).toEqual({ kept: true });
  });

  it("adds a tag without disturbing the ids of the tags already there", async () => {
    const read = await readProject(bytes());
    const input = inputOf(read);
    input.variables.push({ Name: "NEW_TAG", DataType: "REAL", Comments: "added", DeviceAddress: "" });
    const out = await packageProject(input, undefined, read.preserved);

    const changed = await diff(bytes(), out);
    // Bindings.dat is rebuilt, but the writer is deterministic and the new
    // tag drives nothing, so it comes out byte-identical - which is the point.
    expect(changed).toEqual(expect.arrayContaining(["Variables.db", "Project.dat"]));
    expect(changed.some((n) => /Screen\.dat$|Alarm\.db$|Recipe\.db$/i.test(n))).toBe(false);

    const again = await readProject(out);
    expect(again.variables).toHaveLength(8);
    for (const [name, id] of Object.entries(read.preserved.variableIds)) {
      expect(again.preserved.variableIds[name]).toBe(id);
    }
    expect(again.wires.length).toBe(read.wires.length);
    expect(again.alarms.map((a) => a.Trigger)).toEqual(read.alarms.map((a) => a.Trigger));
  });

  it("drops a screen cleanly and rewrites the hierarchy", async () => {
    const read = await readProject(bytes());
    const input = inputOf(read);
    // Add a second screen, export, re-read, remove the first.
    const extra = { ...structuredClone(input.screens[0]), UniqueId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", Name: "Second" };
    extra.Children[0].UniqueId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeef";
    extra.Children[0].Children = [];
    input.screens.push(extra);
    const two = await packageProject(input, undefined, read.preserved);
    const readTwo = await readProject(two);
    expect(readTwo.screens.map((s) => s.Name)).toEqual([read.screens[0].Name, "Second"]);

    const inputTwo = inputOf(readTwo);
    inputTwo.screens = inputTwo.screens.slice(1);
    inputTwo.wires = [];
    const one = await packageProject(inputTwo, undefined, readTwo.preserved);
    const readOne = await readProject(one);
    expect(readOne.screens.map((s) => s.Name)).toEqual(["Second"]);
    const names = [...(await entriesOf(one)).keys()];
    expect(names.filter((n) => /Screen\.dat$/i.test(n))).toHaveLength(1);
  });
});
