/**
 * Draw a sample plant's generated screens to PNG, with no model and no network.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/render-sample.mts [sample-slug] [out-dir]
 *
 * The pipeline's keyless path, so the pictures are the same on every machine.
 * For looking at what a catalogue change does to a real screen.
 */

import fs from "node:fs";
import path from "node:path";
import { buildFromTags } from "../src/lib/agent/build.js";
import { parseTags } from "../src/lib/tags/parse.js";
import { screenToPng } from "../src/lib/critic/render.js";

const slug = process.argv[2] ?? "transfer-pump-station";
const out = process.argv[3] ?? path.join(process.cwd(), "..", "demo_project", "renders");
const { variables } = parseTags(fs.readFileSync(path.join(process.cwd(), "..", "samples", slug, "tags.csv")), "tags.csv");
const built = await buildFromTags({ name: slug, intent: slug.replace(/-/g, " "), variables, panel: { model: "HMIST6500", width: 1024, height: 600 } });

fs.mkdirSync(out, { recursive: true });
for (const screen of built.input.screens) {
  fs.writeFileSync(path.join(out, `${slug}-${screen.Name}.png`), await screenToPng(screen));
}
console.log(`${built.input.screens.length} screens -> ${out}`);
