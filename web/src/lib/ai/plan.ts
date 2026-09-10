/**
 * The part inference cannot do: reading the engineer's sentence.
 *
 * Tag names carry structure, so equipment falls out of a parse (infer.ts).
 * What the engineer *wants shown* does not - "two pumps with running lamps,
 * flow and level, and a high-level alarm" is a sentence, and reading it is the
 * job a model is here for.
 *
 * What comes back is a plan for an *application*, not a screen. An HMI is a set
 * of displays: ISA-101 puts a plant overview above unit overviews above unit
 * detail, and a plant with twenty units on one screen is the thing that
 * standard exists to prevent. So the model decides how many screens there are
 * and what goes on each, and the layout in lib/ote/layout.ts gives them all the
 * same header, navigation and alarm banner.
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

import type { ScreenSpec } from "@/lib/ote/layout";
import type { InferredEquipment } from "./infer";

export type { ScreenSpec } from "@/lib/ote/layout";

export interface ScreenPlan {
  screens: ScreenSpec[];
  /** One sentence for the build timeline, in engineering language. */
  rationale: string;
}

export type Provider = "gemini" | "claude";

/** More units than this on one display is what ISA-101 warns against. */
const UNITS_PER_SCREEN = 6;
/** Beyond this many units, a plant overview earns its place above the rest. */
const OVERVIEW_THRESHOLD = 4;

const SCREEN_FIELDS = [
  "screenName",
  "title",
  "level",
  "include",
  "sections",
] as const;

const DESCRIPTIONS = {
  screenName:
    "A valid OTE screen name: letters, digits and underscore, no leading digit. Describe the equipment, not the request - PumpStation1, not MyNewScreen",
  title: "Screen banner title, in the engineer's words",
  level:
    "1 plant overview, 2 unit overview, 3 unit detail. ISA-101's display hierarchy",
  include: "Equipment ids on this screen, most operationally important first",
  sections: "Which panels this screen needs",
  screens: "The screens this application needs, overview first",
  rationale:
    "One sentence naming what was decided and why, in engineering language",
} as const;

const SYSTEM = `You lay out industrial HMI applications for EcoStruxure Operator Terminal Expert.

You are given equipment already inferred from a PLC tag list, and one sentence
of intent from an engineer. Decide what screens the application needs and what
goes on each.

Rules:
- Only use equipment ids from the list you are given. Never invent one.
- Follow ISA-101's display hierarchy. Level 1 is a plant overview: every unit,
  status only, no readings. Level 2 is a unit overview: a faceplate per unit
  with running state, faults and up to two readings. Level 3 is unit detail.
- At most ${UNITS_PER_SCREEN} units on a level 2 or 3 screen, and at most 12 on
  a level 1 overview. Split into more screens rather than crowding one.
- Produce a level 1 overview only when there are more than ${OVERVIEW_THRESHOLD}
  units, or when the engineer asked for an overview or for a whole plant. One
  station with two pumps is one screen, not three.
- If the engineer named specific equipment, build for that and nothing else.
- "status" shows running and fault lamps. "process" shows numeric readings.
  "alarms" is the active alarm summary along the bottom. Give the alarm section
  to every screen where any unit has a fault or a level reading.
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
    screens: {
      type: "array",
      description: DESCRIPTIONS.screens,
      items: {
        type: "object",
        properties: {
          screenName: { type: "string", description: DESCRIPTIONS.screenName },
          title: { type: "string", description: DESCRIPTIONS.title },
          level: { type: "integer", enum: [1, 2, 3], description: DESCRIPTIONS.level },
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
        },
        required: [...SCREEN_FIELDS],
        additionalProperties: false,
      },
    },
    rationale: { type: "string", description: DESCRIPTIONS.rationale },
  },
  required: ["screens", "rationale"],
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
      screens: {
        type: "ARRAY",
        description: DESCRIPTIONS.screens,
        items: {
          type: "OBJECT",
          properties: {
            screenName: { type: "STRING", description: DESCRIPTIONS.screenName },
            title: { type: "STRING", description: DESCRIPTIONS.title },
            level: { type: "INTEGER", enum: ["1", "2", "3"], description: DESCRIPTIONS.level },
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
          },
          required: [...SCREEN_FIELDS],
          propertyOrdering: [...SCREEN_FIELDS],
        },
      },
      rationale: { type: "STRING", description: DESCRIPTIONS.rationale },
    },
    required: ["screens", "rationale"],
    propertyOrdering: ["screens", "rationale"],
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
  return `Equipment found in the tag list (${equipment.length} units):\n${inventory}\n\nEngineer's request:\n"${intent}"`;
}

