/**
 * Every project opened (or converted) and put through the export route's own
 * checks: preflight, package, and the read-back self-check. A project that
 * opens but cannot be exported is a dead end for the engineer.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/preflight-corpus.mts <dir|file>...
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { layoutOf, readProject } from "../src/lib/ote/reader";
import { readStructProject } from "../src/lib/ote/struct";
import { packageProject, type PackageInput } from "../src/lib/ote/packager";
import { preflight, selfCheck } from "../src/lib/ote/preflight";

const files: string[] = [];
const walk = (p: string) => {
  if (statSync(p).isDirectory()) for (const e of readdirSync(p)) walk(join(p, e));
  else if (/\.(vxdz|eote)$/i.test(p) && !/_backup_\d+\.eote$/i.test(p)) files.push(p);
};
process.argv.slice(2).forEach(walk);

const reasons = new Map<string, number>();
let ok = 0;
for (const file of files) {
  const bytes = new Uint8Array(readFileSync(file));
  const struct = (await layoutOf(bytes)) === "struct";
  const read = struct ? await readStructProject(bytes, basename(file)) : await readProject(bytes, basename(file));
  const input = { name: read.name, target: read.target, screens: read.screens, variables: read.variables, alarms: read.alarms, wires: read.wires } as PackageInput;
  const problems = preflight(input);
  if (problems.length > 0) {
    for (const p of problems) {
      const key = JSON.stringify(p).replace(/"[^"]*":/g, "").slice(0, 110);
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    }
    console.log(`${basename(file).padEnd(44)} PREFLIGHT ${problems.length}: ${JSON.stringify(problems[0]).slice(0, 160)}`);
    continue;
  }
  try {
    const out = await packageProject(input, undefined, "preserved" in read ? read.preserved : undefined);
    await selfCheck(out, input);
    ok++;
  } catch (e) {
    console.log(`${basename(file).padEnd(44)} EXPORT ${e instanceof Error ? e.message.slice(0, 160) : e}`);
  }
}
console.log(`\n${ok}/${files.length} pass preflight, package and the self-check`);
for (const [k, v] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(String(v).padStart(5), k);
