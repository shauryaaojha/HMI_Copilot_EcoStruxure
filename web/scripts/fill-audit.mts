/**
 * Does a part's Fill survive a write? For each project, compare every object's
 * Fill in the original Screen.dat entries against the Fill in the written file,
 * on both write paths: the opened file (packagePreserved) and a fresh build from
 * the parsed screens (packageProject with no preserved state, the import path).
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/fill-audit.mts <dir|file>...
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

/** Every object in every Screen.dat, keyed by UniqueId, with its Fill (or the marker "absent"). */
async function fills(bytes: Uint8Array): Promise<Map<string, string>> {
  const zip = await JSZip.loadAsync(bytes);
  const out = new Map<string, string>();
  for (const name of Object.keys(zip.files)) {
    if (!/Screen\.dat$/i.test(name.replace(/\\/g, "/"))) continue;
    const json = JSON.parse(await zip.files[name].async("string"));
    const visit = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node || typeof node !== "object") return;
      const o = node as Record<string, unknown>;
      if (typeof o.UniqueId === "string" && o.Type !== "Canvas" && o.Type !== "ViewBox") {
        out.set(o.UniqueId, `${String(o.Type)}|${o.Fill === undefined ? "absent" : JSON.stringify(o.Fill)}`);
      }
      for (const v of Object.values(o)) if (v && typeof v === "object") visit(v);
    };
    visit(json);
  }
  return out;
}

/** Key order is not a change: compare the parsed values. */
const same = (a: string, b: string) => {
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
        : v;
  try {
    return JSON.stringify(canon(JSON.parse(a))) === JSON.stringify(canon(JSON.parse(b)));
  } catch {
    return a === b;
  }
};

let totalLost = 0;
for (const file of files) {
  const bytes = new Uint8Array(readFileSync(file));
  let read;
  try {
    read = await readProject(bytes, basename(file));
  } catch {
    continue;
  }
  const original = await fills(bytes);
  const input = {
    name: read.name,
    target: read.target,
    screens: read.screens,
    variables: read.variables,
    alarms: read.alarms,
    wires: read.wires,
  } as Parameters<typeof packageProject>[0];
  if (read.screens.length === 0) {
    console.log(`${basename(file)}: no screens, skipped`);
    continue;
  }
  const paths: [string, () => Promise<Uint8Array>][] = [
    ["opened", () => packageProject(input, undefined, read.preserved)],
    ["fresh", () => packageProject(input)],
  ];
  for (const [label, write] of paths) {
    let out: Uint8Array;
    try {
      out = await write();
    } catch (error) {
      console.log(`${basename(file)} [${label}]: write failed: ${(error as Error).message}`);
      continue;
    }
    const written = await fills(out);
    const lost: string[] = [];
    for (const [id, before] of original) {
      const after = written.get(id);
      if (after === undefined) continue; // object not written on this path
      const type = before.slice(0, before.indexOf("|"));
      const was = before.slice(before.indexOf("|") + 1);
      const now = after.slice(after.indexOf("|") + 1);
      if (was === "absent" || same(was, now)) continue;
      lost.push(`${type}: ${was} -> ${now}`);
    }
    totalLost += lost.length;
    console.log(`${basename(file)} [${label}]: ${original.size} objects, ${lost.length} Fill changed`);
    for (const line of [...new Set(lost)].slice(0, 6)) console.log(`    ${line}`);
  }
}
console.log(`total Fill changes: ${totalLost}`);
