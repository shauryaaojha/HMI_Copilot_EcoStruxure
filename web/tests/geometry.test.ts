/**
 * The geometric critic. docs/PLAN_PHASE4.md §3.
 *
 * Two halves. First, every rule fires on a defect built on purpose - and the
 * four the vision critic actually found are here as regressions, because the
 * whole claim of Phase 4 is that arithmetic catches them for nothing. Second,
 * every generated screen of every sample plant is reviewed, and the rules stay
 * quiet on output we believe is good: a critic that cries on our own best work
 * would be turned off within a week.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, critiqueGeometry, critiqueScreens, scoreOf } from "@/lib/critic/geometry";
import { critiqueHeadlines, critiqueRoleCoverage } from "@/lib/critic/coverage";
import { ISA101, tokenHex } from "@/lib/standard/pack";
import { lamp, numericDisplay, pathPart, rectangle, screenOf, textBox } from "@/lib/ote/parts";
import { modelPlant } from "@/lib/plant/model";
import { inferEquipment } from "@/lib/ai/infer";
import { fallbackPlan } from "@/lib/ai/plan";
import { layoutApplication } from "@/lib/ote/layout";
import { parseTags } from "@/lib/tags/parse";
import type { Part, Variable } from "@/lib/ote/schema";
import type { Finding } from "@/lib/validation/rules";

const PANEL = { width: 1024, height: 600 };
const T = ISA101.tokens;
const rules = (findings: Finding[]) => findings.map((f) => f.rule);

/** A screen with a ground, so `behind` resolves the way a real one does. */
function screen(...parts: Part[]) {
  const ground = rectangle("Ground_T", { left: 0, top: 0, width: PANEL.width, height: PANEL.height }, { fill: T.ground });
  return screenOf("Test", [ground, ...parts], PANEL);
}

/** Every tag list in the repository. */
function samples(): { name: string; variables: Variable[] }[] {
  const root = join(process.cwd(), "..", "samples");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((slug) => ({ slug, file: join(root, slug, "tags.csv") }))
    .filter(({ file }) => existsSync(file))
    .map(({ slug, file }) => ({ name: slug, variables: parseTags(readFileSync(file), "tags.csv").variables }));
}

/** The application a sample generates, the way the pipeline builds it. */
function application(variables: Variable[]) {
  const equipment = inferEquipment(variables);
  const plan = fallbackPlan("review", equipment);
  return layoutApplication(plan.screens, equipment, PANEL).map((l) => l.screen);
}

describe("contrast, as a number", () => {
  it("is 21 for black on white and 1 for a colour on itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#d9d9d9", "#d9d9d9")).toBeCloseTo(1, 5);
  });

  it("puts the pack's own card step below the graphic floor, which is why only symbols are judged on it", () => {
    // panel on ground is a deliberate, nearly invisible step: the standard
    // working as intended. If the contrast rule applied to every shape, this
    // would fire on every card on every screen.
    expect(contrastRatio(tokenHex(ISA101, "panel"), tokenHex(ISA101, "ground"))).toBeLessThan(ISA101.rules.geometry.contrastGraphic);
    expect(contrastRatio(tokenHex(ISA101, "ink"), tokenHex(ISA101, "panel"))).toBeGreaterThan(ISA101.rules.geometry.contrastText);
  });
});

