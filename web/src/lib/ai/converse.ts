/**
 * The conversation: reading what the engineer wants, turn after turn.
 *
 * plan.ts answers one question - "what should this screen contain?" - once,
 * from a tag list. This answers a different one: "given the project as it
 * stands and everything that has happened so far, what happens next?"
 *
 *   clarify    the request is genuinely ambiguous; ask the specific thing missing
 *   build      lay out an application from the tag list - only on an empty project
 *   extend     add screens or equipment to the application as it stands
 *   startOver  discard the screens and begin again; the client confirms first
 *   edit       a list of operations against the project as it stands
 *   answer     a question about the project, changing nothing
 *
 * What the model sees is built in layers (docs/LLD.md §3.2): a stable system
 * prompt; a project context block that changes only when the project's
 * structure does, and is cached; a volatile block for the active screen; then
 * the history as real turns, where the assistant side is the *record of what
 * happened* - applied, rejected, renamed - and not the sentence it said.
 *
 * Positions are never in the context. Objects are named by handle and region,
 * and an op places by slot. The layout engine does the geometry.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { Alarm, Screen, Variable } from "@/lib/ote/schema";
import { regionOf, regionsOf, roomReport } from "@/lib/ote/regions";
import { ALIGN_MODES, COLOR_NAMES, OP_NAMES, coerceTurn, type Op, type Turn } from "./ops";
import { PART_TYPES } from "@/lib/ote/schema";
import { REGIONS, SIDES } from "@/lib/ote/regions";
import { inferEquipment } from "./infer";
import { findObjects, findTags, relevantTags, type ObjectEntry } from "./retrieve";
import { resolveProvider, type Provider } from "./provider";
import { isUnnamed } from "./name";

export type { Provider } from "./provider";

/* ---------------------------------------------------------------------- */
/* The digest                                                              */
/* ---------------------------------------------------------------------- */

export interface ObjectDigest {
  handle: string;
  name: string;
  type: string;
  region: string;
  /** The tag bound to it, when one is. */
  tag?: string;
}

export interface ScreenDigest {
  handle: string;
  name: string;
  active: boolean;
  objectCount: number;
  /** Equipment ids whose faceplate or tile is on this screen. */
  equipment: string[];
  /** Only for the active screen: every object, by handle. */
  objects?: ObjectDigest[];
  /** Only for the active screen: what still fits, per region. */
  room?: string;
}

export interface EquipmentDigest {
  id: string;
  kind: string;
  label: string;
  roles: string[];
  /** Screen handle it is placed on, if any. */
  on?: string;
}

/** What the model is told about the project. Handles and regions, not the tree. */
export interface ProjectDigest {
  name: string;
  unnamed?: boolean;
  target: { model: string; width: number; height: number };
  active?: string;
  screens: ScreenDigest[];
  equipment: EquipmentDigest[];
  /** The retrieved subset, not the whole list. */
  variables: { name: string; dataType: string; comment: string }[];
  variableCount: number;
  alarms: { message: string; trigger: string }[];
  /** Bindings on the active screen only; the rest are on the objects. */
  bindings: { tag: string; target: string; property: string }[];
  /** "o12 Lamp_PMP101_RUN" for each selected object. */
  selection: string[];
  /**
   * A hash of the structural layers, so a caller can tell whether the cached
   * context is still valid without diffing the whole thing.
   */
  structureHash: string;
}

const cardKey = (id: string) => id.replace(/[^A-Za-z0-9]/g, "");

function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export interface DigestSource {
  name: string;
  target: { model: string; width: number; height: number };
  screens: Screen[];
  activeScreenId?: string;
  variables: Variable[];
  alarms: Alarm[];
  bindings: { tag: string; targetId: string; targetName: string; property: string }[];
  selectedIds: string[];
  handles: Record<string, string>;
}

