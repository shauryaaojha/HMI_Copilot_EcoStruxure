/**
 * Writes a project with the TypeScript packager, for opening in EcoStruxure.
 *
 *   npm run build:demo
 *
 * This is the Phase 1 gate's manual half. tests/packager.test.ts proves the
 * structure matches the proven Python output; only the product can prove the
 * product accepts it.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { buildDemoProject } from "../src/lib/ote/demo-project.js";
import { packageProject } from "../src/lib/ote/packager.js";
import { loadSkeleton } from "../src/lib/ote/skeleton.js";

const OUT = path.join(process.cwd(), "..", "demo_project", "HMICopilot_TS.eote");

const project = buildDemoProject();
const bytes = await packageProject(project, await loadSkeleton());

try {
  await fs.writeFile(OUT, bytes);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "EBUSY" || (error as NodeJS.ErrnoException).code === "EPERM") {
    console.error(
      `\n  Cannot overwrite ${OUT}\n` +
        "  It is open in EcoStruxure Operator Terminal Expert. Close it and run again.\n",
    );
    process.exit(1);
  }
  throw error;
}

const parts = project.screens[0].Children[0].Children.length;
console.log(
  `wrote ${path.relative(process.cwd(), OUT)}  ${bytes.length.toLocaleString()} bytes\n` +
    `  ${parts} parts   ${project.variables.length} tags   ` +
    `${project.alarms.length} alarms   ${project.wires.length + project.alarms.length} bindings\n` +
    "\n  Open it: File > Open Project in EcoStruxure Operator Terminal Expert 4.4",
);
