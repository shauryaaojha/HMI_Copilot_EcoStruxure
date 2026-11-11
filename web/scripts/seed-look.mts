/**
 * A filled project for looking at the UI: screens laid out from a real sample
 * export, its tags and bindings, and a short conversation. Writes the JSON a
 * browser's localStorage holds for a project (store/persist.ts, version 3),
 * so a headless browser can open a workspace with something in it without
 * signing in or calling a model.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/seed-look.mts <out.json> [sample]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseTags } from "@/lib/tags/parse";
import { inferEquipment } from "@/lib/ai/infer";
import { fallbackPlan } from "@/lib/ai/plan";
import { layoutApplication } from "@/lib/ote/layout";
import { DEFAULT_STANDARDS } from "@/store/types";

const [out, sample = "Transfer_Pumps.csv"] = process.argv.slice(2);
if (!out) throw new Error("usage: seed-look.mts <out.json> [sample]");

const panel = { model: "HMIST6500", width: 1024, height: 600 };
const csv = readFileSync(join(process.cwd(), "public", "demo", sample));
const { variables } = parseTags(csv, sample);
const equipment = inferEquipment(variables);
const plan = fallbackPlan("A process overview, a faceplate per pump, and an alarm screen", equipment);
const laid = layoutApplication(plan.screens, equipment, panel);
const screens = laid.map((s) => s.screen);
const bindings = laid.flatMap((s) => s.wires.map((w) => ({ tag: w.tag, targetId: w.part.UniqueId, targetName: w.part.Name, property: w.property })));
const at = Date.now() - 60_000;

writeFileSync(
  out,
  JSON.stringify({
    v: 3,
    savedAt: Date.now(),
    id: "",
    name: "Transfer Pump Station",
    target: panel,
    screens,
    activeScreenId: screens[0]?.UniqueId,
    variables,
    alarms: [],
    bindings,
    objectMeta: {},
    screenPlacement: {},
    standards: DEFAULT_STANDARDS,
    versions: [],
    chat: [
      { id: "u1", role: "user", at, text: "A process overview, a faceplate per pump, and an alarm screen" },
      {
        id: "a1",
        role: "assistant",
        at: at + 20_000,
        text: `Built ${screens.length} screens from ${variables.length} tags.`,
        changes: screens.map((s) => `Added screen ${s.Name}, ${s.Children[0].Children.length} objects`),
      },
      { id: "u2", role: "user", at: at + 40_000, text: "Move the pump status clear of the alarm banner" },
      { id: "a2", role: "assistant", at: at + 50_000, text: "Moved it 24 px down; nothing overlaps the banner now.", changes: ["Moved PMP-101 status 24 px down"] },
    ],
  }),
);
console.log(`${screens.length} screens, ${variables.length} tags, ${bindings.length} bindings -> ${out}`);
