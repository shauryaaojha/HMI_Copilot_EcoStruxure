/**
 * The plant brief: §5.6 of docs/PLAN_FULL_ARCHITECTURE.md.
 *
 * Six things the brief has to do, each of which the old path got wrong. A
 * count that nobody gave is a question rather than a one; a tag that traces to
 * no confirmed row is refused rather than drawn; removing a row takes its tags
 * with it; both ways of filling a brief in produce the same confirmable shape;
 * a description the catalogue does not recognise is asked about rather than
 * built as nothing; and the knowledge base may advise on signals but may never
 * add equipment to a plant.
 *
 * No key and no network: the model path is a function here, so the schema and
 * the coercion are tested rather than a provider.
 */

import { describe, expect, it } from "vitest";
import {
  Brief,
  canConfirm,
  confirm,
  problemsWith,
  tagsFromBrief,
  untraceable,
  unitFromKind,
  withoutUnit,
  type Unit,
} from "@/lib/brief/brief";
import { CATALOGUE, kindOf } from "@/lib/brief/catalogue";
import { briefByRules, coerceBrief, draftBrief } from "@/lib/brief/draft";
import { suggestSignals, withSuggestions } from "@/lib/brief/suggest";
import { checkBrief } from "@/lib/brief/validate";
import type { ProjectKnowledge } from "@/lib/knowledge/scan";
import type { Variable } from "@/lib/ote/schema";

const unit = (over: Partial<Unit> & Pick<Unit, "kind">): Unit => ({
  id: `${over.kind}-1`,
  label: kindOf(over.kind)?.label ?? over.kind,
  signals: [...(kindOf(over.kind)?.defaultSignals ?? [])],
  count: 2,
  ...over,
});

const briefOf = (...units: Unit[]): Brief => Brief.parse({ units });

describe("confirming a brief", () => {
  it("refuses a missing count, and the error names the field", () => {
    const vague = briefOf(unit({ kind: "tank", count: undefined }));
    expect(canConfirm(vague)).toBe(false);

    const problem = problemsWith(vague).find((p) => p.field === "count");
    expect(problem).toBeDefined();
    expect(problem!.unitId).toBe("tank-1");
    // The message says which row and what is missing, not "invalid brief".
    expect(problem!.message).toMatch(/Tank level/);
    expect(problem!.message).toMatch(/how many/i);

    // A count of zero is refused too: "none" is not a plant.
    expect(canConfirm(briefOf(unit({ kind: "tank", count: 0 })))).toBe(false);
    expect(canConfirm(briefOf(unit({ kind: "tank", count: 2 })))).toBe(true);
  });

  it("refuses an empty brief rather than building nothing", () => {
    expect(canConfirm(Brief.parse({}))).toBe(false);
    expect(problemsWith(Brief.parse({}))[0].field).toBe("units");
    // And nothing can be minted from it, by any route.
    expect(() => tagsFromBrief(Brief.parse({}))).toThrow(/at least one unit/);
  });

  it("refuses a kind, or a signal, the catalogue does not have", () => {
    const invented = briefOf(unit({ kind: "centrifuge", label: "Centrifuge", signals: ["RUN"] }));
    expect(problemsWith(invented).some((p) => p.field === "kind")).toBe(true);

    const wrongSignal = briefOf(unit({ kind: "valve", signals: ["OPEN", "PV"] }));
    const problem = problemsWith(wrongSignal).find((p) => p.field === "signals");
    expect(problem!.message).toMatch(/PV/);
    expect(problem!.message).toMatch(/valve/);
  });
});