describe("the four defects the vision critic found, as arithmetic", () => {
  it("1 · a symbol with no outline on the grey ground cannot be made out", () => {
    // The shipped bug: the outline was scaled down with the path geometry, so
    // the equipment fill - one step off the ground, as the standard wants -
    // was all that was left.
    const invisible = pathPart("PMP_101", { Commands: "M", Points: "0,0" } as never, { left: 100, top: 100, width: 120, height: 96 }, { fill: T.equipmentFill, border: T.equipmentLine });
    delete (invisible as { Thickness?: number }).Thickness;
    const found = critiqueGeometry(screen(invisible), ISA101).findings;
    expect(rules(found)).toContain("geom.symbolInvisible");

    // And the fix passes: the same symbol with the outline the composite now sets.
    const drawn = { ...invisible, Thickness: 2 };
    expect(rules(critiqueGeometry(screen(drawn), ISA101).findings)).not.toContain("geom.symbolInvisible");
  });

  it("2 · a pump whose headline reading is a level is reported against its class", () => {
    const model = {
      version: 1 as const,
      areas: [{ id: "A", name: "Area" }],
      units: [{ id: "U", name: "Unit", area: "A", equipment: ["e1"] }],
      equipment: [
        {
          id: "e1",
          class: "pump",
          label: "Pump 101",
          unit: "U",
          roles: [{ role: "level", tag: "PMP_101_LEVEL", dataType: "REAL" }],
          ranges: {},
          confidence: 1,
        },
      ],
      connections: [],
      questions: [],
      assumptions: [],
      answers: {},
    };
    const found = critiqueHeadlines(model);
    expect(rules(found)).toEqual(["model.classHeadline"]);
    expect(found[0].message).toMatch(/pump .* leads with flow, speed, pressure, current, hours/);

    // A flow reading on the same pump is what its class leads with: silent.
    model.equipment[0].roles = [{ role: "flow", tag: "PMP_101_FLOW", dataType: "REAL" }];
    expect(critiqueHeadlines(model)).toEqual([]);
  });

  it("3 · a label sitting on its own value box is an overlap", () => {
    const label = textBox("AI_Flow_Lbl", "Discharge flow", { left: 100, top: 100, width: 200, height: 24 }, { size: 12, colour: T.ink });
    const value = numericDisplay("AI_Flow_Val", { left: 180, top: 104, width: 100, height: 28 }, 1);
    const found = critiqueGeometry(screen(label, value), ISA101).findings;
    expect(rules(found)).toContain("geom.overlap");
    expect(found.find((f) => f.rule === "geom.overlap")!.message).toMatch(/overlaps/);

    // The fix: the row is wide enough that the two do not meet.
    const clear = numericDisplay("AI_Flow_Val", { left: 320, top: 104, width: 100, height: 28 }, 1);
    expect(rules(critiqueGeometry(screen(label, clear), ISA101).findings)).not.toContain("geom.overlap");
  });

  it("4 · a tag ending in a word the role table never learnt is reported", () => {
    const v = (Name: string): Variable => ({ Name, DataType: "REAL", Comments: "", DeviceAddress: "" });
    const found = critiqueRoleCoverage([v("TNK_101_HEIGHT"), v("TNK_102_HEIGHT"), v("PMP_101_FLOW")]);
    expect(rules(found)).toEqual(["model.roleCoverage"]);
    expect(found[0].message).toMatch(/2 tags end in _HEIGHT/);

    // The two suffixes that were actually missing are now known, and quiet.
    expect(critiqueRoleCoverage([v("TNK_101_LEVEL"), v("PMP_102_HRS")])).toEqual([]);
    // A tag with no trailing word is a loop number, not an unknown role.
    expect(critiqueRoleCoverage([v("FT_101")])).toEqual([]);
  });
});

