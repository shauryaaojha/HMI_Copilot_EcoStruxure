/**
 * Open each project, move the first object on every screen 5px right and 5px
 * down and widen it by 10, export, open the export, and check three things:
 * the moved object is exactly where it was put, every other object is exactly
 * where it was, and nothing was lost. This is the edit an engineer makes most,
 * against the layouts the product writes (grids, nested grids, stacks, groups).
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/edit-roundtrip.mts <dir|file>...
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { layoutOf, readProject } from "../src/lib/ote/reader";
import { packageProject } from "../src/lib/ote/packager";
import type { Part } from "../src/lib/ote/schema";

const files: string[] = [];
const walk = (p: string) => {
  if (statSync(p).isDirectory()) for (const e of readdirSync(p)) walk(join(p, e));
  else if (/\.(vxdz|eote)$/i.test(p) && !/_backup_\d+\.eote$/i.test(p)) files.push(p);
};
process.argv.slice(2).forEach(walk);

const boxOf = (p: Part) => [p.Location.Left, p.Location.Top, p.Width ?? 0, p.Height ?? 0];
// Within a pixel: a cell's edges can be fractional and the product stores a
// margin as an integer, so sub-pixel is the most any writer can promise.
const same = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1);
const show = (b: number[]) => b.map((v) => Math.round(v * 10) / 10).join(",");
let clean = 0;
let total = 0;
for (const file of files) {
  const bytes = new Uint8Array(readFileSync(file));
  if ((await layoutOf(bytes)) !== "typed") continue;
  total++;
  const read = await readProject(bytes, basename(file));
  const expected = new Map<string, number[]>();
  for (const screen of read.screens) {
    // A ContentDisplay is not moved: its content is laid out at its size, so
    // widening one moves the content's parts too, which is correct and not
    // what this measures.
    const target = screen.Children[0].Children.find((p) => p.Type !== "ContentDisplay" && (p.Width ?? 0) > 0);
    screen.Children[0].Children.forEach((part) => {
      if (part === target) {
        part.Location = { Left: Math.round(part.Location.Left) + 5, Top: Math.round(part.Location.Top) + 5 };
        part.Width = Math.round(part.Width ?? 0) + 10;
        part.Height = Math.round(part.Height ?? 0);
      }
      expected.set(part.UniqueId, boxOf(part));
    });
  }
  const out = await packageProject(
    { name: read.name, target: read.target, screens: read.screens, variables: read.variables, alarms: read.alarms, wires: read.wires } as Parameters<typeof packageProject>[0],
    undefined,
    read.preserved,
  );
  const back = await readProject(out, basename(file));
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const screen of back.screens) {
    for (const part of screen.Children[0].Children) {
      seen.add(part.UniqueId);
      const want = expected.get(part.UniqueId);
      if (!want) problems.push(`new ${part.Name}`);
      else if (!same(want, boxOf(part))) problems.push(`${screen.Name}/${part.Name} ${show(want)} -> ${show(boxOf(part))}`);
    }
  }
  for (const id of expected.keys()) if (!seen.has(id)) problems.push(`lost ${id}`);
  if (problems.length === 0) clean++;
  console.log(`${basename(file).padEnd(40)} ${problems.length === 0 ? "ok" : problems.length + " problems: " + problems.slice(0, 4).join("; ")}`);
}
console.log(`\n${clean}/${total} keep every object where the editor put it`);
