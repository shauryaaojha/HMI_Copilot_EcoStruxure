import { readFileSync } from "node:fs";
import { basename } from "node:path";
import JSZip from "jszip";
import { openDatabase } from "../../src/lib/ote/packager";
import { readProject } from "../../src/lib/ote/reader";
for (const f of process.argv.slice(2)) {
  const bytes = new Uint8Array(readFileSync(f));
  const zip = await JSZip.loadAsync(bytes);
  const db = await openDatabase(await zip.files[Object.keys(zip.files).find((n) => /^Variables\.db$/i.test(n))!].async("uint8array"));
  const iv = db.exec(`SELECT "DataType", "InitialValue" FROM Variables`)[0]?.values ?? [];
  const DEF: Record<string, string> = { BOOL: "False", STRING: "" };
  const nonDefault = iv.filter(([t, v]) => v !== null && String(v) !== "0" && String(v) !== (DEF[String(t)] ?? "0") && String(v) !== "false" && String(v) !== "False").length;
  const dupNames = db.exec(`SELECT COUNT(*) FROM (SELECT "Name" FROM Variables GROUP BY "Name" HAVING COUNT(*) > 1)`)[0].values[0][0];
  const read = await readProject(bytes, basename(f));
  // Shared targets: a part target used by a modelled wire and by a carried row.
  const g = JSON.parse((await zip.files[Object.keys(zip.files).find((n) => /^Bindings\.dat$/i.test(n))!].async("string")).replace(/^﻿/, ""));
  const modelledTargets = new Set(read.wires.map((w) => w.part.UniqueId.toLowerCase()));
  const shared = read.preserved.extra.bindings.filter((b) => { const t = g.Targets.find((x: any) => x.ReferenceId === b.Target); return t && t.ObjectType === 8 && modelledTargets.has(String(t.ObjectId).toLowerCase()); }).length;
  const extraMissingTarget = read.preserved.extra.bindings.filter((b) => !read.preserved.extra.targets.some((t) => t.ReferenceId === b.Target)).length;
  // Duplicate part names across screens (counts only).
  const names = new Map<string, number>();
  for (const s of read.screens) for (const p of s.Children[0].Children) names.set(p.Name, (names.get(p.Name) ?? 0) + 1);
  const dupParts = [...names.values()].filter((n) => n > 1).length;
  console.log(basename(f), JSON.stringify({ variables: iv.length, nonDefaultInitialValue: nonDefault, duplicateVariableNames: dupNames, extraBindings: read.preserved.extra.bindings.length, extraRowsWhoseTargetIsNotInExtra: extraMissingTarget, sharedWithModelledWire: shared, partNamesUsedTwiceOrMore: dupParts }));
}
