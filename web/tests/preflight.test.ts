/**
 * The export's checks: every defect at once before writing, and the written
 * file read back before it is handed over. The valid case is a real project -
 * our PumpStation .eote, which opens in OTE 4.4 - read and re-exported, so the
 * checks are proven not to refuse a file the product accepts.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readProject } from "@/lib/ote/reader";
import { packageProject, type PackageInput } from "@/lib/ote/packager";
import { preflight, selfCheck } from "@/lib/ote/preflight";

const FILE = path.join(__dirname, "..", "..", "demo_project", "HMICopilot_PumpStation.eote");

async function real(): Promise<{ input: PackageInput; read: Awaited<ReturnType<typeof readProject>> }> {
  const read = await readProject(new Uint8Array(fs.readFileSync(FILE)), "HMICopilot_PumpStation.eote");
  return { read, input: { name: read.name, target: read.target, screens: read.screens, variables: read.variables, alarms: read.alarms, wires: read.wires } };
}

describe("preflight", () => {
  it("passes a real project", async () => {
    expect(preflight((await real()).input)).toEqual([]);
  });

  it("reports every defect at once, each naming where", async () => {
    const { input } = await real();
    const broken: PackageInput = structuredClone(input);
    broken.variables.push({ ...broken.variables[0] });
    broken.alarms[0] = { ...broken.alarms[0], Trigger: "NO_SUCH_TAG" };
    broken.wires[0] = { ...broken.wires[0], tag: "GHOST_TAG" };
    (broken.screens[0] as unknown as { Children: unknown[] }).Children = [];
    const problems = preflight(broken);
    const text = problems.map((p) => `${p.where}: ${p.problem}`).join("\n");
    expect(text).toMatch(/is declared twice/);
    expect(text).toMatch(/NO_SUCH_TAG, which is not a declared variable/);
    expect(text).toMatch(/reads GHOST_TAG/);
    expect(text).toMatch(/^screen /m);
  });

  it("treats names as case-sensitive, as OTE does", async () => {
    const { input } = await real();
    const v = input.variables[0];
    expect(preflight({ ...input, variables: [...input.variables, { ...v, Name: v.Name.toLowerCase() }] })).toEqual([]);
  });

  it("refuses something that is not a project", () => {
    expect(preflight(null as unknown as PackageInput)).toEqual([{ where: "project", problem: "not a project object" }]);
  });
});

describe("the read-back check", () => {
  it("accepts what the packager wrote", async () => {
    const { input, read } = await real();
    await expect(selfCheck(await packageProject(input, undefined, read.preserved), input)).resolves.toBeUndefined();
  });

  it("refuses a file missing a variable the export asked for", async () => {
    const { input, read } = await real();
    const bytes = await packageProject(input, undefined, read.preserved);
    const claimed = { ...input, variables: [...input.variables, { Name: "NEVER_WRITTEN", DataType: "BOOL" as const, Comments: "", DeviceAddress: "" }] };
    await expect(selfCheck(bytes, claimed)).rejects.toThrow(/missing 1 variable, e\.g\. NEVER_WRITTEN/);
  });
});
