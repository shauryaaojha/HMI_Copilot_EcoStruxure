/**
 * The tools a model may call while working on a project, and how it picks one.
 *
 * Before this module the conversation had two lookups, find_tags and
 * find_objects, offered only to Claude and described in a sentence each. A
 * model choosing between tools chooses from their descriptions, so this module
 * treats the description as the interface: every tool says what it returns,
 * when to call it, and - as importantly - when not to, and the selection rules
 * are written out once (`TOOL_GUIDE`) instead of being left to inference.
 *
 * Three properties hold for every tool, and are tested:
 *
 * - **Deterministic and offline.** A tool reads the project, the machine
 *   library or the knowledge base; it never calls a model or the network, so
 *   the same call on the same project gives the same answer and a transcript
 *   can be replayed.
 * - **Read-only.** Tools inform a turn; they never change the project. Changes
 *   are ops (lib/ai/ops.ts), which go through the same store actions as the
 *   toolbar. A tool that wrote would be an edit nobody approved.
 * - **Bounded output.** Every result is capped, so one call cannot flood the
 *   context with a 1,248-tag list.
 *
 * And the model is not the only caller. `routeTools` reads the request and
 * runs the lookups it obviously needs - the equipment it names, the class it
 * asks to add, the precedent for a tag it wants bound - before any model sees
 * it. That is what makes the right tool get used even on a provider without
 * tool calling, and on a turn where the model would have skipped it.
 *
 * Pure: no Node, no SDK. The browser imports lib/ai/converse.ts, which imports
 * this; knowledge-base records are handed in by the server route.
 */

import { findObjects, findTags, type ObjectEntry } from "./retrieve";
import { inferEquipment, type InferredEquipment, type StructureHint } from "./infer";
import { MACHINE_CLASSES, machineClass, words } from "@/lib/library/machines";
import { aggregate, exampleScreens, precedentFor, type Conventions } from "@/lib/knowledge/conventions";
import type { ProjectKnowledge } from "@/lib/knowledge/scan";
import type { Variable } from "@/lib/ote/schema";

export interface ToolContext {
  tags: { name: string; dataType: string; comment: string }[];
  objects: ObjectEntry[];
  structure?: StructureHint[];
  /** Finished projects, when the server has a knowledge base. */
  knowledge?: ProjectKnowledge[];
  /** The part types the target format can write (lib/backend). */
  targetParts?: readonly string[];
  targetName?: string;
}

/** A context with its derived values computed once. */
export interface PreparedContext extends ToolContext {
  equipment: InferredEquipment[];
  conventions: Conventions | null;
}

export function prepare(ctx: ToolContext): PreparedContext {
  const variables: Variable[] = ctx.tags.map((t) => ({
    Name: t.name,
    DataType: t.dataType as Variable["DataType"],
    Comments: t.comment,
    DeviceAddress: "",
  }));
  return {
    ...ctx,
    equipment: inferEquipment(variables, ctx.structure),
    conventions: ctx.knowledge?.length ? aggregate(ctx.knowledge) : null,
  };
}

/** JSON Schema as the strict tool contract wants it: closed, every field required. */
interface Schema {
  type: "object";
  properties: Record<string, { type: string; description: string; items?: { type: string } }>;
  required: string[];
  additionalProperties: false;
  [key: string]: unknown;
}

export interface ToolSpec {
  name: string;
  /** What it returns. */
  does: string;
  /** When to call it. */
  when: string;
  /** When not to - the half that stops a model reaching for the wrong one. */
  not: string;
  schema: Schema;
  run(input: Record<string, unknown>, ctx: PreparedContext): string;
}

const MAX_LINES = 25;
const cap = (lines: string[], none: string): string[] =>
  lines.length === 0 ? [none] : lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `... and ${lines.length - MAX_LINES} more; narrow the query`] : lines;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function findUnit(ctx: PreparedContext, id: string): InferredEquipment | undefined {
  const want = id.trim().toLowerCase();
  const loose = want.replace(/[^a-z0-9]/g, "");
  return ctx.equipment.find(
    (u) => u.id.toLowerCase() === want || u.label.toLowerCase() === want || u.id.replace(/[^a-z0-9]/gi, "").toLowerCase() === loose,
  );
}

function describeClass(id: string): string[] {
  const c = machineClass(id);
  if (!c) return [];
  return [
    `${c.name} (${c.id}), ISA-88 ${c.level}${c.packml ? ", PackML state model" : ""}: ${c.description}`,
    `Faceplate leads with: ${c.headline.join(", ") || "-"}. Trend: ${c.trends.join(", ") || "nothing by default"}.`,
    `Roles: ${c.roles.map((r) => `${r.role} [${r.kind}${r.unit ? `, ${r.unit}` : ""}] spelled ${r.spellings.slice(0, 4).join("/")}`).join("; ")}`,
    ...c.alarms.map((a) => `Standard alarm: "${a.message}" on ${a.role} (${a.on}), ${a.priority} priority. Consequence: ${a.consequence}. Operator action: ${a.action}.`),
  ];
}

