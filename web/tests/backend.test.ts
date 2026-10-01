/**
 * The format seam. docs/PLAN_PHASE4.md §7, and Schneider's answer 6: the
 * solution should be easy to adapt to Vijeo Designer.
 *
 * What is held here is the shape of the join, not a second format. Adding a
 * format must be one module and one row; a target must declare what it can
 * hold; a target that cannot write must say why instead of producing a file;
 * and putting OTE behind the interface must not have changed a byte it writes.
 *
 * The last one is the point of the exercise. A refactor of the writing path is
 * exactly the kind of change that quietly alters output, which is why the round
 * trip is asserted through the backend rather than around it.
 */

import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BACKENDS, DEFAULT_FORMAT, backendFor, writableFormats } from "@/lib/backend";
import { unsupportedParts } from "@/lib/backend/types";
import { PANELS, panelFromValue, panelNamed, panelValue, panelsFor } from "@/lib/backend/panels";
import { OTE } from "@/lib/backend/ote";
import { VIJEO } from "@/lib/backend/vijeo";
import { PART_TYPES } from "@/lib/ote/schema";
import { TARGETS } from "@/components/shell/targets";
import { rectangle, screenOf, trendGraph } from "@/lib/ote/parts";

const PANEL = { width: 1024, height: 600 };

async function entriesOf(zip: Uint8Array) {
  const z = await JSZip.loadAsync(zip);
  const out = new Map<string, Uint8Array>();
  for (const [name, file] of Object.entries(z.files)) if (!file.dir) out.set(name, await file.async("uint8array"));
  return out;
}

/** Entry names that differ between two archives. */
async function differingEntries(a: Uint8Array, b: Uint8Array) {
  const [ea, eb] = [await entriesOf(a), await entriesOf(b)];
  const same = (x?: Uint8Array, y?: Uint8Array) => !!x && !!y && x.length === y.length && x.every((v, i) => v === y[i]);
  return [...new Set([...ea.keys(), ...eb.keys()])].filter((n) => !same(ea.get(n), eb.get(n)));
}

describe("the registry", () => {
  it("holds every format exactly once, resolvable by id", () => {
    const ids = BACKENDS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(backendFor(id).id).toBe(id);
    expect(backendFor().id).toBe(DEFAULT_FORMAT);
    expect(() => backendFor("cimplicity" as never)).toThrow(/no backend/);
  });

  it("separates what is declared from what can write", () => {
    expect(writableFormats().map((b) => b.id)).toEqual(["eote"]);
    expect(VIJEO.unavailable).toMatch(/never opened a Vijeo Designer project/);
    expect(OTE.unavailable).toBeUndefined();
  });

  it("gives every backend an extension with its dot, and a name an engineer would use", () => {
    for (const b of BACKENDS) {
      expect(b.extension).toMatch(/^\.[a-z]+$/);
      expect(b.name.length).toBeGreaterThan(3);
    }
    expect(OTE.extension).toBe(".eote");
    expect(VIJEO.extension).toBe(".zdat");
  });

  it("lets only a backend that has read a real file claim to be non-provisional", () => {
    // The rule that keeps us honest: a capability list written from a product
    // page may not write a file. Both halves are asserted, so neither can drift.
    for (const b of BACKENDS) {
      if (b.capabilities.provisional) expect(b.unavailable).toBeTruthy();
      else expect(b.unavailable).toBeUndefined();
    }
  });
});

describe("capabilities", () => {
  it("has OTE declare every part type the schema holds, and Vijeo fewer", () => {
    expect([...OTE.capabilities.parts]).toEqual([...PART_TYPES]);
    expect(VIJEO.capabilities.parts.length).toBeLessThan(PART_TYPES.length);
    // Whatever Vijeo declares must be a part the tool can actually draw.
    for (const p of VIJEO.capabilities.parts) expect(PART_TYPES).toContain(p);
  });

  it("reports the objects a target cannot hold, against the object", () => {
    const screen = screenOf(
      "Area1",
      [
        rectangle("Card_1", { left: 0, top: 0, width: 200, height: 100 }),
        trendGraph("Trend_1", ["TNK_101_LEVEL"], { left: 0, top: 120, width: 400, height: 200 }),
      ],
      PANEL,
    );
    expect(unsupportedParts([screen], OTE)).toEqual([]);
    const missing = unsupportedParts([screen], VIJEO);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ screen: "Area1", name: "Trend_1", type: "TrendGraph" });
    expect(missing[0].objectId).toBe(screen.Children[0].Children[1].UniqueId);
  });

  it("refuses to write rather than guessing at a format", async () => {
    await expect(VIJEO.write({ name: "x", target: { model: "m", width: 1, height: 1 }, screens: [], variables: [], alarms: [], wires: [] })).rejects.toThrow(
      /needs one real project/,
    );
  });
});

describe("panels as data", () => {
  it("gives every panel a resolution, a viewing distance and at least one format", () => {
    expect(PANELS.length).toBeGreaterThanOrEqual(4);
    for (const p of PANELS) {
      expect(p.width).toBeGreaterThan(0);
      expect(p.height).toBeGreaterThan(0);
      expect(["touch", "controlRoom"]).toContain(p.viewing);
      expect(p.formats.length).toBeGreaterThanOrEqual(1);
      for (const f of p.formats) expect(BACKENDS.map((b) => b.id)).toContain(f);
    }
  });

  it("pairs no panel with Vijeo Designer, deliberately, until we have its target list", () => {
    expect(panelsFor("vijeo")).toEqual([]);
    expect(panelsFor("eote").length).toBe(PANELS.length);
  });

  it("round-trips a panel through the value string the UI stores", () => {
    for (const p of PANELS) expect(panelFromValue(panelValue(p))).toEqual(p);
    expect(panelNamed("HMIGTO6310")?.width).toBe(1024);
    expect(panelNamed("nothing")).toBeUndefined();
  });

  it("accepts an opened file's panel that the list does not hold, and marks it as such", () => {
    const opened = panelFromValue("HMIG5U|1280|800");
    expect(opened).toMatchObject({ model: "HMIG5U", width: 1280, height: 800, provisional: true });
    expect(panelFromValue("nonsense")).toBeUndefined();
  });

  it("is the single list the menus show", () => {
    expect(TARGETS.map((t) => t.value)).toEqual(PANELS.map(panelValue));
    expect(TARGETS[0].label).toBe("HMIGTO6310 · 1024 × 768");
  });
});

describe("OTE behind the seam writes what it wrote before", () => {
  const fixture = join(process.cwd(), "..", "demo_project");

  it("reads a real project through the backend and writes every entry back byte-identical", async () => {
    // The same claim tests/export.test.ts makes of the packager, made of the
    // interface - so the refactor cannot have changed the output.
    const path = join(fixture, "HMICopilot_PumpStation.eote");
    // The fixture is the one tests/reader.test.ts round-trips; it carries
    // Schneider's own skeleton, so it is present on a development machine and
    // absent in a bare checkout.
    const original = readFileSync(path);
    expect(OTE.read).toBeDefined();
    const read = await OTE.read!(new Uint8Array(original));
    const written = await OTE.write(
      {
        name: read.name,
        target: read.target,
        screens: read.screens,
        variables: read.variables,
        alarms: read.alarms,
        wires: read.wires,
      },
      read.preserved,
    );
    // Entry by entry, which is the guarantee the reader actually makes: the
    // ZIP container's own bytes are jszip's business, the entries are ours.
    expect(await differingEntries(new Uint8Array(original), written)).toEqual([]);
  });
});
