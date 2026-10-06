/**
 * Control Expert exchange files: variables with their types and addresses.
 *
 * The fixture is shaped on exchange files written by Control Expert 14.0 -
 * `fileHeader company="Schneider Automation"`, variables in `<dataBlock>` as
 * `<variables name typeName>` with a `<comment>` and an optional
 * `<variableInit>`, `topologicalAddress` wrapped onto its own line - and on the
 * DDT layout (`<DDTSource DDTName>` holding `<structure>`). The plant in it is
 * ours; nothing is copied from a Schneider file.
 */

import { describe, expect, it } from "vitest";
import { parseControlExpert } from "@/lib/tags/controlExpert";
import { parseXml } from "@/lib/tags/xml";
import { parseTagsFile } from "@/lib/tags/parse";

const XSY = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<VariablesExchangeFile>
	<fileHeader company="Schneider Automation" product="Control Expert V14.0 - 190112" dateTime="date_and_time#2026-10-6-9:0:0" content="Variable source file" DTDVersion="41"></fileHeader>
	<contentHeader name="Transfer Station" version="0.0.12" dateTime="date_and_time#2026-10-6-9:0:0"></contentHeader>
	<DDTSource DDTName="PumpCtrl_DDT" version="0.03" dateTime="dt#2026-01-01-00:00:00">
		<comment>Fixed-speed pump interface</comment>
		<structure>
			<variables name="Run" typeName="BOOL"><comment>Running feedback</comment></variables>
			<variables name="Flt" typeName="BOOL"><comment>Fault</comment></variables>
			<variables name="StartCmd" typeName="BOOL"><comment>Start command</comment></variables>
			<variables name="Hours" typeName="UDINT"><comment>Run hours</comment></variables>
			<variables name="Motor" typeName="MotorData_DDT"></variables>
			<variables name="History" typeName="ARRAY[0..9] OF REAL"></variables>
		</structure>
	</DDTSource>
	<DDTSource DDTName="MotorData_DDT" version="0.01">
		<structure>
			<variables name="Amps" typeName="REAL"><comment>Current &amp; load</comment></variables>
		</structure>
	</DDTSource>
	<dataBlock>
		<variables name="PMP_101" typeName="PumpCtrl_DDT"
			topologicalAddress="%MW100">
			<comment>Transfer pump 1</comment>
		</variables>
		<variables name="LT_101_PV" typeName="REAL" topologicalAddress="%MF200">
			<comment>Break tank level</comment>
			<variableInit value="0.0"></variableInit>
		</variables>
		<variables name="ESTOP" typeName="EBOOL" topologicalAddress="%I0.3.1"><comment>Emergency stop</comment></variables>
		<variables name="MODE_TXT" typeName="STRING[16]"></variables>
		<variables name="FillTimer" typeName="TON"><comment>Fill delay</comment></variables>
		<variables name="Samples" typeName="ARRAY[1..20] OF INT"></variables>
		<variables name="Ghost" typeName="Undeclared_DDT"></variables>
	</dataBlock>
</VariablesExchangeFile>`;

describe("the XML reader", () => {
  it("decodes entities and keeps wrapped attributes", () => {
    const doc = parseXml(`<a x="1&amp;2"\n  y='3'><b>t &lt; u &#65;</b><![CDATA[<raw>]]></a>`);
    const a = doc.children[0];
    expect(a.attrs).toEqual({ x: "1&2", y: "3" });
    expect(a.children[0].text).toBe("t < u A");
    expect(a.text).toBe("<raw>");
  });

  it("reports the line of a mismatched close", () => {
    expect(() => parseXml("<a>\n<b>\n</a>")).toThrow(/line 3/);
  });
});

describe("a Control Expert variable export", () => {
  const r = parseControlExpert(XSY);

  it("reads elementary variables with their addresses and comments", () => {
    expect(r.variables.find((v) => v.Name === "LT_101_PV")).toEqual({ Name: "LT_101_PV", DataType: "REAL", Comments: "Break tank level", DeviceAddress: "%MF200" });
    expect(r.variables.find((v) => v.Name === "ESTOP")).toMatchObject({ DataType: "BOOL", DeviceAddress: "%I0.3.1" });
    expect(r.variables.find((v) => v.Name === "MODE_TXT")?.DataType).toBe("STRING");
  });

  it("flattens a DDT instance into OTE-legal variables, nested types included", () => {
    const names = r.variables.map((v) => v.Name);
    expect(names).toEqual(expect.arrayContaining(["PMP_101_Run", "PMP_101_Flt", "PMP_101_StartCmd", "PMP_101_Hours", "PMP_101_Motor_Amps"]));
    expect(r.variables.find((v) => v.Name === "PMP_101_Motor_Amps")?.Comments).toBe("Transfer pump 1 - Current & load");
    expect(r.variables.find((v) => v.Name === "PMP_101_Hours")?.DataType).toBe("UDINT");
  });

  it("reports the instance as structure: equipment declared by the type system", () => {
    expect(r.structure).toHaveLength(1);
    const pump = r.structure[0];
    expect(pump).toMatchObject({ instance: "PMP_101", ddt: "PumpCtrl_DDT", address: "%MW100", comment: "Transfer pump 1" });
    expect(pump.members.map((m) => m.path)).toEqual(["Run", "Flt", "StartCmd", "Hours", "Motor.Amps"]);
    expect(pump.members.find((m) => m.path === "Run")?.variable).toBe("PMP_101_Run");
  });

  it("reports what it did not flatten, each with its reason", () => {
    const reasons = Object.fromEntries(r.skipped.map((s) => [s.value, s.reason]));
    expect(reasons["FillTimer (TON)"]).toMatch(/function block/);
    expect(reasons["Samples (ARRAY[1..20] OF INT)"]).toMatch(/^array/);
    expect(reasons["Ghost (Undeclared_DDT)"]).toMatch(/not defined in this file/);
    expect(reasons["PMP_101.History (ARRAY[0..9] OF REAL)"]).toMatch(/array member/);
  });

  it("says what wrote it", () => {
    expect(r.producer).toBe("Control Expert V14.0 - 190112");
  });

  it("goes through the same door as every other tag file", async () => {
    const via = await parseTagsFile(new TextEncoder().encode(XSY), "Station.xsy");
    expect(via.source).toBe("control-expert");
    expect(via.variables).toEqual(r.variables);
    expect(via.structure).toEqual(r.structure);
  });

  it("refuses XML that is not well formed, with where", () => {
    expect(() => parseControlExpert("<VariablesExchangeFile><dataBlock></VariablesExchangeFile>")).toThrow(/not well-formed XML/);
  });
});