export const TOOLS: readonly ToolSpec[] = [
  {
    name: "find_tags",
    does: "Searches the project's full PLC tag list by words in the tag name or comment; returns up to 25 tags with type and comment.",
    when: "The request names a signal (a reading, a fault, a command) that is not among the tags you were shown.",
    not: "To list everything, or to learn what a tag means - the comment in the result is all there is. Never invent a tag name instead of searching.",
    schema: { type: "object", properties: { query: { type: "string", description: "Words from the request, e.g. 'backwash high level'" } }, required: ["query"], additionalProperties: false },
    run(input, ctx) {
      const variables = ctx.tags.map((t) => ({ Name: t.name, DataType: t.dataType as Variable["DataType"], Comments: t.comment, DeviceAddress: "" }));
      const hits = findTags(variables, str(input.query));
      return cap(hits.map((v) => `${v.Name} (${v.DataType})${v.Comments ? ` - ${v.Comments}` : ""}`), "no tags match").join("\n");
    },
  },
  {
    name: "find_objects",
    does: "Searches every object on every screen by name, type or bound tag; returns handles you can use in ops.",
    when: "The request refers to an object (a lamp, a reading, a card) that is not on the active screen.",
    not: "For objects already listed on the active screen - use their handles directly. Not for tags; use find_tags.",
    schema: { type: "object", properties: { query: { type: "string", description: "Words from the request, e.g. 'dosing pump fault lamp'" } }, required: ["query"], additionalProperties: false },
    run(input, ctx) {
      const hits = findObjects(ctx.objects, str(input.query));
      return cap(hits.map((o) => `${o.handle} ${o.name} [${o.type}, on ${o.screen}${o.tag ? `, shows ${o.tag}` : ""}]`), "no objects match").join("\n");
    },
  },
  {
    name: "get_equipment",
    does: "Returns one piece of equipment as inferred from the tags: its class, every tag with its role, how sure the classification is and why, and the class's standard alarms.",
    when: "Before addEquipment, before adding alarms for a unit, or when the engineer asks what a unit has. Use the id or label from the equipment list.",
    not: "To find equipment by a vague description - read the equipment list in the context first. Not for a class in general; use machine_class.",
    schema: { type: "object", properties: { id: { type: "string", description: "Equipment id or label, e.g. 'PMP_101' or 'Pump 101'" } }, required: ["id"], additionalProperties: false },
    run(input, ctx) {
      const unit = findUnit(ctx, str(input.id));
      if (!unit) {
        const ids = ctx.equipment.slice(0, 15).map((u) => u.id).join(", ");
        return `no equipment called "${str(input.id)}". Known: ${ids || "none"}`;
      }
      const head = `${unit.id}: ${unit.kind} "${unit.label}"${unit.ddt ? `, declared as DDT ${unit.ddt}` : ""}` +
        (unit.confidence !== undefined ? `, confidence ${unit.confidence}${unit.evidence?.length ? ` (${unit.evidence.join("; ")})` : ""}` : "");
      const roles = unit.roles.map((r) => `  ${r.tag} = ${r.role} (${r.dataType})${r.comment ? ` - ${r.comment}` : ""}`);
      const klass = machineClass(unit.kind);
      const alarms = klass ? klass.alarms.map((a) => `  standard alarm: "${a.message.replace("{label}", unit.label)}" on ${a.role}, ${a.priority} priority`) : [];
      return [head, ...roles, ...alarms].join("\n");
    },
  },
  {
    name: "machine_class",
    does: "Returns what a kind of machine is in the library: its roles and how PLCs spell them, what its faceplate leads with, what to trend, and its standard alarms with ISA-18.2 priority, consequence and operator action.",
    when: "Adding a machine, a faceplate or alarms for a kind of equipment; or when the engineer asks what a pump/valve/filler should show. Pass the kind; an unknown kind returns the list of kinds.",
    not: "For a specific unit in this project - use get_equipment, which also knows its tags.",
    schema: { type: "object", properties: { kind: { type: "string", description: "Class id or plain name: 'pump', 'control valve', 'filler', 'ahu'" } }, required: ["kind"], additionalProperties: false },
    run(input) {
      const want = str(input.kind).trim().toLowerCase().replace(/\s+/g, "-");
      const c = MACHINE_CLASSES.find((k) => k.id === want || k.name.toLowerCase() === str(input.kind).trim().toLowerCase() || k.id.replace(/-/g, "") === want.replace(/-/g, ""));
      if (!c) return `no class "${str(input.kind)}". Classes: ${MACHINE_CLASSES.map((k) => k.id).join(", ")}`;
      return describeClass(c.id).join("\n");
    },
  },
  {
    name: "binding_precedent",
    does: "Returns how finished projects in the knowledge base bound tags like this one: which part type and property, how often, in how many projects.",
    when: "Before bindTag or addObject for a tag, when it is not obvious which part should show it (a count, a mode, a position, a bit that is not run or fault).",
    not: "For run and fault bits shown as lamps, or readings shown as numbers - those are settled. An empty answer means no precedent, not 'do not bind'.",
    schema: { type: "object", properties: { tag: { type: "string", description: "The tag name exactly, e.g. 'VLV_202_POS'" } }, required: ["tag"], additionalProperties: false },
    run(input, ctx) {
      if (!ctx.conventions) return "the knowledge base is empty on this machine; no precedent available";
      const tag = str(input.tag);
      const dataType = ctx.tags.find((t) => t.name.toLowerCase() === tag.toLowerCase())?.dataType;
      const p = precedentFor(ctx.conventions, tag, dataType);
      if (!p) return `no precedent for ${tag} in ${ctx.conventions.projects} scanned projects`;
      return [
        `By ${p.by === "role" ? `tag word ${p.key}` : `data type ${p.key}`}, across ${ctx.conventions.projects} scanned projects:`,
        ...p.ranked.map((r) => `  ${r.target}: ${r.count} bindings in ${r.projects} project${r.projects === 1 ? "" : "s"} (${Math.round(r.share * 100)}%)`),
      ].join("\n");
    },
  },
  {
    name: "example_screens",
    does: "Lists screens from finished projects in the knowledge base that use the given part types and contain the given kinds of equipment, with their object counts.",
    when: "Planning a new screen or a layout an engineer has not described in detail, to see how finished projects did it.",
    not: "For this project's own screens - they are in the context. Not a template to copy: the result describes, it does not place.",
    schema: {
      type: "object",
      properties: {
        partTypes: { type: "array", items: { type: "string" }, description: "Part types the screen must use, e.g. ['Lamp','NumericDisplay']; may be empty" },
        equipment: { type: "array", items: { type: "string" }, description: "Equipment kinds the project must contain, e.g. ['pump','tank']; may be empty" },
      },
      required: ["partTypes", "equipment"],
      additionalProperties: false,
    },
    run(input, ctx) {
      if (!ctx.knowledge?.length) return "the knowledge base is empty on this machine";
      const hits = exampleScreens(ctx.knowledge, { partTypes: list(input.partTypes), equipment: list(input.equipment) });
      return cap(
        hits.map((h) => `${h.project} / ${h.screen}: ${h.objects} objects, ${h.bound} bound; ${Object.entries(h.types).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, n]) => `${n} ${t}`).join(", ")}`),
        "no finished screen matches",
      ).join("\n");
    },
  },
  {
    name: "target_capabilities",
    does: "Says which part types the project's target format can write, and whether a given one is among them.",
    when: "Before adding a part type that is not Rectangle, TextBox, Lamp or NumericDisplay, or when the engineer asks whether something can be exported.",
    not: "To ask how a part looks - the part list in the system prompt covers that.",
    schema: { type: "object", properties: { partType: { type: "string", description: "A part type to check, or an empty string for the full list" } }, required: ["partType"], additionalProperties: false },
    run(input, ctx) {
      const parts = ctx.targetParts ?? [];
      const target = ctx.targetName ?? "the target";
      const want = str(input.partType).trim();
      if (!want) return `${target} can write: ${parts.join(", ") || "unknown"}`;
      const ok = parts.some((p) => p.toLowerCase() === want.toLowerCase());
      return ok ? `${want}: yes, ${target} writes it` : `${want}: no - ${target} cannot write it. It writes: ${parts.join(", ")}`;
    },
  },
];

