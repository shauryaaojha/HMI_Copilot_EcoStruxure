/**
 * The part inference cannot do: reading the engineer's sentence.
 *
 * Tag names carry structure, so equipment falls out of a parse (infer.ts).
 * What the engineer *wants shown* does not - "two pumps with running lamps,
 * flow and level, and a high-level alarm" is a sentence, and reading it is the
 * job Claude is here for.
 *
 * The model chooses from what already exists. It never invents a part type, a
 * tag or a colour: the schema below only lets it pick equipment ids that
 * inference already found and part kinds the packager can emit. An invented
 * value fails parsing rather than reaching the canvas.
 *
 * Phase 4 of docs/BUILD_PLAN.md.
 */

import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import type { InferredEquipment } from "./infer";

export interface ScreenPlan {
  title: string;
  screenName: string;
  /** Equipment ids, in the order they should appear. */
  include: string[];
  sections: ("status" | "process" | "alarms")[];
  wantsAlarmBanner: boolean;
  /** One sentence for the build timeline, in engineering language. */
  rationale: string;
}

/**
 * Declared as JSON Schema rather than through the SDK's zod helper, which wants
 * zod v4 while lib/ote/schema.ts - and the inspector generated from it - is on
 * v3. Bumping a shared dependency to satisfy one module is not worth the blast
 * radius; the schema is small enough to state directly.
 *
 * `strict` plus `additionalProperties: false` is what makes the model's output
 * structurally checkable: an invented field fails parsing rather than arriving.
 */
const PLAN_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Screen banner title, from the engineer's words" },
    screenName: {
      type: "string",
      description: "A valid OTE screen name: letters, digits and underscore, no leading digit",
    },
    include: {
      type: "array",
      items: { type: "string" },
      description: "Equipment ids to show, most important first",
    },
    sections: {
      type: "array",
      items: { type: "string", enum: ["status", "process", "alarms"] },
      description: "Which panels the screen needs",
    },
    wantsAlarmBanner: { type: "boolean" },
    rationale: {
      type: "string",
      description: "One sentence naming what was decided and why, in engineering language",
    },
  },
  required: ["title", "screenName", "include", "sections", "wantsAlarmBanner", "rationale"],
  additionalProperties: false,
} as const;

const SYSTEM = `You lay out industrial HMI screens for EcoStruxure Operator Terminal Expert.

You are given equipment already inferred from a PLC tag list, and one sentence
of intent from an engineer. Decide what the screen shows.

Rules:
- Only use equipment ids from the list you are given. Never invent one.
- Include equipment the engineer asked for. If they were not specific, include
  everything, most operationally important first.
- "status" shows running and fault lamps. "process" shows numeric readings.
  "alarms" is the active alarm summary along the bottom.
- Prefer an alarm banner whenever any equipment has a fault or a level reading.
- screenName must be a valid OTE name and should describe the equipment, not
  the request. PumpStation1, not MyNewScreen.
- rationale is one sentence naming what you decided and why, in the register an
  engineer would use. Never describe your own reasoning process.`;

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

/**
 * Returns null when no key is configured, so the caller can run the
 * deterministic path and say so rather than failing.
 */
export async function planScreen(
  intent: string,
  equipment: InferredEquipment[],
): Promise<ScreenPlan | null> {
  if (!hasApiKey()) return null;

  const client = new Anthropic();

  const inventory = equipment
    .map(
      (unit) =>
        `- id "${unit.id}": ${unit.kind} "${unit.label}" — ` +
        unit.roles.map((r) => `${r.tag} (${r.role}, ${r.dataType})`).join(", "),
    )
    .join("\n");

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Equipment found in the tag list:\n${inventory}\n\nEngineer's request:\n"${intent}"`,
      },
    ],
    output_config: { format: jsonSchemaOutputFormat(PLAN_SCHEMA) },
  });

  const plan = response.parsed_output as ScreenPlan | null;
  if (!plan) return null;

  // The schema cannot express "must be one of these ids", so it is checked here
  // rather than trusted. A hallucinated id would place an empty panel.
  const known = new Set(equipment.map((e) => e.id));
  const include = plan.include.filter((id: string) => known.has(id));
  return { ...plan, include: include.length > 0 ? include : [...known] };
}
