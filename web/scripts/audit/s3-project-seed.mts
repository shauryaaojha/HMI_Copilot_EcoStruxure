/**
 * S3: a v3 project snapshot of an .eote, for POST /api/projects on the LOCAL server, so the MCP
 * tools have a shared project to work on. Handles come from the app's own store hydrate.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/audit/s3-project-seed.mts <file.eote> <sourceId> <out.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { readProject } from "@/lib/ote/reader";
import { createProjectStore } from "@/store/project";

const [file, sourceId, out] = process.argv.slice(2);
const read = await readProject(new Uint8Array(readFileSync(file)), file);
const store = createProjectStore();
store.getState().hydrate({
  name: "S3 Align (audit)", target: read.target, screens: read.screens, foreign: read.foreign, activeScreenId: read.screens[0]?.UniqueId,
  variables: read.variables, alarms: read.alarms,
  bindings: read.wires.map((w) => ({ tag: w.tag, targetId: w.part.UniqueId, targetName: w.part.Name, property: w.property })),
} as never);
const s = store.getState() as unknown as Record<string, unknown>;
const snapshot = {
  v: 3, id: crypto.randomUUID(), name: "S3 Align (audit)", target: read.target, screens: s.screens, variables: s.variables, alarms: s.alarms,
  bindings: s.bindings, objectMeta: s.objectMeta ?? {}, handles: s.handles, handleSeq: s.handleSeq, foreign: read.foreign,
  source: sourceId, sourceId, standards: s.standards ?? {}, versions: [], chat: [],
};
writeFileSync(out, JSON.stringify({ snapshot }));
console.log(`snapshot: ${(snapshot.screens as unknown[]).length} screens, ${Object.keys(snapshot.handles as object).length} handles`);
