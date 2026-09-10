/**
 * The sample tag exports, held to what they actually produce.
 *
 * These files are the first stone of the golden corpus docs/PRODUCTION.md
 * argues for: a change to lib/tags/parse.ts that quietly alters what an import
 * yields should fail here rather than be noticed by an engineer whose tag list
 * came out wrong.
 *
 * The expectations are recorded from a real run through the parser, not chosen
 * in advance — so they describe behaviour rather than aspiration. If one of
 * them changes, decide whether the parser got better or worse before editing
 * the number.
 *
 * Between them the six files cover every path the importer has: a spreadsheet,
 * a headerless tab-separated file, a semicolon-delimited export, Symbol-style
 * column naming, and one file that is awkward on purpose.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTags } from "@/lib/tags/parse";
import { SAMPLES } from "@/components/tags/useTagImport";
import { Variable } from "@/lib/ote/schema";

const DIR = join(process.cwd(), "public", "demo");

function read(name: string) {
  const buf = readFileSync(join(DIR, name));
  return parseTags(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    name,
  );
}

interface Expected {
  tags: number;
  corrections: number;
  skipped: number;
  /** A tag that must survive the import, to prove the columns mapped. */
  contains: string;
}

const EXPECTED: Record<string, Expected> = {
  "Plant_Tags.csv": { tags: 1248, corrections: 5, skipped: 0, contains: "PMP_101_RUN" },
  "Bottling_Line.xlsx": { tags: 82, corrections: 0, skipped: 0, contains: "FIL_101_RUN" },
  "Conveyor_System.csv": { tags: 125, corrections: 0, skipped: 0, contains: "CNV_101_RUN" },
  "Batch_Reactors.txt": { tags: 86, corrections: 0, skipped: 0, contains: "RCT_301_TEMP" },
  "Boiler_House.txt": { tags: 49, corrections: 0, skipped: 0, contains: "BLR_1_RUN" },
  "Legacy_Retrofit.csv": { tags: 66, corrections: 6, skipped: 4, contains: "MTR_1_RUN" },
};

describe("every sample the app offers can actually be imported", () => {
  it("offers exactly the files that are documented here", () => {
    expect(SAMPLES.map((s) => s.name).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const sample of SAMPLES) {
    describe(sample.name, () => {
      const parsed = read(sample.name);
      const want = EXPECTED[sample.name];

      it("parses to the number of tags the picker advertises", () => {
        // The count in the UI and the count the parser returns are the same
        // number, or the picker is lying about what the engineer will get.
        expect(parsed.variables).toHaveLength(want.tags);
        expect(sample.tags).toBe(want.tags);
        expect(parsed.summary.total).toBe(want.tags);
      });

      it("maps its columns, whatever they are called", () => {
        const names = new Set(parsed.variables.map((v) => v.Name));
        expect(names.has(want.contains), `${want.contains} missing`).toBe(true);
        // A file whose columns did not map yields names but no types or
        // comments, which is the failure worth catching.
        expect(parsed.variables.some((v) => v.Comments.length > 0)).toBe(true);
        expect(new Set(parsed.variables.map((v) => v.DataType)).size).toBeGreaterThan(1);
      });

      it("reports exactly what it changed and what it could not use", () => {
        expect(parsed.corrections).toHaveLength(want.corrections);
        expect(parsed.skipped).toHaveLength(want.skipped);
        // Nothing is reported without a reason attached.
        for (const c of parsed.corrections) expect(c.reason.length).toBeGreaterThan(0);
        for (const s of parsed.skipped) expect(s.reason.length).toBeGreaterThan(0);
      });

      it("produces variables the schema accepts", () => {
        // Whatever the file looked like, what comes out has to be writable
        // into a project - names OTE allows, types it defines.
        for (const variable of parsed.variables) {
          const result = Variable.safeParse(variable);
          expect(result.success, `${variable.Name}: ${JSON.stringify(variable)}`).toBe(true);
        }
      });

      it("gives every tag a distinct name", () => {
        const names = parsed.variables.map((v) => v.Name);
        expect(new Set(names).size).toBe(names.length);
      });
    });
  }
});

describe("the awkward file is awkward in the ways that matter", () => {
  const parsed = read("Legacy_Retrofit.csv");

  it("corrects names rather than rejecting the rows", () => {
    const to = new Set(parsed.variables.map((v) => v.Name));
    expect(to.has("MTR_2_RUN")).toBe(true);        // spaces
    expect(to.has("MTR_2_FLT")).toBe(true);        // hyphens
    expect(to.has("PLANT_LINE_SPEED")).toBe(true); // OPC dots
    expect(to.has("Tag_2ND_STAGE_PRESS")).toBe(true); // leading digit
  });

  it("deduplicates a repeated tag with a suffix, and says so", () => {
    const names = parsed.variables.map((v) => v.Name);
    expect(names.filter((n) => n.startsWith("MTR_1_RUN"))).toEqual([
      "MTR_1_RUN",
      "MTR_1_RUN_2",
      "MTR_1_RUN_3",
    ]);
    expect(
      parsed.corrections.filter((c) => /duplicate/i.test(c.reason)),
    ).toHaveLength(2);
  });

  it("skips a row it cannot type instead of guessing", () => {
    // Defaulting "Analogue" to REAL would be a plausible guess that silently
    // puts the wrong type in front of an operator.
    const skipped = parsed.skipped.map((s) => s.value);
    expect(skipped.some((v) => v.includes("Analogue"))).toBe(true);
    expect(skipped.some((v) => v.includes("boolean16"))).toBe(true);
    expect(parsed.variables.some((v) => v.Name === "TANK_LVL")).toBe(false);
  });

  it("keeps SQL keywords as names, because the packager quotes them", () => {
    const names = new Set(parsed.variables.map((v) => v.Name));
    expect(names.has("Order")).toBe(true);
    expect(names.has("Value")).toBe(true);
  });
});
