import { expect, it } from "vitest";
import committed from "@/lib/kb/generated/code.json";
import { generateCode } from "@/lib/kb/gen/code";
import { codeKb, makeKb } from "@/lib/kb";
import { PART_TYPES } from "@/lib/ote/schema";
import { PANELS } from "@/lib/backend/panels";
import { MACHINE_CLASSES } from "@/lib/library/machines";
import { COMPOSITE_KINDS } from "@/lib/composites";
import { OTE } from "@/lib/backend/ote";
import { TOOLS } from "@/lib/ai/tools";
import { readFileSync } from "node:fs";
import path from "node:path";
import { curatedEntries } from "@/lib/kb/curated";

it("keeps code.json equal to facts regenerated from repository code", () => {
  const fresh = generateCode();
  const before = new Map(committed.entries.map((entry) => [entry.id, JSON.stringify(entry)]));
  const after = new Map(fresh.entries.map((entry) => [entry.id, JSON.stringify(entry)]));
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter((id) => before.get(id) !== after.get(id));
  expect(changed, `Drift in ${changed.join(", ")}; run npm run kb:build`).toEqual([]);
  expect(committed.version).toBe(fresh.version);
});

it("indexes exactly the current part, panel, and machine class definitions", () => {
  const kb = codeKb();
  const ids = (kind: string) => committed.entries.filter((entry) => entry.kind === kind).map((entry) => entry.id).sort();
  expect(ids("partType")).toEqual(PART_TYPES.map((type) => `part:${type}`).sort());
  expect(ids("panel")).toEqual(PANELS.map((panel) => `panel:${panel.model}`).sort());
  expect(ids("machineClass")).toEqual(MACHINE_CLASSES.map((klass) => `class:${klass.id}`).sort());
  expect((kb.get("part:Lamp")?.body as { emitted: boolean }).emitted).toBe(true);
  for (const part of committed.entries.filter((entry) => entry.kind === "partType")) {
    const body = part.body as { type: string; emitted: boolean };
    expect(body.emitted, `${part.id} claims the writer emits it`).toBe(OTE.capabilities.parts.includes(body.type as typeof OTE.capabilities.parts[number]));
  }
  expect(kb.get("part:CompoundObject")).toBeUndefined();
  // Component entries wait for design B; these existing composites remain code definitions.
  expect(COMPOSITE_KINDS.length).toBeGreaterThan(0);
});

it("finds a reading and a grid for a small panel", () => {
  const hits = codeKb().search("level reading 640x480");
  expect(hits[0]?.entry.id).toBe("part:NumericDisplay");
  expect(hits.some(({ entry }) => entry.id.startsWith("pattern:"))).toBe(true);
});

it("does not admit untraceable generated text into the committed code layer", () => {
  const fresh = generateCode();
  const source = new Map(fresh.entries.map((entry) => [entry.id, JSON.stringify(entry)]));
  for (const entry of committed.entries) {
    expect(entry.layer).toBe("code");
    expect(entry.source.kind).toBe("code");
    expect(entry.source.ref).toMatch(/^web\/src\/lib\//);
    expect(JSON.stringify(entry), `${entry.id} has text outside its code-derived generator output`).toBe(source.get(entry.id));
  }
  const injected = { ...fresh.entries[0], summary: "CUSTOMER_SECRET_MARKER" };
  expect(JSON.stringify(injected)).not.toBe(source.get(injected.id));
});

it("uses emitted entries for target capabilities and the model part list", () => {
  const tool = TOOLS.find((item) => item.name === "target_capabilities")!;
  expect(tool.when).not.toContain("Rectangle, TextBox, Lamp or NumericDisplay");
  expect(readFileSync(path.join(process.cwd(), "src/lib/ai/tools.ts"), "utf8")).not.toContain("not Rectangle, TextBox, Lamp or NumericDisplay");
  const parts = codeKb().byTag("emitted").map((entry) => entry.id.slice(5));
  expect([...parts].sort()).toEqual([...PART_TYPES].sort());
  expect(makeKb([]).byTag("emitted")).toEqual([]);
});

it("links every curated checker to a real critic or lint rule, and covers each emitted id", () => {
  const files = ["src/lib/critic/geometry.ts", "src/lib/standard/lint.ts", "src/lib/validation/rules.ts"];
  const emitted = new Set(files.flatMap((file) => [...readFileSync(path.join(process.cwd(), file), "utf8").matchAll(/rule: "([^"]+)"/g)].map((match) => match[1])));
  const curated = new Set(curatedEntries.filter((entry) => entry.kind === "rule").map((entry) => (entry.body as { checker: string }).checker));
  expect([...curated].sort()).toEqual([...emitted].sort());
  for (const checker of curated) expect(codeKb().get(`rule:${checker}`)).toBeDefined();
});