const byName = new Map(TOOLS.map((t) => [t.name, t]));

/** Run one call. Unknown tools and bad inputs answer as text, never throw. */
export function runTool(name: string, input: unknown, ctx: PreparedContext): { text: string; isError: boolean } {
  const tool = byName.get(name);
  if (!tool) return { text: `no tool called ${name}. Tools: ${TOOLS.map((t) => t.name).join(", ")}`, isError: true };
  const args = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const missing = tool.schema.required.filter((k) => args[k] === undefined);
  if (missing.length) return { text: `${name} needs ${missing.join(", ")}`, isError: true };
  try {
    return { text: tool.run(args, ctx), isError: false };
  } catch (error) {
    return { text: `${name} failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
  }
}

/** One tool's description as a model reads it. */
export const describeTool = (t: ToolSpec) => `${t.does} Use when: ${t.when} Do not use: ${t.not}`;

/** The selection rules, once, for the system prompt of any provider. */
export const TOOL_GUIDE = [
  "Tools are read-only lookups. They never change the project; ops do.",
  "Pick by what you are missing:",
  "- a tag you were not shown -> find_tags",
  "- an object not on the active screen -> find_objects",
  "- what one unit in this project has (tags, roles, standard alarms) -> get_equipment",
  "- what a kind of machine should have (faceplate, trends, alarms) -> machine_class",
  "- which part should show an unusual tag -> binding_precedent",
  "- how finished projects lay out a screen like this -> example_screens",
  "- whether the target can write a part type -> target_capabilities",
  "Call nothing when the context already has the answer. Never guess a tag, object or equipment name: look it up.",
].join("\n");

/* ------------------------------------------------------------------ routing */

export interface RoutedCall {
  name: string;
  input: Record<string, unknown>;
  /** Why the router chose it, for the build log. */
  why: string;
}

/** Plain-language class names, longest first so "control valve" beats "valve". */
const CLASS_WORDS: [string, string][] = MACHINE_CLASSES.flatMap((c): [string, string][] => [
  [c.name.toLowerCase().replace(/\s*\(.*\)$/, ""), c.id],
  [c.id.replace(/-/g, " "), c.id],
]).sort((a, b) => b[0].length - a[0].length);

/**
 * The lookups a request obviously needs, decided without a model.
 *
 * Conservative by design: a call is routed only on an explicit signal - an
 * equipment id or label said outright, a class named next to a verb that adds
 * or asks about it, a tag named next to a verb that binds or shows it. At most
 * six calls, deduplicated. What the router does not catch, the model can still
 * ask for.
 */
export function routeTools(request: string, ctx: PreparedContext): RoutedCall[] {
  const text = request.toLowerCase();
  const calls: RoutedCall[] = [];
  const seen = new Set<string>();
  const add = (c: RoutedCall) => {
    const key = `${c.name}:${JSON.stringify(c.input)}`;
    if (seen.has(key) || calls.length >= 6) return;
    seen.add(key);
    calls.push(c);
  };
  const said = (needle: string) => new RegExp(`(^|[^a-z0-9_])${needle.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z0-9_])`).test(text);

  // Equipment said by id or label.
  for (const u of ctx.equipment) {
    if (said(u.id) || said(u.label)) add({ name: "get_equipment", input: { id: u.id }, why: `the request names ${u.label}` });
  }

  // A class named with intent to add it, or to ask what it should have.
  if (/\b(add|create|build|new|faceplate|what should|standard|alarms? for|template)\b/.test(text)) {
    const taken: string[] = [];
    for (const [phrase, id] of CLASS_WORDS) {
      if (taken.some((t) => t.includes(phrase))) continue;
      if (said(phrase) || said(`${phrase}s`)) {
        taken.push(phrase);
        add({ name: "machine_class", input: { kind: id }, why: `the request asks about a ${phrase}` });
      }
    }
  }

  // A tag said outright, with a verb that puts it on a screen.
  if (ctx.conventions && /\b(bind|show|display|connect|wire|link|indicate)\b/.test(text)) {
    for (const t of ctx.tags) if (said(t.name)) add({ name: "binding_precedent", input: { tag: t.name }, why: `the request binds ${t.name}` });
  }

  // A part type the target may not write.
  if (ctx.targetParts?.length && /\b(add|insert|use|place|put)\b/.test(text)) {
    for (const p of ["Trend", "TrendGraph", "BlockTrend", "BarScale", "Pipe", "DateTimeDisplay", "ToggleSwitch", "N-StateLamp"]) {
      if (said(p) && !ctx.targetParts.includes(p)) add({ name: "target_capabilities", input: { partType: p }, why: `${p} may not be writable` });
    }
  }

  // Words that look like tag fragments the context may not show.
  const fragments = words(request).filter((w) => w.length >= 2 && /\d/.test(request) && ctx.tags.length > 80);
  if (fragments.length && /\b(tag|signal|reading|value|fault|alarm|level|flow|pressure|temperature)\b/.test(text)) {
    add({ name: "find_tags", input: { query: request.slice(0, 120) }, why: "the request names a signal and the tag list is long" });
  }
  return calls;
}

/** Run the routed calls and render them as context lines for any provider. */
export function routedContext(request: string, ctx: PreparedContext): { lines: string[]; calls: RoutedCall[] } {
  const calls = routeTools(request, ctx);
  const lines = calls.map((c) => {
    const r = runTool(c.name, c.input, ctx);
    return `Looked up ${c.name}(${Object.values(c.input).map((v) => JSON.stringify(v)).join(", ")}) because ${c.why}:\n${r.text}`;
  });
  return { lines, calls };
}