/** Built from the store. `request` steers which tags are retrieved. */
export function digestOf(project: DigestSource, request = ""): ProjectDigest {
  const h = (id: string) => project.handles[id] ?? "?";
  const active =
    project.screens.find((s) => s.UniqueId === project.activeScreenId) ?? project.screens[0];
  const boundTo = new Map(project.bindings.map((b) => [b.targetId, b.tag]));
  const equipment = inferEquipment(project.variables);

  const screens: ScreenDigest[] = project.screens.map((screen) => {
    const parts = screen.Children[0].Children;
    const names = new Set(parts.map((p) => p.Name));
    const placed = equipment
      .filter((u) => names.has(`Card_${cardKey(u.id)}`) || names.has(`Tile_${cardKey(u.id)}`))
      .map((u) => u.id);
    const isActive = screen.UniqueId === active?.UniqueId;
    const digest: ScreenDigest = {
      handle: h(screen.UniqueId),
      name: screen.Name,
      active: isActive,
      objectCount: parts.length,
      equipment: placed,
    };
    if (isActive) {
      const panel = { width: screen.Children[0].Width, height: screen.Children[0].Height };
      const regions = regionsOf(parts, panel);
      digest.objects = parts.map((p) => ({
        handle: h(p.UniqueId),
        name: p.Name,
        type: p.Type,
        region: regionOf(p, regions),
        tag: boundTo.get(p.UniqueId),
      }));
      digest.room = roomReport(parts, panel);
    }
    return digest;
  });

  const placedOn = new Map<string, string>();
  for (const s of screens) for (const id of s.equipment) placedOn.set(id, s.handle);

  const activeIds = new Set(active?.Children[0].Children.map((p) => p.UniqueId) ?? []);
  const pinned = project.bindings.filter((b) => activeIds.has(b.targetId)).map((b) => b.tag);
  const retrieved = relevantTags(project.variables, request, { pinned, limit: 80 });

  const equipmentDigest: EquipmentDigest[] = equipment.map((u) => ({
    id: u.id,
    kind: u.kind,
    label: u.label,
    roles: u.roles.map((r) => r.role),
    on: placedOn.get(u.id),
  }));

  const structural = JSON.stringify({
    name: project.name,
    target: project.target,
    screens: screens.map((s) => [s.handle, s.name, s.equipment]),
    equipment: equipmentDigest,
    variableCount: project.variables.length,
  });

  return {
    name: project.name,
    unnamed: isUnnamed(project.name),
    target: project.target,
    active: active ? h(active.UniqueId) : undefined,
    screens,
    equipment: equipmentDigest,
    variables: retrieved.map((v) => ({ name: v.Name, dataType: v.DataType, comment: v.Comments ?? "" })),
    variableCount: project.variables.length,
    alarms: project.alarms.map((a) => ({ message: a.Message, trigger: a.Trigger })),
    bindings: project.bindings
      .filter((b) => activeIds.has(b.targetId))
      .map((b) => ({ tag: b.tag, target: `${h(b.targetId)} ${b.targetName}`, property: b.property })),
    selection: project.selectedIds.map((id) => {
      const part = project.screens.flatMap((s) => s.Children[0].Children).find((p) => p.UniqueId === id);
      return part ? `${h(id)} ${part.Name}` : h(id);
    }),
    structureHash: hash(structural),
  };
}

/* ---------------------------------------------------------------------- */
/* History: what happened, not what was said                              */
/* ---------------------------------------------------------------------- */

/** The record of an assistant turn that the next turn is shown. */
export interface TurnRecord {
  mode: Turn["mode"];
  applied: string[];
  rejected: { op: string; reason: string }[];
  renamed: { asked: string; became: string; handle: string }[];
  /** Whether the turn landed, was shown as a proposal, or was declined. */
  decision?: "committed" | "proposed" | "accepted" | "discarded";
}

export type HistoryItem =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; turn?: TurnRecord };

