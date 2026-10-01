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

/**
 * The demo project with its screen edited in place, as bytes.
 *
 * The encoding tests all do the same thing: write a shape the product writes
 * but we had not seen into a real file, then prove it both models and survives
 * the round trip. Mutating a real project rather than building one from the
 * schema is deliberate - a fixture built from the schema can only contain what
 * the schema already allows, which is the opposite of the thing under test.
 */
async function withScreen(mutate: (screen: Record<string, any>) => void) {
  const zip = await JSZip.loadAsync(bytes());
  const name = Object.keys(zip.files).find((n) => /Screen\.dat$/i.test(n))!;
  const raw = JSON.parse(await zip.file(name)!.async("string"));
  mutate(raw);
  zip.file(name, JSON.stringify(raw, null, 2));
  return zip.generateAsync({ type: "uint8array" });
}

/**
 * Edit the screen, then look at what was written for the Title.
 *
 * Exporting an *unchanged* project is not enough to prove an encoding
 * survives: `packagePreserved` fingerprints each screen and writes an
 * untouched one back verbatim, so the merge never runs and the assertion
 * passes whatever the schema did. Changing one unrelated part forces the
 * rewrite, and the rewrite is where a value parsed into a narrower type would
 * be written back in the narrower form.
 */
async function expectSurvivesAnEdit(
  source: Uint8Array,
  check: (title: Record<string, any>) => void,
) {
  const read = await readProject(source);
  const input = inputOf(read);
  input.screens[0].Children[0].Children.push(
    rectangle("Forces_A_Rewrite", { left: 600, top: 320, width: 10, height: 10 }, {}),
  );
  const out = await packageProject(input, undefined, read.preserved);

  // The screen really was rewritten, so what follows means something.
  expect((await diff(source, out)).some((n) => /Screen\.dat$/i.test(n))).toBe(true);

  const written = await entriesOf(out);
  const name = [...written.keys()].find((n) => /Screen\.dat$/i.test(n))!;
  const json = JSON.parse(new TextDecoder().decode(written.get(name)!));
  const title = (json.Children[0].Children as Record<string, any>[]).find((p) => p.Name === "Title");
  expect(title).toBeDefined();
  check(title!);
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
    // A type the schema does not model. (It was TrendGraph until the canvas learned to draw one.)
    const alien = { Type: "ZoomCanvas", UniqueId: "11111111-2222-3333-4444-555555555555", Name: "Trend_Alien", Location: { Left: 0, Top: 0 }, Width: 10, Height: 10, Pens: [{ Colour: 3 }] };
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

/**
 * The four encodings docs/VXDZ_FINDINGS.md §3.1 found the schema did not
 * accept. Each one was read out of a real Schneider-authored file; each was an
 * assumption our schema had made from a single source project, `Demo 1.eote`
 * at ColorSet 4, rather than a rule of the format.
 *
 * Every case asserts the same two things, because widening a schema can break
 * either: that the shape now *models*, and that it still comes back
 * byte-identical. The second is the one that matters - a field parsed into a
 * narrower type and written back differently is exactly what this file exists
 * to catch.
 */
describe("the encodings the product also writes", () => {
  it("models a font written as a number, and writes it back unchanged", async () => {
    // 4.4 writes {Type: 2, Value: "0", DisplayValue: "0"}; 3.4 writes
    // {Type: 2, Value: 0} and no DisplayValue. docs/VXDZ_FINDINGS.md §3.1.
    const modified = await withScreen((raw) => {
      const title = raw.Children[0].Children.find((p: any) => p.Name === "Title");
      title.Font = { Type: { Type: 2, Value: 0 }, Size: 20 };
    });

    const read = await readProject(modified);
    expect(read.warnings).toEqual([]);
    const title = read.screens[0].Children[0].Children.find((p) => p.Name === "Title");
    expect(title?.Type).toBe("TextBox");
    const font = (title as { Font?: { Type: { Value: unknown; DisplayValue?: unknown } } }).Font;
    expect(font?.Type.Value).toBe(0);
    expect(font?.Type.DisplayValue).toBeUndefined();

    const out = await packageProject(inputOf(read), undefined, read.preserved);
    expect(await diff(modified, out)).toEqual([]);

    await expectSurvivesAnEdit(modified, (title) =>
      expect(title.Font).toEqual({ Type: { Type: 2, Value: 0 }, Size: 20 }),
    );
  });

  it("models a packed colour, and keeps the flag that says it is one", async () => {
    // 0x17A1E5, the light blue Schneider's HVAC library uses for chilled water.
    // Without ColorIndexEnabled this would be read as palette index 1548773.
    const modified = await withScreen((raw) => {
      const title = raw.Children[0].Children.find((p: any) => p.Name === "Title");
      title.TextColor = { Color: { ColorIndexEnabled: false, Value: 1548773 } };
    });

    const read = await readProject(modified);
    expect(read.warnings).toEqual([]);
    const title = read.screens[0].Children[0].Children.find((p) => p.Name === "Title");
    const colour = (title as { TextColor?: { Color: Record<string, unknown> } }).TextColor;
    expect(colour?.Color.Value).toBe(1548773);
    expect(colour?.Color.ColorIndexEnabled).toBe(false);

    const out = await packageProject(inputOf(read), undefined, read.preserved);
    expect(await diff(modified, out)).toEqual([]);

    // The flag has to survive a rewrite, not only a no-op export. zod strips
    // keys it does not model, so before ColorIndexEnabled was in the schema an
    // edited screen wrote the colour back as a palette index - a file that
    // opens and is the wrong colour.
    await expectSurvivesAnEdit(modified, (title) =>
      expect(title.TextColor).toEqual({ Color: { ColorIndexEnabled: false, Value: 1548773 } }),
    );
  });

  it("still refuses a palette index outside the colour set", async () => {
    // The widening is conditional: without the flag, Value is an index, and an
    // index of 1548773 is a mistake rather than a colour.
    const modified = await withScreen((raw) => {
      const title = raw.Children[0].Children.find((p: any) => p.Name === "Title");
      title.TextColor = { Color: { Value: 1548773 } };
    });
    const read = await readProject(modified);
    expect(read.carried.opaqueParts).toBe(1);
    expect(read.screens[0].Children[0].Children.some((p) => p.Name === "Title")).toBe(false);
  });
});
