/**
 * Pulls the project skeleton out of a local EcoStruxure installation.
 *
 *   npm run setup:skeleton
 *
 * The packager starts from Blank.eote and writes only Variables.db, Alarm.db and
 * the screens; every other database (Recipe, Security, Language, DriverConfig...)
 * is copied through verbatim. It also needs one LocalVariables.db, which Blank
 * has no screen to supply, so that comes from a shipped sample.
 *
 * These are Schneider's files. They are extracted on each developer's machine and
 * never committed - skeleton/ is gitignored. Set OTE_INSTALL_DIR if the product
 * is not at the default path.
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

const TEMPLATES = path.join(INSTALL, "Buildtime", "BuildtimeData", "ProjectTemplates");
const BLANK = path.join(TEMPLATES, "Blank.eote");
const DONOR = path.join(TEMPLATES, "Sample - Alarm 1.eote");

/** Project root, not src/ - the export route reads these with fs at runtime. */
const OUT = path.join(HERE, "..", "skeleton");

async function entriesOf(JSZip, file) {
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const out = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    out.push({ name, data: await entry.async("nodebuffer") });
  }
  return out;
}

async function main() {
  for (const file of [BLANK, DONOR]) {
    try {
      await fs.access(file);
    } catch {
      console.error(
        `Not found:\n  ${file}\n\n` +
          "Set OTE_INSTALL_DIR to your EcoStruxure Operator Terminal Expert 4.4 install.",
      );
      process.exit(1);
    }
  }

  let JSZip;
  try {
    JSZip = require("jszip");
  } catch {
    console.error("Run `npm install` first - this script needs jszip.");
    process.exit(1);
  }

  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(path.join(OUT, "entries"), { recursive: true });

  // Blank.eote supplies every entry the generated project starts from. Entry
  // names use backslashes, so they are flattened on disk and the original is
  // kept in the manifest for the packager to restore exactly.
  const blank = await entriesOf(JSZip, BLANK);
  const manifest = [];
  for (const { name, data } of blank) {
    const file = name.replace(/[\\/]/g, "__");
    await fs.writeFile(path.join(OUT, "entries", file), data);
    manifest.push({ entry: name, file });
  }

  // Blank has no screen, so it carries no LocalVariables.db. Take one from a
  // sample that does.
  const donor = await entriesOf(JSZip, DONOR);
  const local = donor.find(
    (e) =>
      e.name.replace(/\\/g, "/").startsWith("Screens/") &&
      e.name.endsWith("LocalVariables.db"),
  );
  if (!local) {
    console.error(`No LocalVariables.db found in ${path.basename(DONOR)}`);
    process.exit(1);
  }
  await fs.writeFile(path.join(OUT, "LocalVariables.db"), local.data);

  await fs.writeFile(
    path.join(OUT, "manifest.json"),
    JSON.stringify(
      {
        source: path.basename(BLANK),
        localVariablesFrom: path.basename(DONOR),
        extractedAt: new Date().toISOString(),
        entries: manifest,
      },
      null,
      1,
    ) + "\n",
    "utf8",
  );

  console.log(
    `extracted ${manifest.length} entries + LocalVariables.db -> ` +
      `${path.relative(process.cwd(), OUT)}\n` +
      "This directory is gitignored: it holds Schneider's own files.",
  );
}

main();
