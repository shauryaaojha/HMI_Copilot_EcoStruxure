/**
 * Read each project and write it straight back with no edit; list every entry
 * whose bytes moved. An untouched project must come back entry-identical.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/roundtrip.mts <dir|file>...
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import JSZip from "jszip";
import { readProject } from "../src/lib/ote/reader";
import { packageProject } from "../src/lib/ote/packager";

const files: string[] = [];
const walk = (p: string) => {
  if (statSync(p).isDirectory()) for (const e of readdirSync(p)) walk(join(p, e));
  else if (/\.(vxdz|eote)$/i.test(p) && !/_backup_\d+\.eote$/i.test(p)) files.push(p);
};
process.argv.slice(2).forEach(walk);

let clean = 0;
for (const file of files) {
  const bytes = new Uint8Array(readFileSync(file));
  let read;
  try {
    read = await readProject(bytes, basename(file));
  } catch {
    continue;
  }
  const out = await packageProject(
    {
      name: read.name,
      target: read.target,
      screens: read.screens,
      variables: read.variables,
      alarms: read.alarms,
      wires: read.wires,
    } as Parameters<typeof packageProject>[0],
    undefined,
    read.preserved,
  );
  const a = await JSZip.loadAsync(bytes);
  const b = await JSZip.loadAsync(out);
  const moved: string[] = [];
  for (const n of Object.keys(a.files).filter((n) => !a.files[n].dir)) {
    const x = await a.files[n].async("uint8array");
    const y = await b.files[n]?.async("uint8array");
    if (!y || !Buffer.from(x).equals(Buffer.from(y))) moved.push(n);
  }
  if (moved.length === 0) clean++;
  console.log(`${basename(file).padEnd(44)} ${moved.length === 0 ? "identical" : "MOVED " + moved.join(", ")}`);
}
console.log(`\n${clean}/${files.length} identical`);
