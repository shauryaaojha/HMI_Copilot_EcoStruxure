/**
 * A small project that uses the product's own clipart library: one screen
 * with a pump, a tank and a valve picture from `04-Cliparts`, each labelled.
 * Written to prove, in the licensed editor, that a picture we place opens and
 * simulates (scripts/ote-bench.ps1).
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/clipart-sample.mts <out.eote>
 */
import { writeFileSync } from "node:fs";
import { cliparts, clipartFor } from "../src/lib/ote/cliparts";
import { packageProject, panelOf } from "../src/lib/ote/packager";
import { rectangle, screenOf, textBox } from "../src/lib/ote/parts";
import { loadSkeleton } from "../src/lib/ote/skeleton";
import type { Part } from "../src/lib/ote/schema";

const out = process.argv[2] ?? `${process.env.TEMP}/claude/clipart-sample.eote`;
const skeleton = await loadSkeleton();
const panel = (await panelOf(skeleton)) ?? { model: "HMIST6500AWADI", width: 1024, height: 600 };
const { list } = await cliparts();
if (list.length === 0) throw new Error("no clipart library on this machine");

const parts: Part[] = [rectangle("Ground", { left: 0, top: 0, width: panel.width, height: panel.height }, { fill: 11, border: 11 })];
["centrifugal pump", "tank", "valve"].forEach((hint, i) => {
  const c = clipartFor(list, hint)!;
  const size = 160;
  const scale = Math.min(size / c.width, size / c.height);
  const box = { left: 80 + i * 300, top: 160, width: Math.round(c.width * scale), height: Math.round(c.height * scale) };
  parts.push({
    Type: "ClipArt",
    UniqueId: crypto.randomUUID(),
    Name: `Clip_${c.name.replace(/[^A-Za-z0-9_]/g, "_")}`,
    ImagePath: { Value: c.sha1, DisplayValue: c.path },
    Location: { Left: box.left, Top: box.top },
    Width: box.width,
    Height: box.height,
  } as Part);
  parts.push(textBox(`Lbl_${i}`, `${c.group} / ${c.name}`, { left: box.left, top: 340, width: 260, height: 28 }, { size: 14 }));
});
const screen = screenOf("Cliparts", parts, panel);
writeFileSync(out, await packageProject({ name: "ClipartSample", target: panel, screens: [screen], variables: [], alarms: [], wires: [] }, skeleton));
console.log(out);
