/**
 * Why each carried object was not modelled: its type and the first schema
 * complaint, counted across the files given.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/why-carried.mts <dir|file>...
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { layoutOf, modelScreen, readProject } from "../src/lib/ote/reader";
import { readStructProject } from "../src/lib/ote/struct";
import { Part, withOrigin } from "../src/lib/ote/schema";
import { flatten } from "../src/lib/ote/containers";

const files: string[] = [];
const why = new Map<string, number>();
const walk = (p: string) => {
  if (statSync(p).isDirectory()) for (const e of readdirSync(p)) walk(join(p, e));
  else if (/\.(vxdz|eote)$/i.test(p) && !/_backup_\d+\.eote$/i.test(p)) files.push(p);
};
process.argv.slice(2).forEach(walk);

for (const file of files) {
  const bytes = new Uint8Array(readFileSync(file));
  if ((await layoutOf(bytes)) === "struct") {
    // No preserved tree for a converted file: count the carried summaries.
    try {
      const read = await readStructProject(bytes, basename(file));
      for (const raw of read.converted) {
        const m = modelScreen(raw, read.target);
        for (const { raw: o, index } of m.opaque) count(o, m.tree?.laid.leaves[index], "struct ");
      }
    } catch (error) {
      const key = `FILE | ${error instanceof Error ? error.message.slice(0, 60) : error}`;
      why.set(key, (why.get(key) ?? 0) + 1);
    }
    continue;
  }
  let read;
  try {
    read = await readProject(bytes, basename(file));
  } catch {
    continue;
  }
  for (const kept of read.preserved.screens.values()) {
    for (const { raw, index } of kept.opaque) count(raw, kept.tree?.laid.leaves[index], "");
  }
}

function count(raw: unknown, leaf: Parameters<typeof flatten>[0] | undefined, tag: string) {
    {
      const candidate = leaf ? flatten(leaf) : withOrigin(raw);
      const type = String((raw as { Type?: string }).Type);
      // The member schema for this Type, so the complaint is about this part
      // rather than whichever union member zod tried first.
      const member = Part.optionsMap.get(type as never);
      let reason = "duplicate id";
      if (!member) reason = "type not modelled";
      else {
        const r = member.safeParse(candidate);
        if (!r.success) {
          const first = r.error.issues[0];
          reason = `${first.path.join(".")}: ${first.message}`;
        }
      }
      const key = `${tag}${type} | ${reason}`;
      why.set(key, (why.get(key) ?? 0) + 1);
    }
}
for (const [k, v] of [...why].sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(5), k);
