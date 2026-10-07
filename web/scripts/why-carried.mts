/**
 * Why each carried object was not modelled: its type and the first schema
 * complaint, counted across the files given.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/why-carried.mts <dir|file>...
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { readProject } from "../src/lib/ote/reader";
import { Part } from "../src/lib/ote/schema";
import { flatten } from "../src/lib/ote/containers";

const files: string[] = [];
const walk = (p: string) => {
  if (statSync(p).isDirectory()) for (const e of readdirSync(p)) walk(join(p, e));
  else if (/\.(vxdz|eote)$/i.test(p) && !/_backup_\d+\.eote$/i.test(p)) files.push(p);
};
process.argv.slice(2).forEach(walk);

const why = new Map<string, number>();
for (const file of files) {
  let read;
  try {
    read = await readProject(new Uint8Array(readFileSync(file)), basename(file));
  } catch {
    continue;
  }
  for (const kept of read.preserved.screens.values()) {
    for (const { raw, index } of kept.opaque) {
      const leaf = kept.tree?.laid.leaves[index];
      const candidate = leaf ? flatten(leaf) : raw;
      const r = Part.safeParse(candidate);
      const type = String((raw as { Type?: string }).Type);
      let reason = "duplicate id";
      if (!r.success) {
        // A union's own message is "invalid input"; the member issue for the
        // matching Type is the useful one.
        const issues = r.error.issues.flatMap((i) =>
          "unionErrors" in i ? (i as unknown as { unionErrors: { issues: { path: (string | number)[]; message: string }[] }[] }).unionErrors.flatMap((u) => u.issues) : [i],
        );
        const real = issues.filter((i) => !(i.path.join(".") === "Type"));
        const first = real[0] ?? issues[0];
        reason = first ? `${first.path.join(".")}: ${first.message}` : "?";
        if (real.length === 0) reason = "type not modelled";
      }
      const key = `${type} | ${reason}`;
      why.set(key, (why.get(key) ?? 0) + 1);
    }
  }
}
for (const [k, v] of [...why].sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(5), k);
