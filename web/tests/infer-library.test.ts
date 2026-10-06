/**
 * Equipment inference, widened by the machine library and by DDT structure.
 *
 * Every change here is additive: a tag list the old parse understood is read
 * the same way (the rest of the suite holds that), and these tests cover what
 * it could not read before - a declared DDT, a glued loop number, a prefix only
 * the library knows, a member name only a class spells, and a level alarm that
 * named the wrong machine.
 */

import { describe, expect, it } from "vitest";
import { inferEquipment, proposeAlarms } from "@/lib/ai/infer";
import { parseControlExpert } from "@/lib/tags/controlExpert";
import type { Variable } from "@/lib/ote/schema";

const v = (Name: string, DataType: Variable["DataType"] = "BOOL", Comments = ""): Variable => ({ Name, DataType, Comments, DeviceAddress: "" });

describe("inference with the library", () => {
  it("reads a loop number glued to its prefix", () => {
    const [unit] = inferEquipment([v("PMP101_RUN"), v("PMP101_FLT")]);
    expect(unit).toMatchObject({ id: "PMP_101", kind: "pump", loop: "101" });
  });

  it("recognises a machine only the library names", () => {
    const units = inferEquipment([v("MIX_301_RUN"), v("MIX_301_FLT"), v("MIX_301_SPD", "REAL")]);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ kind: "mixer", symbol: "Mixing/Mixing01", label: "Mixer 301" });
  });

  it("takes a role from the class's own spelling when the generic table says only value", () => {
    const [unit] = inferEquipment([v("PMP_1_RUN"), v("PMP_1_STARTCMD")]);
    expect(unit.roles.find((r) => r.tag === "PMP_1_STARTCMD")?.role).toBe("command");
  });

  it("does not take an instrument code for a machine", () => {
    const units = inferEquipment([v("FIT_101_PV", "REAL"), v("PMP_101_RUN")]);
    expect(units).toHaveLength(1);
    expect(units[0].kind).toBe("pump");
    expect(units[0].tags).toContain("FIT_101_PV");
  });
});

describe("inference from DDT structure", () => {
  const xsy = `<?xml version="1.0"?><VariablesExchangeFile>
    <DDTSource DDTName="T_AgitatorCtl"><structure>
      <variables name="RunFb" typeName="BOOL"/><variables name="Trip" typeName="BOOL"/>
      <variables name="StartCmd" typeName="BOOL"/><variables name="Speed" typeName="REAL"/>
    </structure></DDTSource>
    <dataBlock>
      <variables name="Blend_A" typeName="T_AgitatorCtl"><comment>Blend tank A agitator</comment></variables>
      <variables name="LT_7_PV" typeName="REAL"><comment>Blend tank A level</comment></variables>
    </dataBlock></VariablesExchangeFile>`;
  const parsed = parseControlExpert(xsy);

  it("makes one unit of a DDT instance whose name says nothing, classified by its type", () => {
    const units = inferEquipment(parsed.variables, parsed.structure);
    const blend = units.find((u) => u.id === "Blend_A")!;
    expect(blend.kind).toBe("mixer");
    expect(blend.ddt).toBe("T_AgitatorCtl");
    expect(blend.confidence).toBeGreaterThanOrEqual(0.5);
    expect(blend.tags.sort()).toEqual(["Blend_A_RunFb", "Blend_A_Speed", "Blend_A_StartCmd", "Blend_A_Trip"]);
    const role = (t: string) => blend.roles.find((r) => r.tag === t)?.role;
    expect([role("Blend_A_RunFb"), role("Blend_A_Trip"), role("Blend_A_StartCmd"), role("Blend_A_Speed")]).toEqual(["running", "fault", "command", "speed"]);
  });

  it("reads exactly as before without structure", () => {
    const without = inferEquipment(parsed.variables);
    expect(without.some((u) => u.ddt)).toBe(false);
  });
});

describe("level alarms name what is measured", () => {
  it("does not call a transmitter on a pump's loop the pump's level", () => {
    const units = inferEquipment([v("PMP_101_RUN"), v("LT_101_PV", "REAL", "Break tank level")]);
    const messages = proposeAlarms(units).map((a) => a.message);
    expect(messages).toContain("Break tank level high");
    expect(messages.some((m) => /Pump 101 level/.test(m))).toBe(false);
  });

  it("keeps the vessel's name on a tank", () => {
    const units = inferEquipment([v("TNK_5_LEVEL", "REAL")]);
    expect(proposeAlarms(units).map((a) => a.message)).toEqual(["Tank 5 level high", "Tank 5 level critically high"]);
  });

  it("falls back to the tag when there is no comment", () => {
    const units = inferEquipment([v("PMP_9_RUN"), v("LT_9_PV", "REAL")]);
    expect(proposeAlarms(units)[0].message).toBe("LT 9 level high");
  });
});
