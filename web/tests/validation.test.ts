/**
 * The naming rules are the product's, so these tests assert against what the
 * documentation says, not against what our implementation happens to do.
 */

import { describe, expect, it } from "vitest";
import { checkName, normaliseNames, suggestName } from "@/lib/validation/naming";
import { summarise, validateProject } from "@/lib/validation/rules";
import { renderReport } from "@/lib/validation/report";
import { normaliseDataType, parseTags } from "@/lib/tags/parse";
import { buildDemoProject } from "@/lib/ote/demo-project";

describe("naming", () => {
  it("accepts ordinary PLC tag names", () => {
    for (const name of ["PMP_101_RUN", "FT_101_PV", "_internal", "Tank1Level"]) {
      expect(checkName(name).ok, name).toBe(true);
    }
  });

  it("rejects a leading digit and spaces", () => {
    expect(checkName("101_PUMP").problem).toBe("leading-digit");
    expect(checkName("pump run").problem).toBe("illegal-characters");
    expect(checkName("flow-rate").problem).toBe("illegal-characters");
  });

  it("rejects data types and control codes whatever the case", () => {
    for (const name of ["REAL", "real", "Bool", "WORD", "ACK", "date_and_time"]) {
      expect(checkName(name).problem, name).toBe("reserved-word");
    }
  });

  it("rejects script keywords only in their documented casing", () => {
    expect(checkName("class").problem).toBe("reserved-word");
    // Case-sensitive list, so a different casing is a perfectly good tag name.
    expect(checkName("Class").ok).toBe(true);
  });

  it("flags keywords that scripts must reach through $Global", () => {
    const check = checkName("for");
    expect(check.ok).toBe(true);
    expect(check.problem).toBe("script-keyword");
    expect(check.message).toContain("$Global.for");
  });

  it("suggests the smallest legal change", () => {
    expect(suggestName("pump run")).toBe("pump_run");
    expect(suggestName("101_PUMP")).toBe("Tag_101_PUMP");
    expect(suggestName("REAL")).toBe("REAL_1");
    expect(checkName(suggestName("flow-rate (m3/h)")).ok).toBe(true);
  });

  it("keeps corrected names unique and reports every change", () => {
    const { names, corrections } = normaliseNames([
      "pump run",
      "pump-run",
      "PMP_101_RUN",
      "REAL",
    ]);
    expect(new Set(names).size).toBe(4);
    expect(names[0]).toBe("pump_run");
    expect(names[1]).toBe("pump_run_2");
    expect(names[2]).toBe("PMP_101_RUN");
    // Three changed, the already-valid one did not.
    expect(corrections).toHaveLength(3);
    expect(corrections.every((c) => c.from !== c.to)).toBe(true);
  });
});

describe("data types", () => {
  it("maps PLC spellings onto IEC types", () => {
    expect(normaliseDataType("Bit")).toBe("BOOL");
    expect(normaliseDataType("EBOOL")).toBe("BOOL");
    expect(normaliseDataType("float")).toBe("REAL");
    expect(normaliseDataType("INT32")).toBe("DINT");
    expect(normaliseDataType("Double")).toBe("LREAL");
    expect(normaliseDataType("REAL")).toBe("REAL");
  });

  it("returns null rather than guessing at something unrecognised", () => {
    expect(normaliseDataType("wibble")).toBeNull();
    expect(normaliseDataType("")).toBeNull();
  });
});

describe("project validation", () => {
  it("passes the demo project with no errors", () => {
    const findings = validateProject(buildDemoProject());
    const counts = summarise(findings);
    expect(counts.errors).toBe(0);
  });

  it("catches a type mismatch", () => {
    const project = buildDemoProject();
    // Point a Lamp at the REAL flow tag.
    const lamp = project.wires.find((w) => w.part.Type === "Lamp")!;
    lamp.tag = "FT_101_PV";

    const findings = validateProject(project);
    const mismatch = findings.find((f) => f.rule === "type-mismatch");
    expect(mismatch?.severity).toBe("error");
    expect(mismatch?.message).toContain("REAL");
    expect(mismatch?.objectId).toBe(lamp.part.UniqueId);
  });

  it("catches a binding to a tag that was never declared", () => {
    const project = buildDemoProject();
    project.wires[0].tag = "GHOST_TAG";
    const findings = validateProject(project);
    expect(findings.some((f) => f.rule === "binding" && f.message.includes("GHOST_TAG"))).toBe(true);
  });

  it("notices a fault tag that raises no alarm", () => {
    const project = buildDemoProject();
    project.alarms = project.alarms.filter((a) => a.Trigger !== "PMP_101_FLT");
    const findings = validateProject(project);
    const gap = findings.find(
      (f) => f.rule === "completeness" && f.tag === "PMP_101_FLT",
    );
    expect(gap?.severity).toBe("warning");
    expect(gap?.suggestion).toContain("bit alarm");
  });

  it("catches a level alarm with no setpoint", () => {
    const project = buildDemoProject();
    const level = project.alarms.find((a) => a.AlarmRecordType === 2)!;
    level.Value = "";
    const findings = validateProject(project);
    expect(findings.some((f) => f.rule === "alarm" && f.message.includes("no numeric setpoint"))).toBe(true);
  });

  it("does not complain about fit when the screen matches the panel", () => {
    // The demo is 1024x600 on a 1024x600 panel - Target.dat says so.
    const findings = validateProject(buildDemoProject());
    expect(findings.some((f) => f.rule === "standards")).toBe(false);
  });

  it("warns when the screen leaves the panel partly unused", () => {
    const project = buildDemoProject();
    project.target = { model: "HMIST6500AWADI", width: 1024, height: 768 };
    const fit = validateProject(project).find((f) => f.rule === "standards");
    expect(fit?.severity).toBe("warning");
    expect(fit?.message).toContain("unused area");
  });

  it("errors when a screen is larger than the panel", () => {
    const project = buildDemoProject();
    project.target = { model: "HMIGTO2310", width: 320, height: 240 };
    const findings = validateProject(project);
    expect(findings.some((f) => f.rule === "standards" && f.severity === "error")).toBe(true);
  });
});

