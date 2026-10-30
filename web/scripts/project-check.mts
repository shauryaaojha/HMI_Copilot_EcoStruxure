/**
 * What the app understands of a project, and what it would lose.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/project-check.mts <file.eote | folder> ...
 *
 * Run it on every project that comes in before anyone builds on it. It says
 * what is modelled and what is carried as it is, then writes the project back
 * edited in place and moved to another project and counts, by object type and
 * field path, every field the output lost (lib/ote/fidelity.ts). The exit code
 * is non-zero when anything is lost or a file cannot be read. Last, it lists
 * the project's own objects a screen we add would be drawn with
 * (lib/ote/exemplars.ts).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fidelity, total } from "../src/lib/ote/fidelity.js";
import { harvest } from "../src/lib/ote/exemplars.js";

async function files(args: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const a of args) {
    if ((await fs.stat(a)).isDirectory()) {
      for (const f of await fs.readdir(a)) if (f.toLowerCase().endsWith(".eote")) out.push(path.join(a, f));
    } else out.push(a);
  }
  return out;
}

const report = (title: string, lost: Record<string, number>) => {
  const rows = Object.entries(lost).sort((x, y) => y[1] - x[1]);
  console.log(`    ${title}: ${rows.length ? `${total(lost)} fields lost` : "nothing lost"}`);
  for (const [k, n] of rows.slice(0, 12)) console.log(`      ${String(n).padStart(5)}  ${k}`);
  if (rows.length > 12) console.log(`      ... ${rows.length - 12} more paths`);
};

let failed = false;
const seen = new Set<string>();
for (const file of await files(process.argv.slice(2))) {
  const bytes = new Uint8Array(await fs.readFile(file));
  const key = `${bytes.length}:${Buffer.from(bytes.slice(-64)).toString("hex")}`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(path.basename(file));
  try {
    const f = await fidelity(bytes, path.basename(file));
    const carried = Object.entries(f.carried).sort((a, b) => b[1] - a[1]);
    console.log(
      `    ${f.read.screens.length} screens, ${f.modelled} objects modelled, ${total(f.carried)} carried as they are` +
        (carried.length ? ` (${carried.slice(0, 8).map(([t, n]) => `${t} ${n}`).join(", ")})` : ""),
    );
    if (f.read.warnings.length) console.log(`    warnings: ${f.read.warnings.join(" | ")}`);
    report("edited in place", f.inPlace);
    if (f.movedError) console.log(`    moved: not written: ${f.movedError}`);
    else report("moved to another project", f.moved);
    const own = Object.values(harvest(f.read.preserved, f.read.variables));
    console.log(`    its own objects: ${own.length ? "" : "none bound to a recognised tag; ours are used"}`);
    for (const e of own) console.log(`      ${e!.kind.padEnd(10)} ${e!.raw.Type} (${e!.raw.Name}, ${e!.uses}x), bound ${e!.property} mode ${e!.mode}`);
    if (total(f.inPlace) || total(f.moved)) failed = true;
  } catch (e) {
    console.log(`    not read: ${(e as Error).message}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
