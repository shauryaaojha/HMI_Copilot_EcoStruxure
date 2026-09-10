/**
 * Builds the graphic-object index from a local EcoStruxure installation.
 *
 *   npm run index:graphics
 *
 * Reads Buildtime/PropertyDefinitions/ScreenDesign/GraphicObjects/ ** / *.path and
 * writes src/lib/ote/graphics-index.json - name, category and an SVG `d` per symbol.
 *
 * The output is geometry derived from the installation, so it is generated on each
 * developer's machine rather than committed. Set OTE_INSTALL_DIR if the product is
 * not at the default path.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const INSTALL =
  process.env.OTE_INSTALL_DIR ??
  "C:\\Program Files\\Schneider Electric\\EcoStruxure Operator Terminal Expert 4.4";

const ROOT = path.join(
  INSTALL,
  "Buildtime",
  "PropertyDefinitions",
  "ScreenDesign",
  "GraphicObjects",
);

const OUT = path.join(HERE, "..", "src", "lib", "ote", "graphics-index.json");

const ARITY = { M: 1, L: 1, Q: 2, C: 3, z: 0, Z: 0 };

function toPathData(raw) {
  const nums = raw.Points.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  const out = [];
  let i = 0;
  for (const command of raw.Commands) {
    const arity = ARITY[command];
    if (arity === undefined) throw new Error(`unsupported command "${command}"`);
    if (arity === 0) {
      out.push("Z");
      continue;
    }
    const needed = arity * 2;
    if (i + needed > nums.length) throw new Error("Points exhausted");
    const coords = [];
    for (let k = 0; k < needed; k += 2) {
      coords.push(`${nums[i + k]},${nums[i + k + 1]}`);
    }
    i += needed;
    out.push(`${command} ${coords.join(" ")}`);
  }
  if (i !== nums.length) throw new Error("unused points");
  return out.join(" ");
}

function bounds(raw) {
  const nums = raw.Points.split(",").map(Number);
  let width = 0;
  let height = 0;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    if (nums[i] > width) width = nums[i];
    if (nums[i + 1] > height) height = nums[i + 1];
  }
  return { width, height };
}

async function walk(dir) {
  const found = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full)));
    else if (entry.name.endsWith(".path")) found.push(full);
  }
  return found;
}

async function main() {
  try {
    await fs.access(ROOT);
  } catch {
    console.error(
      `Graphic objects not found at:\n  ${ROOT}\n\n` +
        "Set OTE_INSTALL_DIR to your EcoStruxure Operator Terminal Expert 4.4 install.",
    );
    process.exit(1);
  }

  const files = await walk(ROOT);
  const symbols = [];
  const skipped = [];

  for (const file of files) {
    const category = path.relative(ROOT, path.dirname(file)).split(path.sep).join("/");
    try {
      const raw = JSON.parse(await fs.readFile(file, "utf8"));
      if (!raw.Commands || !raw.Points) {
        skipped.push([path.basename(file), "no geometry"]);
        continue;
      }
      const { width, height } = bounds(raw);
      symbols.push({
        name: raw.Name ?? path.basename(file, ".path"),
        category,
        d: toPathData(raw),
        width,
        height,
        // A Path part is written from Commands and Points, not from the derived
        // `d`. Dropping them makes every symbol browsable but unplaceable.
        Commands: raw.Commands,
        Points: raw.Points,
      });
    } catch (err) {
      skipped.push([path.basename(file), err.message]);
    }
  }

  symbols.sort((a, b) =>
    a.category === b.category
      ? a.name.localeCompare(b.name)
      : a.category.localeCompare(b.category),
  );

  await fs.writeFile(OUT, JSON.stringify({ symbols }, null, 1) + "\n", "utf8");

  const categories = new Set(symbols.map((s) => s.category));
  console.log(
    `indexed ${symbols.length} symbols across ${categories.size} categories -> ` +
      path.relative(process.cwd(), OUT),
  );
  if (skipped.length) {
    console.log(`skipped ${skipped.length}:`);
    for (const [name, why] of skipped.slice(0, 10)) console.log(`  ${name}: ${why}`);
  }
}

main();
