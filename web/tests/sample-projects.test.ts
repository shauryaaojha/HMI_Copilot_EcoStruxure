/**
 * The sample projects in `samples/` at the repository root.
 *
 * These are not served by the app - they exist to be uploaded by hand, which is
 * the path an engineer actually takes. That makes them easy to let rot: nothing
 * in the product loads them, so nothing in the product notices when an
 * inference change stops recognising the equipment they were written around.
 * This notices.
 *
 * Regenerate with `python tools/make_sample_projects.py`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTags } from "@/lib/tags/parse";
import { inferEquipment, proposeAlarms } from "@/lib/ai/infer";
import { fallbackPlan } from "@/lib/ai/plan";
import { layoutApplication } from "@/lib/ote/layout";
import { Variable } from "@/lib/ote/schema";

const SAMPLES = join(process.cwd(), "..", "samples");

interface Expected {
  tags: number;
  /** Machine kinds this plant must still be recognised as having. */
  kinds: string[];
  /** Units, screens and alarms it should produce, as floors not equalities. */
  minUnits: number;
  minScreens: number;
}

const EXPECTED: Record<string, Expected> = {
  "transfer-pump-station": { tags: 20, kinds: ["pump", "tank"], minUnits: 3, minScreens: 1 },
  "boiler-house": { tags: 93, kinds: ["boiler", "fan", "pump"], minUnits: 9, minScreens: 2 },
  "hvac-building": { tags: 148, kinds: ["fan", "compressor", "valve"], minUnits: 14, minScreens: 3 },
  "packaging-line": { tags: 124, kinds: ["conveyor", "motor"], minUnits: 14, minScreens: 3 },
  "tank-farm": { tags: 129, kinds: ["tank", "pump", "valve"], minUnits: 16, minScreens: 3 },
  "water-treatment": { tags: 174, kinds: ["pump", "filter", "doser", "tank"], minUnits: 20, minScreens: 4 },
  "chemical-plant": {
    tags: 718,
    kinds: ["reactor", "tank", "boiler", "compressor", "conveyor", "doser", "heater", "filter"],
    minUnits: 80,
    minScreens: 10,
  },
};

function read(slug: string) {
  const buf = readFileSync(join(SAMPLES, slug, "tags.csv"));
  const parsed = parseTags(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    "tags.csv",
  );
  return { ...parsed, equipment: inferEquipment(parsed.variables) };
}

describe("every sample project folder", () => {
  it("has a README the index can point at", () => {
    for (const slug of Object.keys(EXPECTED)) {
      expect(readFileSync(join(SAMPLES, slug, "README.md"), "utf8").length).toBeGreaterThan(200);
    }
    // Whitespace-normalised, because the sentence wraps in the file and the
    // claim is what matters, not where the line breaks fall.
    const index = readFileSync(join(SAMPLES, "README.md"), "utf8").replace(/\s+/g, " ");
    expect(index).toContain("not served by the app");
    for (const slug of Object.keys(EXPECTED)) expect(index).toContain(slug);
  });

  for (const [slug, want] of Object.entries(EXPECTED)) {
    describe(slug, () => {
      const sample = read(slug);

      it("parses every row, losing none", () => {
        expect(sample.variables).toHaveLength(want.tags);
        expect(sample.skipped).toHaveLength(0);
      });

      it("produces variables the schema accepts", () => {
        for (const variable of sample.variables) {
          expect(Variable.safeParse(variable).success, variable.Name).toBe(true);
        }
      });

      it("carries a name OTE rejects, and reports the correction", () => {
        // The importer's promise is that corrections are reported, never
        // applied silently. That beat needs something to report.
        expect(sample.corrections.length).toBeGreaterThan(0);
        for (const c of sample.corrections) {
          expect(c.to).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
        }
      });

      it("is still recognised as the plant it was written to be", () => {
        const kinds = new Set(sample.equipment.map((u) => u.kind));
        for (const kind of want.kinds) {
          expect(kinds.has(kind), `${slug}: no ${kind} inferred any more`).toBe(true);
        }
        expect(sample.equipment.length).toBeGreaterThanOrEqual(want.minUnits);
      });

      it("plans screens that hold what they are given, and lays them out", () => {
        const plan = fallbackPlan("build the whole thing", sample.equipment);
        expect(plan.screens.length).toBeGreaterThanOrEqual(want.minScreens);
        for (const screen of plan.screens) {
          // ISA-101: split rather than crowd. Level 1 overviews take more.
          expect(screen.include.length).toBeLessThanOrEqual(screen.level === 1 ? 12 : 6);
        }

        const built = layoutApplication(plan.screens, sample.equipment, {
          width: 1024,
          height: 600,
        });
        expect(built).toHaveLength(plan.screens.length);

        // Nothing off the panel, and every name unique across the whole
        // application - the binding graph resolves a target by name.
        const names = built.flatMap((b) => b.parts.map((p) => p.Name));
        expect(new Set(names).size).toBe(names.length);
        for (const part of built.flatMap((b) => b.parts)) {
          expect(part.Location.Left).toBeGreaterThanOrEqual(0);
          expect(part.Location.Left + part.Width).toBeLessThanOrEqual(1024);
          expect(part.Location.Top + part.Height).toBeLessThanOrEqual(600);
        }
      });

      it("has alarms to propose", () => {
        expect(proposeAlarms(sample.equipment).length).toBeGreaterThan(0);
      });
    });
  }
});

describe("the complex one", () => {
  const sample = read("chemical-plant");

  it("is larger than any single screen could hold, which is the point of it", () => {
    const plan = fallbackPlan("the whole plant", sample.equipment);
    expect(sample.equipment.length).toBeGreaterThan(80);
    expect(plan.screens.length).toBeGreaterThan(10);
    // A plant overview above the rest, because there are far more than four
    // units - that is the rule lib/ai/plan.ts applies.
    expect(plan.screens[0].level).toBe(1);
  });

  it("covers eight areas' worth of equipment kinds", () => {
    const kinds = new Set(
      sample.equipment.map((u) => u.kind).filter((k) => k !== "instrument"),
    );
    expect(kinds.size).toBeGreaterThanOrEqual(10);
  });
});