describe("the rest of the rules", () => {
  it("does not call a card an overlap of what is inside it", () => {
    const card = rectangle("Card_1", { left: 100, top: 100, width: 300, height: 120 }, { fill: T.panel, border: T.line });
    const inside = textBox("Card_1_Lbl", "Pump 101", { left: 108, top: 108, width: 200, height: 24 }, { size: 12, colour: T.ink });
    expect(rules(critiqueGeometry(screen(card, inside), ISA101).findings)).not.toContain("geom.overlap");
  });

  it("allows a composite's base part under its own members but not its members over each other", () => {
    const symbol = rectangle("PMP_101", { left: 100, top: 100, width: 120, height: 96 }, { fill: T.equipmentFill, border: T.equipmentLine });
    const run = lamp("PMP_101_RUN", "", "", { left: 208, top: 100, width: 12, height: 12 });
    // The running lamp sits on the corner of its own symbol, by design.
    expect(rules(critiqueGeometry(screen(symbol, run), ISA101).findings)).not.toContain("geom.overlap");
    // Two members of the same composite on top of each other is still a defect.
    const clash = lamp("PMP_101_FLT", "", "", { left: 204, top: 100, width: 12, height: 12 });
    expect(rules(critiqueGeometry(screen(symbol, run, clash), ISA101).findings)).toContain("geom.overlap");
  });

  it("reports text below the pack's contrast floor", () => {
    const faint = textBox("Lbl_Faint", "hard to read", { left: 100, top: 300, width: 200, height: 24 }, { size: 14, colour: T.panel });
    const found = critiqueGeometry(screen(faint), ISA101).findings;
    expect(rules(found)).toContain("geom.textContrast");
    expect(found.find((f) => f.rule === "geom.textContrast")!.message).toMatch(/floor for text is 4.5:1/);
  });

  it("reports a label that sits nearer to another composite than to its own", () => {
    const mine = rectangle("PMP_101", { left: 40, top: 100, width: 100, height: 80 }, { fill: T.equipmentFill, border: T.equipmentLine });
    const other = rectangle("PMP_102", { left: 600, top: 100, width: 100, height: 80 }, { fill: T.equipmentFill, border: T.equipmentLine });
    const stray = textBox("PMP_101_Lbl", "Pump 101", { left: 560, top: 200, width: 100, height: 20 }, { size: 12, colour: T.ink });
    const found = critiqueGeometry(screen(mine, other, stray), ISA101).findings;
    expect(rules(found)).toContain("geom.orphanLabel");
    expect(found.find((f) => f.rule === "geom.orphanLabel")!.message).toMatch(/reads as PMP_102's label/);
  });

  it("stays silent on a grid-snapped column and speaks on one that drifted", () => {
    const column = (lefts: number[]) =>
      lefts.map((left, i) => rectangle(`Box_${i}`, { left, top: 100 + i * 40, width: 80, height: 24 }, { fill: T.panel, border: T.line }));
    expect(rules(critiqueGeometry(screen(...column([200, 200, 200])), ISA101).findings)).not.toContain("geom.alignment");
    expect(rules(critiqueGeometry(screen(...column([200, 202, 203])), ISA101).findings)).toContain("geom.alignment");
  });

  it("calls a screen lopsided when one quarter carries it, and an empty screen nothing", () => {
    const heap = Array.from({ length: 12 }, (_, i) =>
      rectangle(`Heap_${i}`, { left: 8 + (i % 4) * 120, top: 8 + Math.floor(i / 4) * 90, width: 112, height: 84 }, { fill: T.panel, border: T.line }),
    );
    const found = critiqueGeometry(screen(...heap), ISA101);
    expect(rules(found.findings)).toContain("geom.balance");
    expect(found.metrics.quadrantRatio).toBeGreaterThan(ISA101.rules.geometry.quadrantRatio);
    // Nothing on the screen is quiet, not lopsided.
    expect(rules(critiqueGeometry(screen(), ISA101).findings)).not.toContain("geom.balance");
  });

  it("calls a wall a wall", () => {
    const wall = Array.from({ length: 40 }, (_, i) =>
      rectangle(`W_${i}`, { left: (i % 8) * 128, top: Math.floor(i / 8) * 120, width: 128, height: 120 }, { fill: T.panel, border: T.line }),
    );
    expect(rules(critiqueGeometry(screen(...wall), ISA101).findings)).toContain("geom.crowding");
  });

  it("scores five for nothing to change and drops a point for each real defect", () => {
    expect(scoreOf([])).toBe(5);
    expect(scoreOf([{ severity: "warning", rule: "geom.overlap", message: "" }])).toBe(4);
    expect(scoreOf([{ severity: "info", rule: "geom.alignment", message: "" }])).toBe(4.8);
    expect(scoreOf(Array.from({ length: 9 }, () => ({ severity: "warning" as const, rule: "geom.overlap", message: "" })))).toBe(1);
  });
});

describe("our own output, on every sample", () => {
  const every = samples();

  it("has samples to review", () => {
    expect(every.length).toBeGreaterThanOrEqual(8);
  });

  for (const { name, variables } of every) {
    it(`${name}: every generated screen is free of overlaps, invisible symbols and unreadable text`, () => {
      const reviewed = critiqueScreens(application(variables), ISA101);
      expect(reviewed.length).toBeGreaterThan(0);
      const serious = reviewed.flatMap((r) =>
        r.report.findings
          .filter((f) => ["geom.overlap", "geom.symbolInvisible", "geom.textContrast", "geom.orphanLabel", "geom.crowding"].includes(f.rule))
          .map((f) => `${r.screen}: ${f.rule} — ${f.message}`),
      );
      expect(serious).toEqual([]);
    });

    it(`${name}: the role table recognises every tag but the ones we decided not to`, () => {
      // The corpus records what we know we do not know, so that a *new*
      // unrecognised word fails the build. ACTIVE_TANK names which tank is
      // running: a noun, not a role, and teaching the table _TANK would
      // mis-read any tag that ends in the name of a thing.
      const accepted = /_TANK$/;
      const unexpected = critiqueRoleCoverage(variables).filter((f) => !accepted.test(f.tag ?? ""));
      expect(unexpected.map((f) => f.message)).toEqual([]);
    });

    it(`${name}: no equipment leads with a bare value its class could have read`, () => {
      // A genuine fallback is allowed and stays as information: a heater whose
      // only reading is an hours counter is a real heater with one tag. What
      // must not survive is the generic "value" - the class knows what a bare
      // PV measures, and lib/plant/classes.ts is where it says so.
      const generic = critiqueHeadlines(modelPlant(variables)).filter((f) => / a value \(/.test(f.message));
      expect(generic.map((f) => f.message)).toEqual([]);
    });
  }
});
