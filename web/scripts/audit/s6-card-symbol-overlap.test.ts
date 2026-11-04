/**
 * Audit 2026-11, stream S6. S6-04: on a level 2 card whose unit has no run or fault
 * lamp, the equipment symbol (top right, y+8 to y+60) overlaps the first analogue
 * indicator, which starts at y+40 and spans the card (lib/ote/layout.ts drawCard).
 * The project's own geometric critic reports it. FAILS on the code it was written against.
 *
 *   cd web && MONGODB_URI= npx vitest run --config scripts/audit/vitest.config.mts scripts/audit/s6-card-symbol-overlap.test.ts
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFromTags } from "@/lib/agent/build";
import { parseTags } from "@/lib/tags/parse";
import { libraryAvailable } from "@/lib/ote/symbols";
import { critiqueGeometry } from "@/lib/critic/geometry";

// The deterministic plan: no model call, no quota.
delete process.env.GEMINI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const CSV = path.join(__dirname, "..", "..", "..", "samples", "tank-farm", "tags.csv");

describe("S6-04 a level 2 card", () => {
  it.skipIf(!fs.existsSync(CSV))("keeps its symbol clear of its first indicator", async () => {
    // Symbols come from the gitignored graphics index; without it there is no symbol to collide.
    if (!(await libraryAvailable())) return;
    const { variables } = parseTags(fs.readFileSync(CSV), "tags.csv");
    const built = await buildFromTags({ name: "tank-farm", intent: "tank farm overview", variables, panel: { model: "HMIST6500AWADI", width: 1024, height: 600 } });
    const overlaps = built.input.screens.flatMap((s) => critiqueGeometry(s).findings.filter((f) => f.rule === "geom.overlap" && /Sym_/.test(f.message)));
    expect(overlaps.length, `${overlaps.length} symbol/indicator overlaps, e.g. "${overlaps[0]?.message.replace(/[A-Z]{2,}_?\d+/g, "X")}"`).toBe(0);
  });
});