describe("validation against the confirmed brief", () => {
  it("rejects a tag that no confirmed row accounts for", () => {
    const brief = briefOf(unit({ kind: "pump", count: 1 }));
    const { confirmed, variables } = confirm(brief, "rules");
    expect(checkBrief(variables, confirmed)).toEqual([]);

    // A tag that arrived some other way: a later model turn, an edit, a brief
    // row that was removed and left its tags behind.
    const stray: Variable = { Name: "CNV_101_RUN", DataType: "BOOL", Comments: "Conveyor 1 running", DeviceAddress: "" };
    const findings = checkBrief([...variables, stray], confirmed);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("brief.provenance");
    expect(findings[0].severity).toBe("error");
    expect(findings[0].tag).toBe("CNV_101_RUN");
  });

  it("rejects a tag whose row was removed, even though its provenance was once real", () => {
    const brief = briefOf(unit({ kind: "pump", count: 1 }), unit({ kind: "fan", count: 1 }));
    const { confirmed, variables } = confirm(brief, "rules");
    // The row goes; the tags stay behind, as they would after a hand edit.
    const shorter = { ...confirmed, brief: { ...brief, units: brief.units.filter((u) => u.id !== "fan-1") } };
    const refused = checkBrief(variables, shorter).filter((f) => f.rule === "brief.provenance");
    expect(refused.length).toBeGreaterThan(0);
    expect(refused.every((f) => f.tag?.startsWith("FAN_"))).toBe(true);
  });

  it("says nothing at all about a project with no brief", () => {
    const real: Variable[] = [{ Name: "PMP_101_RUN", DataType: "BOOL", Comments: "", DeviceAddress: "" }];
    expect(checkBrief(real, null)).toEqual([]);
    expect(checkBrief(real, undefined)).toEqual([]);
  });

  it("notices a confirmed row whose tags are not in the project", () => {
    const brief = briefOf(unit({ kind: "pump", count: 1 }), unit({ kind: "fan", count: 1 }));
    const { confirmed, variables } = confirm(brief, "rules");
    const withoutFan = variables.filter((v) => !v.Name.startsWith("FAN_"));
    const findings = checkBrief(withoutFan, confirmed);
    expect(findings.some((f) => f.rule === "brief.missing" && /Fan/.test(f.message))).toBe(true);
    // A disagreement, not a wrong screen: nothing on screen is bound to it.
    expect(findings.every((f) => f.severity !== "error")).toBe(true);
  });
});

describe("provenance", () => {
  it("records the row every placeholder came from", () => {
    const brief = briefOf(unit({ kind: "pump", count: 2 }), unit({ kind: "tank", count: 1 }));
    const { variables, provenance } = tagsFromBrief(brief);
    expect(variables.length).toBeGreaterThan(0);
    // Every tag, with no exception, traces to a row.
    for (const v of variables) expect(brief.units.some((u) => u.id === provenance.byTag[v.Name])).toBe(true);
    expect(untraceable(variables, brief, provenance)).toEqual([]);

    // And the rows it traces to are the right ones.
    expect(provenance.byTag["PMP_101_RUN"]).toBe("pump-1");
    expect(provenance.byTag["LT_101_PV"]).toBe("tank-1");
  });

  it("takes a row's tags with it when the row is removed", () => {
    const brief = briefOf(unit({ kind: "pump", count: 2 }), unit({ kind: "tank", count: 1 }));
    const drafted = tagsFromBrief(brief);
    const after = withoutUnit("tank-1", brief, drafted.variables, drafted.provenance);

    expect(after.brief.units.map((u) => u.id)).toEqual(["pump-1"]);
    expect(after.variables.some((v) => v.Name.startsWith("LT_"))).toBe(false);
    expect(after.variables.some((v) => v.Name.startsWith("PMP_"))).toBe(true);
    expect(after.provenance.byTag["LT_101_PV"]).toBeUndefined();
    // Nothing is orphaned: what is left still traces, so validation is clean.
    expect(untraceable(after.variables, after.brief, after.provenance)).toEqual([]);
    expect(checkBrief(after.variables, { brief: after.brief, provenance: after.provenance, confirmedAt: 0, by: "rules" })).toEqual([]);
  });

  it("numbers and names tags the way the nine kinds already did", () => {
    // Behaviour unchanged for the catalogue's kinds (§5.4): the generator reads
    // equipment from these names, so a changed convention would change screens.
    const brief = briefOf(unit({ kind: "pump", count: 2, signals: ["RUN", "FLT"] }));
    const names = tagsFromBrief(brief).variables.map((v) => v.Name);
    expect(names).toEqual(["PMP_101_RUN", "PMP_101_FLT", "PMP_102_RUN", "PMP_102_FLT"]);
    expect(tagsFromBrief(brief).variables[0].DataType).toBe("BOOL");
  });

  it("gives every catalogue kind a prefix, a signal set and a usable default", () => {
    for (const kind of CATALOGUE) {
      expect(kind.prefix).toMatch(/^[A-Z]{2,3}$/);
      expect(kind.signals.length).toBeGreaterThan(0);
      expect(kind.defaultSignals.length).toBeGreaterThan(0);
      const allowed = new Set(kind.signals.map((s) => s.id));
      for (const signal of [...kind.defaultSignals, ...kind.defaultAlarms]) expect(allowed.has(signal)).toBe(true);
      // Each kind on its own is a confirmable brief.
      expect(canConfirm(briefOf(unitFromKind(kind.id, 1, 1)))).toBe(true);
    }
  });
});