/** One op, for a rejection line: "addObject Lamp Lamp_A in header". */
export function describeOp(op: Op): string {
  const bits: string[] = [op.op];
  if (op.type) bits.push(op.type);
  if (op.equipment) bits.push(op.equipment);
  if (op.target) bits.push(op.target);
  if (op.name && op.name !== op.target) bits.push(op.name);
  if (op.place?.region) bits.push(`in ${op.place.region}`);
  if (op.place?.anchor) bits.push(`${op.place.side ?? "beside"} ${op.place.anchor}`);
  if (op.tag) bits.push(`tag ${op.tag}`);
  return bits.join(" ");
}

function recordText(item: Extract<HistoryItem, { role: "assistant" }>): string {
  const lines = [item.text.trim() || "(no reply)"];
  const t = item.turn;
  if (!t) return lines[0];
  lines.push(`[mode ${t.mode}${t.decision ? `, ${t.decision}` : ""}]`);
  if (t.applied.length) lines.push(`applied: ${t.applied.join("; ")}`);
  if (t.rejected.length) lines.push(`rejected: ${t.rejected.map((r) => `${r.op} — ${r.reason}`).join("; ")}`);
  if (t.renamed.length) lines.push(`renamed: ${t.renamed.map((r) => `${r.asked} → ${r.became} (${r.handle})`).join("; ")}`);
  return lines.join("\n");
}

/** How many exchanges are kept verbatim; older ones collapse to one line. */
const VERBATIM_TURNS = 8;

/**
 * Older turns as one deterministic line - counts and the last few applied
 * changes - never a model-written summary.
 */
function anchorLine(older: HistoryItem[]): string | null {
  const assistant = older.filter((m): m is Extract<HistoryItem, { role: "assistant" }> => m.role === "assistant");
  if (assistant.length === 0) return null;
  const applied = assistant.flatMap((m) => m.turn?.applied ?? []);
  const rejected = assistant.reduce((n, m) => n + (m.turn?.rejected.length ?? 0), 0);
  const tail = applied.slice(-4).join("; ");
  return `Earlier: ${assistant.length} turn${assistant.length === 1 ? "" : "s"}, ${applied.length} change${applied.length === 1 ? "" : "s"} applied, ${rejected} rejected${tail ? `. Most recent: ${tail}` : ""}.`;
}

/* ---------------------------------------------------------------------- */
/* The prompt                                                              */
/* ---------------------------------------------------------------------- */

const SYSTEM = `You are the HMI Copilot inside EcoStruxure Operator Terminal Expert.
An automation engineer is building operator screens by talking to you, turn
after turn, until the screens are right. You edit a model of the project; the
layout engine does the geometry. You never give coordinates.

Every turn you choose exactly one mode:

- "build"     lay out a whole application from the PLC tag list. ONLY when the
              project has no screens with content. Put the request in buildIntent.
- "extend"    the project already has screens and they want more screens or
              more equipment laid out - "now do the dosing skid", "add an
              overview". Put the request in buildIntent. Never "build" here.
- "edit"      change the project as it stands. Emit ops.
- "startOver" they clearly want to discard what exists and begin again.
- "clarify"   the request cannot be acted on without guessing. Ask at most two
              specific questions in questions[].
- "answer"    a question about the project. Explain, change nothing.

If you are told the project has no name yet, set projectName as well.

When to clarify, and when not to:
- Do NOT clarify to confirm something you can reasonably assume. Assume, act,
  and say what you assumed in reply.
- Do NOT ask for colours, sizes, fonts or positions. Choose sensible ones.
- DO clarify when the request names something that is not in the project or
  the tag list, when it could mean two different objects or screens, or when
  it would delete work and you cannot tell which.

Addressing things:
- Every screen and object has a handle: s1, s2 for screens, o12, o13 for
  objects. Use the handle in every op field that names a thing. Names are
  shown beside handles for reading; handles are what you write.
- Tags are different from objects. A lamp o17 shows tag PMP_101_RUN. bindTag
  takes the object's handle and the tag's name.
- Give every addObject a name and refer to it by that name in later ops of the
  same turn; you will be told its handle in the outcome next turn.

Placing things - never by coordinate:
- place.region: header, nav, body, alarms, footer. The first free spot there.
- place.anchor + place.side: beside an object - rightOf, leftOf, below, above,
  inside. "inside" puts it within a card or panel.
- No place at all means the body.
- If a region is full you are told so in the room line. Then ask for a new
  screen (addScreen) or say what to remove; do not move other things to make
  room unless the engineer asked for that.
- moveObject takes a place too. Give left/top only when the engineer typed
  numbers.

Equipment: use addEquipment with the unit id from the equipment list. One op
places a whole faceplate - panel, name, lamps, readings, all bound. Never build
a faceplate out of Rectangle, TextBox and Lamp ops.

Ops:
- Only the ops in the schema exist. Only the part types listed exist.
- Every op carries a short note in engineering language: "moved the flow
  reading clear of the alarm banner", never "updated element".
- The outcome of your previous turns is in the history: what applied, what was
  rejected and why, what was renamed. Trust it over what you remember saying.
  A rejected op did not happen.

Screen design, when laying out:
- ISA-101: a plant overview above unit overviews above detail screens.
  Navigation and the alarm banner in the same place on every screen.
- Colour is a signal, not decoration.

reply is one or two sentences, in the register an engineer uses with another
engineer. Never describe your own reasoning process.`;

