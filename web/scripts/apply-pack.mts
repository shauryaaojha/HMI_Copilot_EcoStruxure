/**
 * Apply the Standard pack to a Screen.dat-shaped JSON file, in place.
 *
 *   npx tsx scripts/apply-pack.mts src/fixtures/pump-station.screen.json
 *
 * Used once to bring the demo fixture, which was drawn before the pack
 * existed, onto it - and kept because it is the command-line form of the
 * same thing the app does to an opened project. Prints the per-object diff.
 */

import fs from "node:fs";
import { Screen } from "../src/lib/ote/schema.js";
import { applyPack } from "../src/lib/standard/apply.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: apply-pack.mts <screen.json>");
  process.exit(2);
}

const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const screen = Screen.parse(raw);
const view = screen.Children[0];
const { parts, changes } = applyPack(view.Children, undefined, { width: view.Width, height: view.Height });

// Write back over the original JSON so anything the schema does not model
// (there is nothing in the fixture, but the habit matters) survives.
raw.Children[0].Children = raw.Children[0].Children.map((original: Record<string, unknown>, i: number) => ({
  ...original,
  ...parts[i],
}));
fs.writeFileSync(file, JSON.stringify(raw, null, 2) + "\n");

for (const line of changes) console.log(line);
console.log(`\n${changes.length} changes written to ${file}`);