describe("drafting a brief", () => {
  const description = "A transfer pump station with two duty pumps, a break tank and a discharge flow meter";

  it("fills one in from the description by rules, and it confirms", async () => {
    const drafted = await draftBrief(description);
    expect(drafted.by).toBe("rules");
    expect(drafted.brief.units.map((u) => u.kind).sort()).toEqual(["flow", "pump", "tank"]);
    expect(drafted.brief.units.find((u) => u.kind === "pump")!.count).toBe(2);
    // The tank and the meter had no number, so they have no count - and the
    // brief therefore cannot be confirmed until a person gives one.
    expect(drafted.brief.units.find((u) => u.kind === "tank")!.count).toBeUndefined();
    expect(canConfirm(drafted.brief)).toBe(false);

    const filled = { ...drafted.brief, units: drafted.brief.units.map((u) => ({ ...u, count: u.count ?? 1 })) };
    expect(problemsWith(filled)).toEqual([]);
    expect(tagsFromBrief(filled).variables.length).toBeGreaterThan(0);
  });

  it("fills one in from the model's answer, and it confirms too", async () => {
    const answer = {
      plant: { name: "Transfer station", purpose: "Moves water to the break tank" },
      units: [
        { kind: "pump", label: "Duty pump", count: 2, signals: ["RUN", "FLT", "START", "STOP"] },
        { kind: "tank", label: "Break tank", count: 1, signals: ["PV", "HI", "LO"] },
      ],
    };
    const drafted = await draftBrief(description, { ask: async () => answer });
    expect(drafted.by).toBe("model");
    expect(drafted.brief.plant.name).toBe("Transfer station");
    expect(drafted.brief.units.map((u) => u.label)).toEqual(["Duty pump", "Break tank"]);
    // The same end state as the rules path: a brief that validates and mints.
    expect(problemsWith(drafted.brief)).toEqual([]);
    expect(tagsFromBrief(drafted.brief).variables.some((v) => v.Name === "PMP_101_RUN")).toBe(true);
  });

  it("drops a kind or a signal the model invented, rather than repairing it", () => {
    const coerced = coerceBrief({
      plant: { name: "", purpose: "" },
      units: [
        { kind: "centrifuge", label: "Centrifuge", count: 1, signals: ["RUN"] },
        { kind: "valve", label: "Inlet valve", count: 1, signals: ["OPEN", "PV", "SPEED"] },
      ],
    });
    expect(coerced!.units.map((u) => u.kind)).toEqual(["valve"]);
    expect(coerced!.units[0].signals).toEqual(["OPEN"]);
    // Nothing was invented, so the result confirms as it stands.
    expect(problemsWith(coerced!)).toEqual([]);
  });

  it("asks rather than building nothing when no catalogue kind is named", async () => {
    const drafted = await draftBrief("a facility that does something with the stuff");
    expect(drafted.by).toBe("clarify");
    expect(drafted.brief.units).toEqual([]);
    expect(drafted.questions).toBeDefined();
    // At most two, and specific enough to answer.
    expect(drafted.questions!.length).toBeLessThanOrEqual(2);
    expect(drafted.questions![0]).toMatch(/equipment/i);
    expect(drafted.questions![1]).toMatch(/how many/i);
  });

  it("falls back to the rules when the model answers with nothing usable", async () => {
    for (const answer of [null, {}, { units: [] }, { units: [{ kind: "centrifuge" }] }, "not json"]) {
      const drafted = await draftBrief(description, { ask: async () => answer });
      expect(drafted.by).toBe("rules");
      expect(drafted.brief.units.length).toBeGreaterThan(0);
    }
  });

  it("reads a written-out number, and will not take an absurd one literally", () => {
    const pumps = (text: string) => briefByRules(text).units.find((u) => u.kind === "pump")?.count;
    expect(pumps("three pumps")).toBe(3);
    expect(pumps("a plant with pumps")).toBeUndefined();
    expect(pumps("400 pumps")).toBe(20);
  });
});

