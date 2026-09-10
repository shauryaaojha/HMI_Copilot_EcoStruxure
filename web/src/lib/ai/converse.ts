/**
 * The conversation: reading what the engineer wants, turn after turn.
 *
 * plan.ts answers one question - "what should this screen contain?" - once,
 * from a tag list. This answers a different one: "given the project as it
 * stands and everything said so far, what happens next?" The answer is one of
 * four things, and which one it is matters more than the words around it:
 *
 *   clarify  the request is genuinely ambiguous; ask the specific thing missing
 *   build    a whole screen from the tag list, which is the eight-step pipeline
 *   edit     a list of operations against the project as it stands
 *   answer   a question about the project, changing nothing
 *
 * The bar for `clarify` is deliberately high. An assistant that interrogates an
 * engineer before drawing a rectangle is worse than one that draws the wrong
 * rectangle, because the rectangle can be undone. It asks when a reasonable
 * assumption would be a guess about intent - which of two pumps, which screen -
 * and otherwise assumes, builds, and says out loud what it assumed.
 *
 * Two providers, one interface, same as plan.ts. Which one runs is a matter of
 * which key is set, and the reply says which - a demo must never imply a model
 * was involved when it was not.
 */

import type { Alarm, Screen, Variable } from "@/lib/ote/schema";
import { ALIGN_MODES, COLOR_NAMES, OP_NAMES, coerceTurn, type Turn } from "./ops";
import { PART_TYPES } from "@/lib/ote/schema";
import { activeProvider, type Provider } from "./plan";

export type { Provider } from "./plan";

/** What the model is told about the project. Names and boxes, not the tree. */
export interface ProjectDigest {
  name: string;
  target: { model: string; width: number; height: number };
  screens: {
    name: string;
    active: boolean;
    objects: { name: string; type: string; left: number; top: number; width: number; height: number }[];
  }[];
  variables: { name: string; dataType: string; comment: string }[];
  alarms: { message: string; trigger: string }[];
  bindings: { tag: string; target: string; property: string }[];
  selection: string[];
}

/** Built from the store, capped so a 1,200-tag import does not blow the budget. */
export function digestOf(project: {
  name: string;
  target: { model: string; width: number; height: number };
  screens: Screen[];
  activeScreenId?: string;
  variables: Variable[];
  alarms: Alarm[];
  bindings: { tag: string; targetName: string; property: string }[];
  selectedIds: string[];
}): ProjectDigest {
  const nameById = new Map(
    project.screens.flatMap((s) =>
      s.Children[0].Children.map((p) => [p.UniqueId, p.Name] as const),
    ),
  );
  return {
    name: project.name,
    target: project.target,
    screens: project.screens.map((screen) => ({
      name: screen.Name,
      active: screen.UniqueId === project.activeScreenId,
      objects: screen.Children[0].Children.map((p) => ({
        name: p.Name,
        type: p.Type,
        left: p.Location.Left,
        top: p.Location.Top,
        width: p.Width,
        height: p.Height,
      })),
    })),
    variables: project.variables.slice(0, 120).map((v) => ({
      name: v.Name,
      dataType: v.DataType,
      comment: v.Comments ?? "",
    })),
    alarms: project.alarms.map((a) => ({ message: a.Message, trigger: a.Trigger })),
    bindings: project.bindings.map((b) => ({
      tag: b.tag,
      target: b.targetName,
      property: b.property,
    })),
    selection: project.selectedIds.map((id) => nameById.get(id) ?? id),
  };
}

const SYSTEM = `You are the HMI Copilot inside EcoStruxure Operator Terminal Expert.
An automation engineer is building operator screens by talking to you, turn
after turn, until the screens are right.

Every turn you choose exactly one mode:

- "build"   — they want a whole screen laid out from the PLC tag list. Put their
              request, in their words, in buildIntent. Use this for "create a
              pump station screen", "generate an overview", "make screens for
              the whole plant".
- "edit"    — they want the project as it stands changed. Emit ops.
- "clarify" — the request cannot be acted on without guessing what they meant.
              Ask at most two specific questions in questions[].
- "answer"  — they asked something about the project. Explain, change nothing.

When to clarify, and when not to:
- Do NOT clarify to confirm something you can reasonably assume. Assume, act,
  and say what you assumed in reply. Undo is one keystroke; an interrogation is
  not.
- Do NOT ask for colours, sizes, fonts or positions. Choose sensible ones.
- DO clarify when the request names something that does not exist in the
  project or the tag list, when it could mean two different objects or screens,
  or when it would delete work and you cannot tell which.

Screen design, when you lay one out:
- ISA-101: a plant overview above unit overviews above detail screens. Keep
  navigation and the alarm banner in the same place on every screen.
- Colour is a signal, not decoration. Neutral while normal; red, amber and
  green reserved for abnormal states and running/stopped.
- Line things up on an 8-unit grid. Panels get a heading. Nothing overlaps.

Ops:
- Only the ops listed in the schema exist. Only the part types listed exist.
- Refer to objects and screens by their Name, exactly as given to you.
- Positions are in screen units, origin top-left, inside the panel size given.
- Every op carries a short note in engineering language: "moved the flow
  reading clear of the alarm banner", never "updated element".

reply is one or two sentences, in the register an engineer uses with another
engineer. Never describe your own reasoning process.`;

