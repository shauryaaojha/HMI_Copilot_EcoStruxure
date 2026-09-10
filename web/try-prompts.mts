import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const { runPipeline } = await import("./src/lib/ai/pipeline.js");
const { DEMO_VARIABLES } = await import("./src/lib/ote/demo-project.js");

const PROMPTS = [
  "Create a pump station screen for the two transfer pumps. Show which one is running, flag any fault, display flow and tank level, and warn before the tank overfills.",
  "Show me both pumps with running and fault lamps, the flow and level readings, and an alarm banner.",
  "Just the tank level and its alarms. No pump status.",
];

for (const [i, intent] of PROMPTS.entries()) {
  const t0 = Date.now();
  const evs: any[] = [];
  for await (const e of runPipeline({ intent, variables: DEMO_VARIABLES })) evs.push(e);
  const n = (t: string) => evs.filter((e) => e.type === t).length;
  const plan = evs.find((e) => e.type === "log" && /read the request/.test(e.message));
  const nameLog = evs.find((e) => e.type === "log" && /Placed \d+ objects on/.test(e.message));
  console.log(`\n--- prompt ${i + 1} (${Date.now() - t0} ms) ---`);
  console.log(`  "${intent.slice(0, 70)}${intent.length > 70 ? "…" : ""}"`);
  console.log(`  ${nameLog?.message ?? "(no layout)"}`);
  console.log(`  objects ${n("object")}  alarms ${n("alarm")}  bindings ${n("binding")}  errors ${n("error")}`);
  console.log(`  ${plan?.message.replace(/^Gemini read the request: /, "→ ") ?? ""}`);
}
