/**
 * The machine library is data, and data can be wrong in ways tsc cannot see:
 * a symbol OTE does not ship, a role that two classes spell the same way, an
 * alarm on a role its class does not have. These tests hold it to itself and
 * to the installation.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MACHINE_CLASSES, classify, machineClass, roleIn, severityOf, words } from "@/lib/library/machines";

const INDEX = path.join(__dirname, "..", "src", "lib", "ote", "graphics-index.json");

describe("the machine library", () => {
  it("has unique ids and covers process, utilities, packaging and discrete plants", () => {
    const ids = MACHINE_CLASSES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const industry of ["water", "process", "hvac", "packaging", "discrete", "power"]) {
      expect(MACHINE_CLASSES.some((c) => c.industries.includes(industry as never)), industry).toBe(true);
    }
    expect(MACHINE_CLASSES.length).toBeGreaterThanOrEqual(30);
  });

  it("raises alarms only on roles its class has, each with a consequence and an action", () => {
    for (const c of MACHINE_CLASSES) {
      const roles = new Set(c.roles.map((r) => r.role));
      for (const a of c.alarms) {
        expect(roles.has(a.role), `${c.id}: alarm on ${a.role}`).toBe(true);
        expect(a.consequence.length, `${c.id}: ${a.message}`).toBeGreaterThan(10);
        expect(a.action.length, `${c.id}: ${a.message}`).toBeGreaterThan(10);
      }
      for (const h of c.headline) expect(roles.has(h), `${c.id}: headline ${h}`).toBe(true);
      for (const t of c.trends) expect(roles.has(t), `${c.id}: trend ${t}`).toBe(true);
    }
  });

  it("names only symbols OTE 4.4 ships", () => {
    if (!fs.existsSync(INDEX)) return; // no local installation: npm run index:graphics
    const parsed = JSON.parse(fs.readFileSync(INDEX, "utf8")) as { symbols: { category: string; name: string }[] };
    const shipped = new Set(parsed.symbols.map((s) => `${s.category.replace(/^03-Icons\//, "")}/${s.name}`.toLowerCase()));
    for (const c of MACHINE_CLASSES) if (c.symbol) expect(shipped.has(c.symbol.toLowerCase()), `${c.id}: ${c.symbol}`).toBe(true);
  });

  it("follows PackML for packaging machines", () => {
    const packml = MACHINE_CLASSES.filter((c) => c.packml);
    expect(packml.map((c) => c.id)).toEqual(expect.arrayContaining(["filler", "capper", "labeler", "case-packer", "palletizer"]));
    const filler = machineClass("filler")!;
    expect(roleIn(filler, "FIL_01_StateCurrent")?.role).toBe("state");
    expect(roleIn(filler, "FIL_01.Admin.ProdProcessedCount")?.role).toBe("count");
  });

  it("maps priorities onto OTE severities", () => {
    expect([severityOf("high"), severityOf("medium"), severityOf("low")]).toEqual([7, 5, 3]);
  });
});

describe("classifying a group of signals", () => {
  it("splits names the way PLC engineers write them", () => {
    expect(words("PMP101_RunFB")).toEqual(["PMP", "RUN", "FB"]);
    expect(words("Pump_1.StartCmd")).toEqual(["PUMP", "START", "CMD"]);
  });

  it("trusts a declared DDT over a prefix", () => {
    const [best] = classify({ name: "U_101", typeName: "PumpCtrl_DDT", members: ["Run", "Flt", "StartCmd", "Hours"] });
    expect(best.classId).toBe("pump");
    expect(best.confidence).toBeGreaterThanOrEqual(0.75);
    expect(best.evidence[0]).toMatch(/PumpCtrl_DDT/);
  });

  it("reads a prefix and the shape of the signals", () => {
    const [best] = classify({ name: "VLV_202", members: ["VLV_202_OPN", "VLV_202_CLS", "VLV_202_OPENCMD"] });
    expect(best.classId).toBe("valve");
    expect(best.evidence.some((e) => /every expected role/.test(e))).toBe(true);
  });

  it("is unsure when the evidence is thin, and says what it has", () => {
    const ranked = classify({ name: "P_7", members: ["P_7_PV"] });
    expect(ranked[0].confidence).toBeLessThan(0.75);
    expect(ranked.length).toBeGreaterThan(1);
  });

  it("uses comments", () => {
    const [best] = classify({ name: "U_9", members: ["U_9_RUN", "U_9_FLT"], comments: ["Agitator 9 running"] });
    expect(best.classId).toBe("mixer");
  });
});