const D = {
  mode: "clarify | build | extend | startOver | edit | answer",
  reply: "One or two sentences back to the engineer",
  questions: "Only for clarify: at most two specific questions",
  projectName:
    "Only when told the project is unnamed: two or three words joined by underscores, " +
    "after the plant or area - Boiler_House, Transfer_Pump_Station",
  buildIntent: "Only for build or extend: the engineer's request, in their words",
  ops: "Only for edit: the changes to make, in order",
  op: `One of: ${OP_NAMES.join(", ")}`,
  screen: "Screen handle (s2) the op applies to. Omit for the active screen",
  target: "Object handle (o12) the op acts on",
  targets: "Object handles, for alignObjects, groupObjects and ungroupObjects",
  name: "New name, for addScreen / renameScreen / addObject",
  equipment: "For addEquipment: the unit id from the equipment list - PMP_101",
  type: `Part type, one of: ${PART_TYPES.join(", ")}`,
  place: "Where it goes: a region, or an anchor handle and a side",
  region: `One of: ${REGIONS.join(", ")}`,
  anchor: "Object handle to place relative to",
  side: `One of: ${SIDES.join(", ")}`,
  text: "Text for a TextBox, or the label of a new object",
  offText: "Lamp text in the off state",
  onText: "Lamp text in the on state",
  tag: "PLC tag name, exactly as it appears in the tag list",
  property: "Bound property: CurrentValue for a display, VariableName for an alarm",
  left: "Only for moveObject, only when the engineer typed a number",
  top: "Only for moveObject, only when the engineer typed a number",
  width: "Width in screen units, for resizeObject or a new object",
  height: "Height in screen units, for resizeObject or a new object",
  fontSize: "Point size; on setText, to restyle without relabelling",
  bold: "Whether the text is bold; on setText, to restyle without relabelling",
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
      mode: { type: "STRING", enum: ["clarify", "build", "extend", "startOver", "edit", "answer"], description: D.mode },
      reply: S(D.reply),
      questions: { type: "ARRAY", items: { type: "STRING" }, description: D.questions },
      projectName: S(D.projectName),
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
            equipment: S(D.equipment),
            type: { type: "STRING", enum: [...PART_TYPES], description: D.type },
            place: {
              type: "OBJECT",
              description: D.place,
              properties: {
                region: { type: "STRING", enum: [...REGIONS], description: D.region },
                anchor: S(D.anchor),
                side: { type: "STRING", enum: [...SIDES], description: D.side },
              },
            },
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
          propertyOrdering: ["op", "screen", "target", "name", "type", "place", "note"],
        },
      },
    },
    required: ["mode", "reply"],
    propertyOrdering: ["mode", "reply", "projectName", "questions", "buildIntent", "ops"],
  };
}

