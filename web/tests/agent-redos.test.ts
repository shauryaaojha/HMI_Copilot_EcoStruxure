/**
 * S3-07 (docs/audit/BUGS.md), moved from web/scripts/audit/ with the fix.
 * S3-07: the agent's regex tools run a model-supplied pattern with no time limit.
 *
 * lib/agent/tools.ts `pattern()` compiles whatever the model sends (`new RegExp(s, "i")`),
 * and `search`, `find_objects`, `bindings` and `tags` run it synchronously over every line.
 * A catastrophic pattern such as (a+)+$ hangs the event loop of the function serving the
 * run: nothing else on that instance answers until it finishes, and the run's AbortSignal
 * cannot interrupt synchronous code. The pattern can come from the model or from text the
 * model read in the project.
 */
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { Workspace } from "@/lib/agent/workspace";
import { backtracks, contextFor, runAgentTool } from "@/lib/agent/tools";

describe("S3-07 search is bounded in time", () => {
  it("search with (a+)+$ over one 27-character line returns within 1 s", async () => {
    const zip = new JSZip();
    zip.file("Project.dat", JSON.stringify({ Name: "P" }));
    zip.file("notes.txt", `${"a".repeat(26)}!`);
    const ws = await Workspace.open(await zip.generateAsync({ type: "uint8array" }));
    const t = performance.now();
    await runAgentTool(contextFor(ws), "search", { pattern: "(a+)+$", glob: "notes.txt" });
    const ms = Math.round(performance.now() - t);
    expect(ms, `one search call blocked the event loop for ${ms} ms on a 27-character line (each extra 'a' doubles it)`).toBeLessThan(1000);
  }, 120_000);
});

it("only patterns that can backtrack exponentially are matched as text", () => {
  for (const risky of ["(a+)+$", "(a*)*", "(a|aa)+", "((ab)+)*", "(x+){2,}"]) expect(backtracks(risky), risky).toBe(true);
  for (const safe of ["Pump.*Run", "(Pump|Valve)", "(\\d+)-(\\d+)", "[(+*]+", "a+b*", "(a+)?", "\\(a+\\)+"]) expect(backtracks(safe), safe).toBe(false);
});
