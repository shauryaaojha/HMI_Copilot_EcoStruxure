/**
 * Writes a project containing symbols from the shipped graphic object library.
 *
 *   npm run build:symbols
 *
 * The Phase 2b gate: a symbol taken from the installation, written into a Path
 * part, must come back out of EcoStruxure unchanged. Until someone opens this
 * file, the library is proven convertible but not proven placeable.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathPart, rectangle, screenOf, textBox } from "../src/lib/ote/parts.js";
import { DARK_GREY, GREEN, INK, WHITE } from "../src/lib/ote/palette.js";
import { packageProject } from "../src/lib/ote/packager.js";
import { loadSkeleton } from "../src/lib/ote/skeleton.js";
import type { Part } from "../src/lib/ote/schema.js";

const INDEX = path.join(process.cwd(), "src", "lib", "ote", "graphics-index.json");
const OUT = path.join(process.cwd(), "..", "demo_project", "HMICopilot_Symbols.eote");

interface Symbol { name: string; category: string; Commands: string; Points: string; }

const { symbols } = JSON.parse(await fs.readFile(INDEX, "utf8")) as { symbols: Symbol[] };

/** One representative from each category equipment inference actually targets. */
const wanted = ["Pumps", "Tanks", "Valves", "Fans"];
const picked = wanted
  .map((c) => symbols.find((s) => s.category.endsWith(c)))
  .filter((s): s is Symbol => Boolean(s));

if (picked.length === 0) {
  console.error("No symbols indexed. Run `npm run index:graphics` first.");
  process.exit(1);
}

const parts: Part[] = [
  rectangle("Banner", { left: 0, top: 0, width: 1024, height: 56 }, { fill: GREEN, border: GREEN }),
  textBox("Title", "Shipped symbol library", { left: 20, top: 14, width: 520, height: 30 }, { size: 20, colour: WHITE, bold: true }),
];

picked.forEach((symbol, i) => {
  const left = 40 + i * 240;
  parts.push(rectangle(`Panel_${i}`, { left, top: 96, width: 200, height: 260 }));
  parts.push(pathPart(`Sym_${symbol.name}`, symbol, { left: left + 20, top: 120, width: 160, height: 160 }));
  parts.push(textBox(`Lbl_${symbol.name}`, symbol.name, { left: left + 20, top: 296, width: 160, height: 24 }, { size: 13, colour: INK }));
  parts.push(textBox(`Cat_${symbol.name}`, symbol.category.replace(/^\d+-/, ""), { left: left + 20, top: 320, width: 160, height: 22 }, { size: 11, colour: DARK_GREY }));
});

const bytes = await packageProject(
  {
    name: "SymbolLibrary",
    target: { model: "HMIST6500AWADI", width: 1024, height: 600 },
    screens: [screenOf("SymbolLibrary", parts, { width: 1024, height: 600 })],
    variables: [], alarms: [], wires: [],
  },
  await loadSkeleton(),
);

await fs.writeFile(OUT, bytes);
console.log(
  `wrote ${path.relative(process.cwd(), OUT)}  ${bytes.length.toLocaleString()} bytes\n` +
    `  ${picked.map((s) => s.name).join(", ")}\n` +
    "\n  Open it: File > Open Project in EcoStruxure Operator Terminal Expert 4.4",
);