describe("what the knowledge base may suggest", () => {
  /** A scanned project: only the fields a suggestion reads. */
  const scanned = (id: string, equipment: ProjectKnowledge["equipment"]): ProjectKnowledge =>
    ({ id, equipment } as ProjectKnowledge);

  const pumpProject = (id: string, signals: string[]) =>
    scanned(id, [{ id: "p", kind: "pump", label: "Pump", tags: signals.map((s) => `PMP_101_${s}`) }]);

  it("suggests a signal set the brief left out, from projects that had it", () => {
    const brief = briefOf(unit({ kind: "pump", count: 1, signals: ["RUN"] }));
    const records = [
      pumpProject("a", ["RUN", "FLT", "START", "STOP"]),
      pumpProject("b", ["RUN", "FLT", "START", "STOP"]),
      pumpProject("c", ["RUN", "FLT"]),
    ];
    const suggestions = suggestSignals(brief, records);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].unitId).toBe("pump-1");
    expect(suggestions[0].add.sort()).toEqual(["FLT", "START", "STOP"]);
    expect(suggestions[0].projects).toBe(3);

    // A suggestion is not an edit: the brief is unchanged until it is accepted.
    expect(brief.units[0].signals).toEqual(["RUN"]);
    const accepted = withSuggestions(brief, suggestions);
    expect(accepted.units[0].signals.sort()).toEqual(["FLT", "RUN", "START", "STOP"]);
  });

  it("never adds a unit, however many projects had one", () => {
    const brief = briefOf(unit({ kind: "pump", count: 1 }));
    const records = [
      scanned("a", [
        { id: "t", kind: "tank", label: "Tank", tags: ["LT_101_PV", "LT_101_HI"] },
        { id: "c", kind: "conveyor", label: "Conveyor", tags: ["CNV_101_RUN"] },
      ]),
      scanned("b", [{ id: "t", kind: "tank", label: "Tank", tags: ["LT_201_PV", "LT_201_HI"] }]),
    ];
    // Every project it has ever seen had a tank. This plant still has none.
    expect(suggestSignals(brief, records).some((s) => s.unitId !== "pump-1")).toBe(false);
    expect(withSuggestions(brief, suggestSignals(brief, records)).units.map((u) => u.kind)).toEqual(["pump"]);
  });

  it("cannot suggest a signal outside the kind's own catalogue", () => {
    const brief = briefOf(unit({ kind: "valve", count: 1, signals: ["OPEN"] }));
    // Every scanned valve carried SPEED, which a valve in the catalogue has not.
    const records = ["a", "b", "c"].map((id) =>
      scanned(id, [{ id: "v", kind: "valve", label: "Valve", tags: ["XV_101_OPEN", "XV_101_SPEED", "XV_101_CLOSED"] }]),
    );
    const suggestions = suggestSignals(brief, records);
    expect(suggestions[0].add).not.toContain("SPEED");
    expect(suggestions[0].add).toContain("CLOSED");
    const accepted = withSuggestions(brief, [{ ...suggestions[0], add: [...suggestions[0].add, "SPEED"] }]);
    expect(accepted.units[0].signals).not.toContain("SPEED");
    expect(problemsWith(accepted)).toEqual([]);
  });

  it("says nothing with an empty store, which is every laptop today", () => {
    const brief = briefOf(unit({ kind: "pump", count: 1, signals: ["RUN"] }));
    expect(suggestSignals(brief, [])).toEqual([]);
    // One project is not evidence either.
    expect(suggestSignals(brief, [pumpProject("a", ["RUN", "FLT", "START", "STOP"])])).toEqual([]);
    expect(withSuggestions(brief, [])).toEqual(brief);
  });
});