/** Anthropic takes JSON Schema, which is a different dialect, not a variant. */
const JSON_SCHEMA = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["clarify", "build", "extend", "startOver", "edit", "answer"], description: D.mode },
    reply: { type: "string", description: D.reply },
    questions: { type: "array", items: { type: "string" }, description: D.questions },
    projectName: { type: "string", description: D.projectName },
    buildIntent: { type: "string", description: D.buildIntent },
    ops: {
      type: "array",
      description: D.ops,
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: [...OP_NAMES] },
          screen: { type: "string", description: D.screen },
          target: { type: "string", description: D.target },
          targets: { type: "array", items: { type: "string" } },
          name: { type: "string" },
          equipment: { type: "string", description: D.equipment },
          type: { type: "string", enum: [...PART_TYPES] },
          place: {
            type: "object",
            description: D.place,
            properties: {
              region: { type: "string", enum: [...REGIONS] },
              anchor: { type: "string", description: D.anchor },
              side: { type: "string", enum: [...SIDES] },
            },
            additionalProperties: false,
          },
          text: { type: "string" },
          offText: { type: "string" },
          onText: { type: "string" },
          tag: { type: "string" },
          property: { type: "string" },
          left: { type: "number", description: D.left },
          top: { type: "number", description: D.top },
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

/**
 * Everything the lookup tools can search. Sent by the client each turn and
 * never put in the prompt - the model asks for what it needs by name.
 * docs/PLAN_PHASE1.md item 5.
 */
export interface Catalog {
  tags: { name: string; dataType: string; comment: string }[];
  objects: ObjectEntry[];
}

export interface ConverseInput {
  /** Oldest first. The current request is the last user message. */
  history: HistoryItem[];
  digest: ProjectDigest;
  /**
   * Set when the previous answer's ops were rejected and this is the one
   * repair pass. The last history item is the assistant record carrying them.
   */
  repair?: boolean;
  catalog?: Catalog;
}

/**
 * The cached block: everything that changes only when the project's
 * structure does. Sorted, no timestamps, no selection.
 */
export function projectContext(digest: ProjectDigest): string {
  const screens = digest.screens
    .map((s) => `- ${s.handle} ${s.name}: ${s.objectCount} objects` + (s.equipment.length ? `, equipment ${s.equipment.join(", ")}` : ""))
    .join("\n");
  const equipment = digest.equipment
    .map((u) => `- ${u.id}: ${u.kind} "${u.label}" [${u.roles.join(", ")}]${u.on ? ` on ${u.on}` : " (not placed)"}`)
    .join("\n");
  return [
    `Panel: ${digest.target.model}, ${digest.target.width}x${digest.target.height} screen units.`,
    digest.unnamed
      ? "This project has no name yet. Set projectName to what it should be called."
      : `The project is called "${digest.name}". Do not rename it.`,
    "",
    `Screens (${digest.screens.length}):`,
    screens || "- none yet",
    "",
    `Equipment inferred from the tag list (${digest.equipment.length} units, ${digest.variableCount} tags in all):`,
    equipment || "- none",
    "",
    digest.alarms.length
      ? `Alarms configured: ${digest.alarms.map((a) => `${a.message} on ${a.trigger}`).join("; ")}`
      : "Alarms: none configured",
  ].join("\n");
}