/** Field descriptions, shared by both providers' schemas. */
const D = {
  mode: "clarify | build | edit | answer",
  reply: "One or two sentences back to the engineer",
  questions: "Only for clarify: at most two specific questions",
  buildIntent: "Only for build: the engineer's request, in their words",
  ops: "Only for edit: the changes to make, in order",
  op: `One of: ${OP_NAMES.join(", ")}`,
  screen: "Screen name the op applies to. Omit for the active screen",
  target: "Object name the op acts on",
  targets: "Object names, for alignObjects",
  name: "New name, for addScreen / renameScreen / addObject",
  type: `Part type, one of: ${PART_TYPES.join(", ")}`,
  text: "Text for a TextBox, or the label of a new object",
  offText: "Lamp text in the off state",
  onText: "Lamp text in the on state",
  tag: "PLC tag name, exactly as it appears in the variable list",
  property: "Bound property: CurrentValue for a display, VariableName for an alarm",
  left: "X in screen units",
  top: "Y in screen units",
  width: "Width in screen units",
  height: "Height in screen units",
  fontSize: "Point size",
  bold: "Whether the text is bold",
  decimals: "Decimal digits on a numeric display",
  colorRole: "Which colour to set: fill, border or text",
  color: `Palette colour, one of: ${COLOR_NAMES.join(", ")}`,
  mode2: `Alignment, one of: ${ALIGN_MODES.join(", ")}`,
  message: "Alarm message",
  severity: "Alarm severity, 1 to 9",
  alarmType: "1 HiHi, 2 Hi, 3 Lo, 4 LoLo",
  alarmKind: "1 for a bit alarm, 2 for a level alarm",
  value: "Level alarm setpoint, as a string",
  note: "One line of engineering language describing what this op did",
} as const;

function geminiSchema() {
  const S = (description: string) => ({ type: "STRING", description });
  const N = (description: string) => ({ type: "NUMBER", description });
  const B = (description: string) => ({ type: "BOOLEAN", description });

  return {
    type: "OBJECT",
    properties: {
      mode: { type: "STRING", enum: ["clarify", "build", "edit", "answer"], description: D.mode },
      reply: S(D.reply),
      questions: { type: "ARRAY", items: { type: "STRING" }, description: D.questions },
      buildIntent: S(D.buildIntent),
      ops: {
        type: "ARRAY",
        description: D.ops,
        items: {
          type: "OBJECT",
          properties: {
            op: { type: "STRING", enum: [...OP_NAMES], description: D.op },
            screen: S(D.screen),
            target: S(D.target),
            targets: { type: "ARRAY", items: { type: "STRING" }, description: D.targets },
            name: S(D.name),
            type: { type: "STRING", enum: [...PART_TYPES], description: D.type },
            text: S(D.text),
            offText: S(D.offText),
            onText: S(D.onText),
            tag: S(D.tag),
            property: S(D.property),
            left: N(D.left),
            top: N(D.top),
            width: N(D.width),
            height: N(D.height),
            fontSize: N(D.fontSize),
            bold: B(D.bold),
            decimals: N(D.decimals),
            colorRole: { type: "STRING", enum: ["fill", "border", "text"], description: D.colorRole },
            color: { type: "STRING", enum: [...COLOR_NAMES], description: D.color },
            mode: { type: "STRING", enum: [...ALIGN_MODES], description: D.mode2 },
            message: S(D.message),
            severity: N(D.severity),
            alarmType: N(D.alarmType),
            alarmKind: N(D.alarmKind),
            value: S(D.value),
            note: S(D.note),
          },
          required: ["op", "note"],
          propertyOrdering: ["op", "screen", "target", "name", "type", "note"],
        },
      },
    },
    required: ["mode", "reply"],
    propertyOrdering: ["mode", "reply", "questions", "buildIntent", "ops"],
  };
}

