/**
 * Convert older-layout (3.1 - 3.3) projects, export each as a new 4.4 .eote
 * through the skeleton, and read the export back: what an engineer gets from
 * opening one and pressing Export. Writes the .eote files to %TEMP%/claude.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/convert.mts <dir|file.vxdz>...
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { readStructProject } from "../src/lib/ote/struct";
import { readProject } from "../src/lib/ote/reader";
import { packageProject } from "../src/lib/ote/packager";
const files: string[] = [];
const walk = (p: string) => {
  if (statSync(p).isDirectory()) for (const e of readdirSync(p)) walk(join(p, e));
  else if (/\.vxdz$/i.test(p)) files.push(p);
};
process.argv.slice(2).forEach(walk);
const { layoutOf } = await import("../src/lib/ote/reader");
let ok = 0;
let total = 0;
for (const file of files) {
  if ((await layoutOf(new Uint8Array(readFileSync(file)))) !== "struct") continue;
  total++;
  const read = await readStructProject(new Uint8Array(readFileSync(file)), basename(file));
  let out: Uint8Array;
  try {
    out = await packageProject({ name: read.name, target: read.target, screens: read.screens, variables: read.variables, alarms: read.alarms, wires: read.wires } as Parameters<typeof packageProject>[0]);
  } catch (e) {
    console.log(basename(file), "PACKAGE FAIL", e instanceof Error ? e.stack?.split("\n").slice(0, 8).join("\n") : e);
    continue;
  }
  try {
    const back = await readProject(out, read.name + ".eote");
    console.log(basename(file), "->", out.length, "bytes;", read.screens.length, "screens in,", back.screens.length, "back;", back.variables.length, "vars;", back.wires.length, "wires; carried", back.carried.screens);
    writeFileSync(`${process.env.TEMP}/claude/${read.name}.eote`, out);
    ok++;
  } catch (e) {
    console.log(basename(file), "REREAD FAIL", e instanceof Error ? e.stack?.split("\n").slice(0, 8).join("\n") : e);
  }
}
console.log(`
${ok}/${total} converted, exported and read back`);