/** The block that changes every turn: the active screen and what fits. */
export function volatileContext(digest: ProjectDigest): string {
  const active = digest.screens.find((s) => s.active);
  const objects = active?.objects
    ?.map((o) => `${o.handle} ${o.name} [${o.type}, ${o.region}${o.tag ? `, shows ${o.tag}` : ""}]`)
    .join("\n");
  const tags = digest.variables
    .map((v) => `${v.name} (${v.dataType})${v.comment ? ` — ${v.comment}` : ""}`)
    .join("\n");
  return [
    active ? `Active screen: ${active.handle} ${active.name}` : "No active screen.",
    active ? `Room on it: ${active.room}` : "",
    active ? `Objects on it:\n${objects || "- none"}` : "",
    "",
    `Tags relevant to this request (${digest.variables.length} of ${digest.variableCount}; ask for another by name if it is missing):`,
    tags || "- none imported",
    "",
    digest.selection.length ? `Selected right now: ${digest.selection.join(", ")}` : "Nothing is selected.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

const REPAIR_NOTE =
  "Some of your ops were rejected; the reasons are in the record above. Re-issue " +
  "a corrected op list for the same request, using the handles and regions you were " +
  "given. If it genuinely cannot be done, answer and say why.";

/** History split into the verbatim tail and an anchor line for the rest. */
function splitHistory(history: HistoryItem[]) {
  const keep = VERBATIM_TURNS * 2;
  const older = history.length > keep ? history.slice(0, history.length - keep) : [];
  const recent = history.slice(older.length);
  return { anchor: anchorLine(older), recent };
}

/* ---------------------------------------------------------------------- */
/* Providers                                                               */
/* ---------------------------------------------------------------------- */

export interface Usage {
  input: number;
  cached: number;
  output: number;
}

export interface ConverseResult {
  turn: Turn;
  provider: Provider;
  model: string;
  usage?: Usage;
}

async function withGemini(input: ConverseInput, model: string): Promise<ConverseResult | null> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!.trim() });
  const { anchor, recent } = splitHistory(input.history);

  const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [
    {
      role: "user",
      parts: [{ text: projectContext(input.digest) + "\n\n" + volatileContext(input.digest) + (anchor ? `\n\n${anchor}` : "") }],
    },
  ];
  for (const item of recent) {
    contents.push(
      item.role === "user"
        ? { role: "user", parts: [{ text: item.text }] }
        : { role: "model", parts: [{ text: recordText(item) }] },
    );
  }
  if (input.repair) contents.push({ role: "user", parts: [{ text: REPAIR_NOTE }] });

  const response = await ai.models.generateContent({
    model,
    contents,
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
    const turn = coerceTurn(JSON.parse(text));
    if (!turn) return null;
    const u = response.usageMetadata;
    return {
      turn,
      provider: "gemini",
      model,
      usage: u
        ? { input: u.promptTokenCount ?? 0, cached: u.cachedContentTokenCount ?? 0, output: u.candidatesTokenCount ?? 0 }
        : undefined,
    };
  } catch {
    return null;
  }
}

/** At most this many lookups before the turn proceeds with what it has. */
const MAX_LOOKUPS = 4;

const LOOKUP_TOOLS: Anthropic.Tool[] = [
  {
    name: "find_tags",
    description:
      "Search the full PLC tag list by words in the tag name or comment. Use when the " +
      "request names a signal that is not in the tags you were shown.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Words from the request, e.g. 'backwash high level'" } },
      required: ["query"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "find_objects",
    description:
      "Search every object on every screen by name, type or bound tag. Use when the " +
      "request refers to an object that is not on the active screen.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Words from the request, e.g. 'dosing pump fault lamp'" } },
      required: ["query"],
      additionalProperties: false,
    },
    strict: true,
  },
];

const LOOKUP_SYSTEM =
  "You are checking whether an engineer's request refers to anything not already in " +
  "the context you were given. If every tag and object it needs is present, reply with " +
  "the single word READY. Otherwise call find_tags or find_objects with the words from " +
  "the request, then reply READY. Never guess a tag or object name.";

/**
 * The lookup phase: the model asks for what it cannot see, bounded, before the
 * propose call. Returns lines to append to the volatile block. Skipped when
 * there is no catalog.
 */