/** Anthropic takes JSON Schema, which is a different dialect, not a variant. */
const JSON_SCHEMA = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["clarify", "build", "edit", "answer"], description: D.mode },
    reply: { type: "string", description: D.reply },
    questions: { type: "array", items: { type: "string" }, description: D.questions },
    buildIntent: { type: "string", description: D.buildIntent },
    ops: {
      type: "array",
      description: D.ops,
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: [...OP_NAMES] },
          screen: { type: "string" },
          target: { type: "string" },
          targets: { type: "array", items: { type: "string" } },
          name: { type: "string" },
          type: { type: "string", enum: [...PART_TYPES] },
          text: { type: "string" },
          offText: { type: "string" },
          onText: { type: "string" },
          tag: { type: "string" },
          property: { type: "string" },
          left: { type: "number" },
          top: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
          fontSize: { type: "number" },
          bold: { type: "boolean" },
          decimals: { type: "number" },
          colorRole: { type: "string", enum: ["fill", "border", "text"] },
          color: { type: "string", enum: [...COLOR_NAMES] },
          mode: { type: "string", enum: [...ALIGN_MODES] },
          message: { type: "string" },
          severity: { type: "number" },
          alarmType: { type: "number" },
          alarmKind: { type: "number" },
          value: { type: "string" },
          note: { type: "string", description: D.note },
        },
        required: ["op", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["mode", "reply"],
  additionalProperties: false,
} as const;

const env = (name: string) => process.env[name]?.trim() || undefined;

export interface ConverseInput {
  /** Oldest first. The current request is the last user message. */
  history: { role: "user" | "assistant"; text: string }[];
  digest: ProjectDigest;
}

function prompt({ history, digest }: ConverseInput): string {
  const screens = digest.screens
    .map(
      (s) =>
        `- ${s.name}${s.active ? " (the one on screen now)" : ""}: ` +
        (s.objects.length === 0
          ? "empty"
          : s.objects
              .map((o) => `${o.name}[${o.type} ${o.left},${o.top} ${o.width}x${o.height}]`)
              .join(", ")),
    )
    .join("\n");

  const tags = digest.variables
    .map((v) => `${v.name} (${v.dataType})${v.comment ? ` — ${v.comment}` : ""}`)
    .join("\n");

  const conversation = history
    .map((m) => `${m.role === "user" ? "Engineer" : "You"}: ${m.text}`)
    .join("\n");

  return [
    `Panel: ${digest.target.model}, ${digest.target.width}x${digest.target.height} screen units.`,
    `Project "${digest.name}" has ${digest.screens.length} screen(s):`,
    screens || "- none yet",
    "",
    `PLC tags (${digest.variables.length} shown):`,
    tags || "- none imported",
    "",
    digest.alarms.length
      ? `Alarms: ${digest.alarms.map((a) => `${a.message} on ${a.trigger}`).join("; ")}`
      : "Alarms: none configured",
    digest.bindings.length
      ? `Bindings: ${digest.bindings.map((b) => `${b.tag} -> ${b.target}.${b.property}`).join("; ")}`
      : "Bindings: none",
    digest.selection.length
      ? `Selected right now: ${digest.selection.join(", ")}`
      : "Nothing is selected.",
    "",
    "Conversation so far:",
    conversation,
  ].join("\n");
}

async function withGemini(input: ConverseInput): Promise<Turn | null> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: env("GEMINI_API_KEY")! });

  const response = await ai.models.generateContent({
    model: env("GEMINI_MODEL") ?? "gemini-flash-lite-latest",
    contents: prompt(input),
    config: {
      systemInstruction: SYSTEM,
      responseMimeType: "application/json",
      responseSchema: geminiSchema(),
      temperature: 0.3,
    },
  });

  const text = response.text;
  if (!text) return null;
  try {
    return coerceTurn(JSON.parse(text));
  } catch {
    // Constrained decoding should make this unreachable; if the dialect ever
    // drifts, the caller says so rather than the turn failing silently.
    return null;
  }
}

async function withClaude(input: ConverseInput): Promise<Turn | null> {
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
    messages: [{ role: "user", content: prompt(input) }],
    output_config: { format: jsonSchemaOutputFormat(JSON_SCHEMA) },
  });

  return coerceTurn(response.parsed_output);
}

/** Null when no key is configured, so the caller can say so rather than fail. */
export async function converse(
  input: ConverseInput,
): Promise<{ turn: Turn; provider: Provider } | null> {
  const provider = activeProvider();
  if (!provider) return null;

  const turn = provider === "gemini" ? await withGemini(input) : await withClaude(input);
  if (!turn) return null;
  return { turn, provider };
}
