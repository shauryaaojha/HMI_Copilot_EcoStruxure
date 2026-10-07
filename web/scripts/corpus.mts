/**
 * Open every project under the given paths the way /api/import does, and say
 * what came out of each one.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/corpus.mts <dir|file>... [--json out.json]
 *
 * "Opens" is not the bar. A file whose screens are all carried opens and shows
 * an empty editor, which is what an engineer reads as "nothing loaded". So
 * each file is scored on how much of it reached the editor: screens modelled
 * out of screens found, and objects modelled out of objects found.
 *
 * Read-only. The corpus is Schneider's and never enters this repository.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { layoutOf, readProject } from "../src/lib/ote/reader";
import { readStructProject } from "../src/lib/ote/struct";

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : undefined;
const inputs = args.filter((a, i) => a !== "--json" && (jsonAt < 0 || i !== jsonAt + 1));

const files: string[] = [];
const walk = (p: string) => {
  if (statSync(p).isDirectory()) for (const e of readdirSync(p)) walk(join(p, e));
  else if (/\.(vxdz|eote)$/i.test(p) && !/_backup_\d+\.eote$/i.test(p)) files.push(p);
};
inputs.forEach(walk);

interface Row {
  file: string;
  layout: string;
  ok: boolean;
  error?: string;
  screens: number;
  modelled: number;
  objects: number;
  foreign: number;
  variables: number;
  alarms: number;
  roots: Record<string, number>;
  warnings: string[];
}

const rows: Row[] = [];
for (const file of files) {
  const bytes = new Uint8Array(readFileSync(file));
  const row: Row = {
    file, layout: "?", ok: false, screens: 0, modelled: 0, objects: 0, foreign: 0,
    variables: 0, alarms: 0, roots: {}, warnings: [],
  };
  try {
    row.layout = await layoutOf(bytes);
    // The same dispatch as /api/import: the older layout is converted.
    const read = row.layout === "struct" ? await readStructProject(bytes, basename(file)) : await readProject(bytes, basename(file));
    row.ok = true;
    row.modelled = read.screens.length;
    row.screens = read.screens.length + (read.carried.screens ?? 0);
    const count = (objs: { Children?: unknown[] }[]): number =>
      objs.reduce((n, o) => n + 1 + count((o.Children ?? []) as { Children?: unknown[] }[]), 0);
    row.objects = read.screens.reduce((n, s) => n + count(s.Children as { Children?: unknown[] }[]) - 1, 0);
    row.foreign = Object.values(read.foreign ?? {}).reduce((n, list) => n + (list as unknown[]).length, 0);
    row.variables = read.variables.length;
    row.alarms = read.alarms.length;
    row.roots = read.carried.roots ?? {};
    row.warnings = read.warnings;
  } catch (error) {
    row.error = error instanceof Error ? error.message : String(error);
  }
  rows.push(row);
}

const pad = (s: string | number, n: number) => String(s).padEnd(n);
for (const r of rows) {
  const name = basename(r.file).slice(0, 44);
  const what = r.ok
    ? `${r.modelled}/${r.screens} screens  ${r.objects} obj  ${r.foreign} carried-obj  ${r.variables} vars  ${r.alarms} alarms` +
      (Object.keys(r.roots).length ? `  carried roots ${JSON.stringify(r.roots)}` : "")
    : `FAIL ${r.error?.slice(0, 120)}`;
  console.log(`${pad(name, 46)}${pad(r.layout, 8)}${what}`);
}

const opened = rows.filter((r) => r.ok);
const full = opened.filter((r) => r.screens > 0 && r.modelled === r.screens);
const screens = opened.reduce((n, r) => n + r.screens, 0);
const modelled = opened.reduce((n, r) => n + r.modelled, 0);
const roots: Record<string, number> = {};
for (const r of opened) for (const [k, v] of Object.entries(r.roots)) roots[k] = (roots[k] ?? 0) + v;
const errors: Record<string, number> = {};
for (const r of rows) if (r.error) errors[r.error.slice(0, 60)] = (errors[r.error.slice(0, 60)] ?? 0) + 1;

console.log(`\n${rows.length} files: ${opened.length} open, ${full.length} with every screen modelled`);
console.log(`screens: ${modelled}/${screens} modelled`);
console.log(`carried screen roots: ${JSON.stringify(roots)}`);
console.log(`failures: ${JSON.stringify(errors, null, 1)}`);

if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows, null, 2));