const SECTIONS = ["status", "process", "alarms"] as const;

/** Anything the model returned that is not a plan is treated as no plan. */
function coerce(value: unknown): ScreenPlan | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.screens)) return null;

  const screens = raw.screens.flatMap((entry): ScreenSpec[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const spec = entry as Record<string, unknown>;
    if (typeof spec.screenName !== "string" || spec.screenName.trim() === "") return [];

    // Gemini's INTEGER enums arrive as strings often enough to be worth
    // handling rather than discarding an otherwise good screen over.
    const level = Number(spec.level);
    const sections = Array.isArray(spec.sections) ? spec.sections : [];
    const include = Array.isArray(spec.include) ? spec.include : [];

    return [
      {
        screenName: spec.screenName.replace(/[^A-Za-z0-9_]/g, "").replace(/^(\d)/, "S$1"),
        title: typeof spec.title === "string" ? spec.title : spec.screenName,
        level: level === 1 || level === 3 ? level : 2,
        include: include.filter((i): i is string => typeof i === "string"),
        sections: sections.filter((s): s is (typeof SECTIONS)[number] =>
          SECTIONS.includes(s as (typeof SECTIONS)[number]),
        ),
      },
    ];
  });

  if (screens.length === 0) return null;

  return {
    screens,
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
    max_tokens: 8192,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    messages: [{ role: "user", content: prompt(intent, equipment) }],
    output_config: { format: jsonSchemaOutputFormat(JSON_SCHEMA) },
  });

  return coerce(response.parsed_output);
}

/**
 * A plan good enough to build from when no key is configured, or when the model
 * could not be reached.
 *
 * It applies the same hierarchy rule the prompt states, because the offline
 * path has to produce something an engineer would recognise as the product's
 * output rather than a degraded version of it.
 */
export function fallbackPlan(
  intent: string,
  equipment: InferredEquipment[],
): ScreenPlan {
  const hasFaults = equipment.some((e) => e.roles.some((r) => r.role === "fault"));
  const hasReadings = equipment.some((e) =>
    e.roles.some((r) => r.dataType !== "BOOL" && r.dataType !== "STRING"),
  );
  const sections: ScreenSpec["sections"] = ["status"];
  if (hasReadings) sections.push("process");
  if (hasFaults || hasReadings) sections.push("alarms");

  // The most common machine kind, not the first one seen: a boiler house whose
  // first inferred unit happens to be a fan is not a fan station.
  const counts = new Map<string, number>();
  for (const unit of equipment) {
    if (unit.kind === "instrument") continue;
    counts.set(unit.kind, (counts.get(unit.kind) ?? 0) + 1);
  }
  const kind = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const stem = kind
    ? `${kind.charAt(0).toUpperCase()}${kind.slice(1)}Station`
    : "Unit";

  const screens: ScreenSpec[] = [];
  if (equipment.length > OVERVIEW_THRESHOLD) {
    screens.push({
      screenName: "PlantOverview",
      title: intent.trim().slice(0, 60) || "Plant Overview",
      level: 1,
      include: equipment.slice(0, 12).map((e) => e.id),
      sections: ["status", "alarms"],
    });
  }

  for (let i = 0; i < equipment.length; i += UNITS_PER_SCREEN) {
    const group = equipment.slice(i, i + UNITS_PER_SCREEN);
    const index = Math.floor(i / UNITS_PER_SCREEN) + 1;
    screens.push({
      screenName: screens.length === 0 ? `${stem}${index}` : `${stem}${index}`,
      title:
        screens.length === 0
          ? intent.trim().slice(0, 60) || `${stem} ${index}`
          : `${stem} ${index}`,
      level: 2,
      include: group.map((e) => e.id),
      sections,
    });
  }

  if (screens.length === 0) {
    screens.push({
      screenName: "Overview",
      title: intent.trim().slice(0, 60) || "Overview",
      level: 2,
      include: [],
      sections: ["status"],
    });
  }

  const count = screens.length;
  return {
    screens,
    rationale: `Laid out ${equipment.length} unit${equipment.length === 1 ? "" : "s"} across ${count} screen${count === 1 ? "" : "s"} from the tag names.`,
  };
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
  // rather than trusted. A hallucinated id would place an empty card.
  const known = new Set(equipment.map((e) => e.id));
  const seen = new Set<string>();

  const screens = plan.screens.map((spec, i) => {
    const include = spec.include.filter((id) => known.has(id));
    // Screen names have to be unique: they name the entry in the project's own
    // hierarchy, and two screens called Overview is a project that does not open.
    let name = spec.screenName || `Screen${i + 1}`;
    for (let n = 2; seen.has(name.toLowerCase()); n++) name = `${spec.screenName}${n}`;
    seen.add(name.toLowerCase());

    return {
      ...spec,
      screenName: name,
      include: include.length > 0 || spec.level === 1 ? include : [...known],
      sections: spec.sections.length > 0 ? spec.sections : (["status"] as const).slice(),
    };
  });

  return {
    provider,
    plan: { ...plan, screens: placeEveryUnit(screens, equipment, seen) },
  };
}

