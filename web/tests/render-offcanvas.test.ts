/**
 * S3-10 (docs/audit/BUGS.md): a part drawn far outside the canvas made resvg
 * panic (geom.rs: "called Option::unwrap() on a None value"), which aborts the
 * whole Node process. One anonymous POST /api/critique with a short screen was
 * enough, and MCP render_screen and the agent's view_screen use the same code.
 * Moved from web/scripts/audit/s3-model-routes-open.test.ts with the fix.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { demoScreen } from "@/fixtures";
import { screenToSvg } from "@/lib/critic/render";

const web = path.resolve(import.meta.dirname, "..");
const probe = (...args: string[]) => {
  const r = spawnSync(process.execPath, [path.join(web, "node_modules/tsx/dist/cli.mjs"), "--tsconfig", "scripts/tsconfig.json", "tests/helpers/render-probe.mts", ...args], {
    cwd: web, encoding: "utf8", env: { ...process.env, MONGODB_URI: "" }, timeout: 120_000,
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

describe("the server renderer and parts off the canvas", () => {
  for (const [label, args] of [["a 1024x2 screen", ["2"]], ["an alarm summary far below the canvas", ["600", "5000"]]] as const) {
    it(`survives ${label}`, () => {
      const r = probe(...args);
      expect(r.status, /panicked at [^\n]*/.exec(r.out)?.[0] ?? r.out.slice(0, 300)).toBe(0);
      expect(r.out).toMatch(/png \d+/);
    }, 150_000);
  }

  it("still draws every part that is on the canvas", async () => {
    const svg = await screenToSvg(structuredClone(demoScreen));
    const drawn = svg.match(/data-object-type="/g)?.length ?? 0;
    expect(drawn).toBe((demoScreen.Children[0] as unknown as { Children: unknown[] }).Children.length);
  });
});