describe("tag ingestion", () => {
  const CSV = [
    "Symbol Name,Data Type,Description,PLC Address",
    "PMP_101_RUN,BOOL,Pump 1 running,%MX0.0",
    "PMP_101_FLT,Bit,Pump 1 fault,%MX0.1",
    "101_PUMP_SPD,REAL,Illegal leading digit,%MW10",
    "flow rate,Float,Has a space,%MW12",
    "REAL,INT,Collides with a reserved data type,%MW14",
    "LT_101_HI,EBOOL,Tank high level,%MX0.2",
    "flow-rate,REAL,Collides once corrected,%MW20",
    "BAD_TYPE_TAG,wibble,Unrecognised type,%MW22",
    ",,blank row,",
  ].join("\n");

  /**
   * Deliberately a Node Buffer. `buf.buffer` would be the shared pool rather
   * than the file, so this locks in that parseTags respects a view's bounds.
   */
  const parsed = () => parseTags(Buffer.from(CSV, "utf8"), "tags.csv");

  it("reads a header by intent, not by position", () => {
    const { variables } = parsed();
    expect(variables[0]).toEqual({
      Name: "PMP_101_RUN",
      DataType: "BOOL",
      Comments: "Pump 1 running",
      DeviceAddress: "%MX0.0",
    });
  });

  it("respects the bounds of a Buffer instead of reading its pool", () => {
    // 7 good rows: the unrecognised type is skipped and the blank row ignored.
    expect(parsed().variables).toHaveLength(7);
  });

  it("corrects illegal names and keeps them unique", () => {
    const names = parsed().variables.map((v) => v.Name);
    expect(names).toContain("Tag_101_PUMP_SPD");
    expect(names).toContain("flow_rate");
    expect(names).toContain("flow_rate_2");
    expect(names).toContain("REAL_1");
    expect(new Set(names).size).toBe(names.length);
  });

  it("reports every correction rather than applying it silently", () => {
    const { corrections } = parsed();
    expect(corrections.map((c) => c.from).sort()).toEqual([
      "101_PUMP_SPD",
      "REAL",
      "flow rate",
      "flow-rate",
    ]);
  });

  it("skips a row whose type it cannot map, and says why", () => {
    const { skipped } = parsed();
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toContain("wibble");
  });

  it("summarises by data type", () => {
    expect(parsed().summary).toEqual({ total: 7, BOOL: 3, REAL: 3, INT: 1 });
  });
});

describe("the sign-off report", () => {
  const render = (project = buildDemoProject(), panel = PANEL) =>
    renderReport({
      project,
      findings: validateProject(project, panel),
      panel,
      generatedAt: new Date("2026-09-10T12:00:00Z"),
    });

  const PANEL = { model: "HMIST6500AWADI", width: 1024, height: 600 };

  it("is a standalone document with no external asset", () => {
    const html = render();
    expect(html.startsWith("<!doctype html>")).toBe(true);
    // A commissioning laptop has no internet. Nothing may be fetched.
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("passes a clean project and names the panel from the file", () => {
    const html = render();
    expect(html).toContain("Passed with");
    expect(html).toContain("HMIST6500AWADI");
  });

  it("refuses to pass a project with an error, and says what it is", () => {
    const project = buildDemoProject();
    project.wires.find((w) => w.part.Type === "Lamp")!.tag = "FT_101_PV";
    const html = render(project);
    expect(html).toMatch(/1 error must be resolved/);
    expect(html).toContain("Type compatibility");
    expect(html).toContain("FT_101_PV");
  });

  it("escapes content that came out of a file we did not write", () => {
    const project = buildDemoProject();
    project.name = '<script>alert("x")</script>';
    const html = render(project);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("reports the project's own figures", () => {
    const html = render();
    expect(html).toContain("Variables declared");
    expect(html).toContain("3 bit, 2 level");
  });
});

describe("buildDemoProject", () => {
  it("hands out its own copies, so one caller cannot poison the next", () => {
    const first = buildDemoProject();
    first.alarms[3].Value = "";
    first.variables[0].Name = "MUTATED";

    const second = buildDemoProject();
    expect(second.alarms[3].Value).toBe("85");
    expect(second.variables[0].Name).toBe("PMP_101_RUN");
  });
});