/**
 * Puts the units the model left out somewhere.
 *
 * Asked for a whole plant, a model reliably plans the areas it was told about
 * and stops - on a 94-unit plant it planned nine screens covering 48 of them.
 * The other 46 were inferred, named in the prompt, and then simply absent from
 * the project: no faceplate, no binding, no alarm. "48 of 94 units" in the
 * build timeline reads as a bug because it is one.
 *
 * The model's grouping is kept - it read the request and knows which area is
 * which. Leftovers fill the screens it already made, preferring one that
 * already holds the same kind of equipment because that is the best available
 * guess at which area a unit belongs to, and whatever is still homeless gets
 * screens of its own, grouped by kind.
 */
export function placeEveryUnit(
  screens: ScreenSpec[],
  equipment: InferredEquipment[],
  takenNames: Set<string>,
): ScreenSpec[] {
  const placed = new Set(screens.flatMap((s) => s.include));
  const missing = equipment.filter((unit) => !placed.has(unit.id));
  if (missing.length === 0) return screens;

  const out = screens.map((s) => ({ ...s, include: [...s.include] }));
  // A level 1 overview is a summary, not an inventory - filling it to the cap
  // with leftovers is the opposite of what it is for.
  const detail = out.filter((s) => s.level !== 1);
  const kindOf = new Map(equipment.map((e) => [e.id, e.kind]));

  const homeless: InferredEquipment[] = [];
  for (const unit of missing) {
    const sameKind = detail.find(
      (s) =>
        s.include.length < UNITS_PER_SCREEN &&
        s.include.some((id) => kindOf.get(id) === unit.kind),
    );
    const anyRoom = detail.find((s) => s.include.length < UNITS_PER_SCREEN);
    const home = sameKind ?? anyRoom;
    if (home) home.include.push(unit.id);
    else homeless.push(unit);
  }

  // Whatever is still left gets its own screens, grouped by kind so a screen
  // is about something rather than being the remainder.
  const byKind = new Map<string, InferredEquipment[]>();
  for (const unit of homeless) {
    const key = unit.kind === "instrument" ? "Instruments" : unit.kind;
    (byKind.get(key) ?? byKind.set(key, []).get(key)!).push(unit);
  }

  for (const [kind, units] of byKind) {
    const stem = `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
    for (let i = 0; i < units.length; i += UNITS_PER_SCREEN) {
      let name = `${stem}Area${Math.floor(i / UNITS_PER_SCREEN) + 1}`;
      for (let n = 2; takenNames.has(name.toLowerCase()); n++) name = `${stem}Area${n}`;
      takenNames.add(name.toLowerCase());
      out.push({
        screenName: name,
        title: `${stem} — ${units.length} unit${units.length === 1 ? "" : "s"}`,
        level: 2,
        include: units.slice(i, i + UNITS_PER_SCREEN).map((u) => u.id),
        sections: ["status", "process", "alarms"],
      });
    }
  }

  return out;
}