async function lookup(
  client: InstanceType<typeof import("@anthropic-ai/sdk").default>,
  model: string,
  input: ConverseInput,
  request: string,
): Promise<{ lines: string[]; usage: Usage }> {
  const catalog = input.catalog;
  const usage: Usage = { input: 0, cached: 0, output: 0 };
  if (!catalog) return { lines: [], usage };
  const lines: string[] = [];
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content:
        `${volatileContext(input.digest)}\n\nRequest: "${request}"\n\n` +
        `The full tag list has ${catalog.tags.length} entries and there are ${catalog.objects.length} objects across all screens.`,
    },
  ];
  const variables: Variable[] = catalog.tags.map((t) => ({
    Name: t.name,
    DataType: t.dataType as Variable["DataType"],
    Comments: t.comment,
    DeviceAddress: "",
  }));

  for (let round = 0; round < MAX_LOOKUPS; round++) {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: LOOKUP_SYSTEM,
      tools: LOOKUP_TOOLS,
      tool_choice: { type: "auto" },
      output_config: { effort: "low" },
      messages,
    });
    usage.input += response.usage.input_tokens;
    usage.cached += response.usage.cache_read_input_tokens ?? 0;
    usage.output += response.usage.output_tokens;
    if (response.stop_reason !== "tool_use") break;

    const calls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of calls) {
      const query = String((call.input as { query?: unknown }).query ?? "");
      let text: string;
      if (call.name === "find_tags") {
        const hits = findTags(variables, query);
        text = hits.length
          ? hits.map((v) => `${v.Name} (${v.DataType})${v.Comments ? ` — ${v.Comments}` : ""}`).join("\n")
          : "no tags match";
        if (hits.length) lines.push(`Looked up tags for "${query}":\n${text}`);
      } else {
        const hits = findObjects(catalog.objects, query);
        text = hits.length
          ? hits.map((o) => `${o.handle} ${o.name} [${o.type}, on ${o.screen}${o.tag ? `, shows ${o.tag}` : ""}]`).join("\n")
          : "no objects match";
        if (hits.length) lines.push(`Looked up objects for "${query}":\n${text}`);
      }
      results.push({ type: "tool_result", tool_use_id: call.id, content: text });
    }
    messages.push({ role: "user", content: results });
  }
  return { lines, usage };
}

async function withClaude(input: ConverseInput, model: string): Promise<ConverseResult | null> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { jsonSchemaOutputFormat } = await import("@anthropic-ai/sdk/helpers/json-schema");
  const client = new Anthropic();
  const { anchor, recent } = splitHistory(input.history);

  const request = [...input.history].reverse().find((m) => m.role === "user")?.text ?? "";
  const found = input.repair ? { lines: [], usage: { input: 0, cached: 0, output: 0 } } : await lookup(client, model, input, request);

  // The cached prefix is system + project context. The volatile block sits
  // after the breakpoint, then the history as real turns.
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: projectContext(input.digest),
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
        {
          type: "text",
          text:
            volatileContext(input.digest) +
            (found.lines.length ? `\n\n${found.lines.join("\n\n")}` : "") +
            (anchor ? `\n\n${anchor}` : ""),
        },
      ],
    },
  ];
  for (const item of recent) {
    messages.push(
      item.role === "user"
        ? { role: "user", content: item.text }
        : { role: "assistant", content: recordText(item) },
    );
  }
  if (input.repair) messages.push({ role: "user", content: REPAIR_NOTE });

  const response = await client.messages.parse({
    model,
    max_tokens: 8192,
    thinking: { type: "adaptive" },
    output_config: {
      format: jsonSchemaOutputFormat(JSON_SCHEMA),
      effort: input.repair ? "low" : "medium",
    },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral", ttl: "1h" } }],
    messages,
  });

  if (response.stop_reason === "refusal") return null;
  const turn = coerceTurn(response.parsed_output);
  if (!turn) return null;
  return {
    turn,
    provider: "claude",
    model,
    usage: {
      input: response.usage.input_tokens + found.usage.input,
      cached: (response.usage.cache_read_input_tokens ?? 0) + found.usage.cached,
      output: response.usage.output_tokens + found.usage.output,
    },
  };
}

/** Null when no provider is configured, so the caller can say so rather than fail. */
export async function converse(input: ConverseInput): Promise<ConverseResult | null> {
  const choice = resolveProvider();
  if (!choice.provider || !choice.model) return null;
  return choice.provider === "gemini"
    ? withGemini(input, choice.model)
    : withClaude(input, choice.model);
}
