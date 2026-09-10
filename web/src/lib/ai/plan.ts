/**
 * The part inference cannot do: reading the engineer's sentence.
 *
 * Tag names carry structure, so equipment falls out of a parse (infer.ts).
 * What the engineer *wants shown* does not - "two pumps with running lamps,
 * flow and level, and a high-level alarm" is a sentence, and reading it is the
 * job a model is here for.
 *
 * The model chooses from what already exists. It never invents a part type, a
 * tag or a colour: the schema below only lets it pick equipment ids that
 * inference already found and sections the packager can emit. An invented value
 * fails parsing rather than reaching the canvas, and ids are re-checked against
 * inference afterwards because no schema can express "must be one of these".
 *
 * Two providers, one interface. Which one runs is a matter of which key is set,
 * and the pipeline says which in the build timeline - a demo must never imply a
 * model was involved when it was not.
 *
 * Phase 4 of docs/BUILD_PLAN.md.
 */

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

export type Provider = "gemini" | "claude";

const FIELDS = [
  "title",
  "screenName",
  "include",
  "sections",
  "wantsAlarmBanner",
  "rationale",
] as const;

const DESCRIPTIONS = {
  title: "Screen banner title, from the engineer's words",
  screenName:
    "A valid OTE screen name: letters, digits and underscore, no leading digit",
  include: "Equipment ids to show, most important first",
  sections: "Which panels the screen needs",
  wantsAlarmBanner: "Whether the screen carries an alarm summary",
  rationale:
    "One sentence naming what was decided and why, in engineering language",
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

/**
 * Anthropic takes JSON Schema. `additionalProperties: false` plus a complete
 * `required` is what makes the output structurally checkable rather than merely
 * hoped for.
 */
const JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: DESCRIPTIONS.title },
    screenName: { type: "string", description: DESCRIPTIONS.screenName },
    include: {
      type: "array",
      items: { type: "string" },
      description: DESCRIPTIONS.include,
    },
    sections: {
      type: "array",
      items: { type: "string", enum: ["status", "process", "alarms"] },
      description: DESCRIPTIONS.sections,
    },
    wantsAlarmBanner: { type: "boolean", description: DESCRIPTIONS.wantsAlarmBanner },
    rationale: { type: "string", description: DESCRIPTIONS.rationale },
  },
  required: [...FIELDS],
  additionalProperties: false,
} as const;

/**
 * Gemini takes an OpenAPI subset, not JSON Schema: types are an enum of
 * uppercase names and `additionalProperties` is not part of the dialect, so the
 * two schemas cannot be one object. `propertyOrdering` is Gemini-specific and
 * worth setting - without it field order drifts between calls, which makes
 * responses harder to diff when something goes wrong.
 */
function geminiSchema() {
  return {
    type: "OBJECT",
    properties: {
      title: { type: "STRING", description: DESCRIPTIONS.title },
      screenName: { type: "STRING", description: DESCRIPTIONS.screenName },
      include: {
        type: "ARRAY",
        items: { type: "STRING" },
        description: DESCRIPTIONS.include,
      },
      sections: {
        type: "ARRAY",
        items: { type: "STRING", enum: ["status", "process", "alarms"] },
        description: DESCRIPTIONS.sections,
      },
      wantsAlarmBanner: { type: "BOOLEAN", description: DESCRIPTIONS.wantsAlarmBanner },
      rationale: { type: "STRING", description: DESCRIPTIONS.rationale },
    },
    required: [...FIELDS],
    propertyOrdering: [...FIELDS],
  };
}

const env = (name: string) => process.env[name]?.trim() || undefined;

/** Gemini first: it is the configured free tier. Claude if only that key is set. */
export function activeProvider(): Provider | null {
  if (env("GEMINI_API_KEY")) return "gemini";
  if (env("ANTHROPIC_API_KEY")) return "claude";
  return null;
}

export function hasApiKey(): boolean {
  return activeProvider() !== null;
}

function prompt(intent: string, equipment: InferredEquipment[]): string {
  const inventory = equipment
    .map(
      (unit) =>
        `- id "${unit.id}": ${unit.kind} "${unit.label}" — ` +
        unit.roles.map((r) => `${r.tag} (${r.role}, ${r.dataType})`).join(", "),
    )
    .join("\n");
  return `Equipment found in the tag list:\n${inventory}\n\nEngineer's request:\n"${intent}"`;
}

/** Anything the model returned that is not a plan is treated as no plan. */
function coerce(value: unknown): ScreenPlan | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const sections = Array.isArray(raw.sections) ? raw.sections : [];
  const include = Array.isArray(raw.include) ? raw.include : [];

  if (typeof raw.title !== "string" || typeof raw.screenName !== "string") return null;

  return {
    title: raw.title,
    screenName: raw.screenName,
    include: include.filter((i): i is string => typeof i === "string"),
    sections: sections.filter(
      (s): s is ScreenPlan["sections"][number] =>
        s === "status" || s === "process" || s === "alarms",
    ),
    wantsAlarmBanner: raw.wantsAlarmBanner === true,
    rationale: typeof raw.rationale === "string" ? raw.rationale : "",
  };
}

async function planWithGemini(
  intent: string,
  equipment: InferredEquipment[],
): Promise<ScreenPlan | null> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: env("GEMINI_API_KEY")! });

  const response = await ai.models.generateContent({
    model: env("GEMINI_MODEL") ?? "gemini-flash-lite-latest",
    contents: prompt(intent, equipment),
    config: {
      systemInstruction: SYSTEM,
      responseMimeType: "application/json",
      responseSchema: geminiSchema(),
      temperature: 0.2,
    },
  });

  const text = response.text;
  if (!text) return null;
  try {
    return coerce(JSON.parse(text));
  } catch {
    // Constrained decoding should make this unreachable; if the dialect ever
    // drifts, the caller falls back rather than the screen failing to build.
    return null;
  }
}

async function planWithClaude(
  intent: string,
  equipment: InferredEquipment[],
): Promise<ScreenPlan | null> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { jsonSchemaOutputFormat } = await import(
    "@anthropic-ai/sdk/helpers/json-schema"
  );

  const client = new Anthropic();
  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    messages: [{ role: "user", content: prompt(intent, equipment) }],
    output_config: { format: jsonSchemaOutputFormat(JSON_SCHEMA) },
  });

  return coerce(response.parsed_output);
}

/**
 * Returns null when no key is configured, so the caller can run the
 * deterministic path and say so rather than failing.
 */
export async function planScreen(
  intent: string,
  equipment: InferredEquipment[],
): Promise<{ plan: ScreenPlan; provider: Provider } | null> {
  const provider = activeProvider();
  if (!provider) return null;

  const plan =
    provider === "gemini"
      ? await planWithGemini(intent, equipment)
      : await planWithClaude(intent, equipment);

  if (!plan) return null;

  // No schema can express "must be one of these ids", so it is checked here
  // rather than trusted. A hallucinated id would place an empty panel.
  const known = new Set(equipment.map((e) => e.id));
  const include = plan.include.filter((id) => known.has(id));
  const sections = plan.sections.length > 0 ? plan.sections : (["status"] as const);

  return {
    provider,
    plan: {
      ...plan,
      include: include.length > 0 ? include : [...known],
      sections: [...sections],
    },
  };
}
