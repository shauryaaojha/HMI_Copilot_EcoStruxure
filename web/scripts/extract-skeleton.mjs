/**
 * Pulls the project skeleton out of a local EcoStruxure installation.
 *
 *   npm run setup:skeleton
 *
 * The packager starts from Blank.eote and writes only Variables.db and Alarm.db;
 * every other database (Recipe, Security, Language, DriverConfig, ...) is copied
 * verbatim. Those files are Schneider's, so they are extracted on each
 * developer's machine and never committed - src/lib/ote/skeleton/ is gitignored.
 *
 * Set OTE_INSTALL_DIR if the product is not at the default path.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));

const INSTALL =
  process.env.OTE_INSTALL_DIR ??
  "C:\\Program Files\\Schneider Electric\\EcoStruxure Operator Terminal Expert 4.4";

const TEMPLATES = path.join(
  INSTALL,
  "Buildtime",
  "BuildtimeData",
  "ProjectTemplates",
);

const OUT = path.join(HERE, "..", "src", "lib", "ote", "skeleton");

async function main() {
  const source = path.join(TEMPLATES, "Blank.eote");

  try {
    await fs.access(source);
  } catch {
    console.error(
      `Blank.eote not found at:\n  ${source}\n\n` +
        "Set OTE_INSTALL_DIR to your EcoStruxure Operator Terminal Expert 4.4 install.",
    );
    process.exit(1);
  }

  let JSZip;
  try {
    JSZip = require("jszip");
  } catch {
    console.error("Run `npm install` first - this script needs jszip.");
    process.exit(1);
  }

  await fs.mkdir(OUT, { recursive: true });

  const zip = await JSZip.loadAsync(await fs.readFile(source));
  let count = 0;

  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    // Entry names use backslashes; flatten them to a safe on-disk name and keep
    // the original in the manifest so the packager can restore it exactly.
    const flat = name.replace(/[\\/]/g, "__");
    await fs.writeFile(path.join(OUT, flat), await entry.async("nodebuffer"));
    count += 1;
  }

  const manifest = Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir)
    .map((name) => ({ entry: name, file: name.replace(/[\\/]/g, "__") }));

  await fs.writeFile(
    path.join(OUT, "manifest.json"),
    JSON.stringify({ source: "Blank.eote", entries: manifest }, null, 1) + "\n",
    "utf8",
  );

  console.log(
    `extracted ${count} entries -> ${path.relative(process.cwd(), OUT)}\n` +
      "This directory is gitignored: it holds Schneider's own files.",
  );
}

main();
