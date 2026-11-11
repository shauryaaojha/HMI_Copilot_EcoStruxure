/**
 * The chat as an agent: a tool-calling loop on Gemini, ending in one turn.
 *
 * The single-call chat (converse.ts, `withGemini`) saw only what was put in
 * front of it - the active screen and the lookups the router guessed - and
 * answered once, blind to what its ops would do. This loop gives the model
 * the same kind of tools the MCP connector gives Claude, and lets it use them
 * until it is sure:
 *
 *   find_tags, get_equipment, kb_search, ...   the lookup registry (tools.ts)
 *   get_screen        any screen's objects, regions, room and overlaps
 *   try_ops           run ops on a draft of the project, see what landed
 *   render_screen     look at a screen of the draft as a picture
 *   validate          the app's own checks on the draft
 *   finish            the turn: mode, reply, ops - the only way out
 *
 * Nothing it does touches the project. `try_ops` works on a draft copy held
 * here for the length of the request, and the turn it finishes with goes back
 * to the browser, which dry-runs it again and commits or proposes it exactly
 * as before. So the loop changes how well a turn is worked out, never what a
 * turn is allowed to do.
 *
 * Function calling is forced (mode ANY): every step is a tool call, and the
 * answer is the arguments of `finish`, so there is no free text to parse.
 */

import type { Content, FunctionDeclaration, Part } from "@google/genai";
import { coerceTurn, type Op, type Turn } from "@/core/ops";
import { docOf } from "@/lib/collab/changes";
import { dryRunToDoc } from "@/lib/collab/proposal";
import type { Doc } from "@/lib/collab/types";
import { screenToPng } from "@/lib/critic/render";
import { rootBox, type Screen } from "@/lib/ote/schema";
import { packageInputOf } from "@/lib/collab/package";
import { validateInput } from "@/lib/server/validate";
import {
  REPAIR_NOTE,
  SYSTEM,
  describeOp,
  digestOf,
  geminiSchema,
  projectContext,
  recordText,
  routedLines,
  splitHistory,
  toolContext,
  volatileContext,
  type ConverseInput,
  type ConverseResult,
  type Usage,
} from "./converse";
import { TOOLS, describeTool, runTool } from "./tools";

/** Model steps before the loop asks for an answer with what it has. */
const MAX_STEPS = 10;
/** Characters of one tool result the model is shown. */
const RESULT_MAX = 6_000;

/** One thing the loop did, for the chat to show under the answer. */
export interface AgentStep {
  tool: string;
  /** One line: what it asked and what came back. */
  summary: string;
  isError?: boolean;
}

export interface AgentChatInput extends ConverseInput {
  /** The whole project as the browser holds it; the draft starts from this. */
  doc: Doc;
}

export interface AgentChatResult extends ConverseResult {
  steps: AgentStep[];
}

const AGENT_GUIDE = `
You work in steps. Every step is one or more tool calls; you end the turn by
calling finish, and only finish. You cannot write free text.

How to work:
- Read before you change. The context shows the active screen; get_screen shows
  any other. Use the lookup tools for tags, equipment, standards and examples
  instead of guessing names.
- For an edit, call try_ops with the ops you intend. It runs them on a draft of
  the project and tells you what landed, what was refused and why, and what
  overlaps now. Fix what was refused and try again. The draft keeps your last
  successful try, so render_screen and validate see the result.
- When the change is about layout or look, call render_screen on the screen you
  changed and look at the picture before you finish.
- Then call finish with the turn. For an edit, its ops are the full list that
  should run against the project as it was at the start of this turn - the
  same ops you last tried, not only the fix.
- Questions about the project: look it up, then finish with mode answer.
- Do not loop: two failed tries at the same thing means finish and say what
  could not be done.
`.trim();

/** The extra tools of the loop, beside the lookup registry. */
const LOOP_TOOLS: FunctionDeclaration[] = [
  {
    name: "get_screen",
    description:
      "One screen of the project, in the same form as the active screen in your context: its objects by handle with type, region and bound tag, the room left on it, its layout facts and its overlaps. Use it before changing a screen that is not the active one.",
    parametersJsonSchema: {
      type: "object",
      properties: { screen: { type: "string", description: "Screen handle (s2) or name." } },
      required: ["screen"],
    },
  },
  {
    name: "try_ops",
    description:
      "Runs ops on a draft copy of the project, never on the project itself, and reports per op what landed, what was refused and why, the objects created and renamed, and the overlaps on the screen afterwards. A try with nothing refused becomes the draft that render_screen and validate look at.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        ops: { type: "array", items: { type: "object" }, description: "Ops, in the same form finish takes them." },
        screen: { type: "string", description: "Screen handle the ops default to. Optional." },
      },
      required: ["ops"],
    },
  },
  {
    name: "render_screen",
    description:
      "Draws one screen of the current draft as a picture, exactly as the canvas draws it, so you can see the layout: spacing, overlaps, alignment, what reads as a header. Returns the image.",
    parametersJsonSchema: {
      type: "object",
      properties: { screen: { type: "string", description: "Screen handle (s2) or name. Defaults to the active screen." } },
    },
  },
  {
    name: "validate",
    description:
      "Runs the app's design-time checks on the current draft - naming, binding integrity, type mismatch, completeness, standards - and returns the findings.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
];

/** The lookup registry, as Gemini takes it. */
const LOOKUP_DECLARATIONS: FunctionDeclaration[] = TOOLS.map((t) => ({
  name: t.name,
  description: describeTool(t),
  parametersJsonSchema: t.schema,
}));

/**
 * finish: the turn, with the same schema the single-call chat answered in.
 * Built on first use rather than at import, so importing this module (the
 * chat route does) costs nothing until a loop runs.
 */
let finishDeclaration: FunctionDeclaration | undefined;
const FINISH = () =>
  (finishDeclaration ??= {
    name: "finish",
    description: "Ends the turn with your answer: the mode, the reply to the engineer, and for an edit the ops. Call it exactly once, last.",
    // The same object the single-call chat passes as its responseSchema.
    parameters: geminiSchema() as FunctionDeclaration["parameters"],
  });

/**
 * How long Gemini asked us to wait after a 429, in ms, or null when the error
 * is something else. A free-tier key allows a handful of requests a minute,
 * and a loop spends several a turn, so waiting it out is the normal case.
 */
function retryAfter(error: unknown): number | null {
  const status = (error as { status?: number })?.status;
  if (status !== 429) return null;
  const text = error instanceof Error ? error.message : String(error);
  // A daily quota does not come back in seconds; waiting only burns the
  // function's time. The route falls back to another model instead.
  if (/PerDay|per day/i.test(text)) return null;
  const seconds = Number(/retry in ([\d.]+)s/i.exec(text)?.[1] ?? /"retryDelay":"(\d+)s"/.exec(text)?.[1] ?? 20);
  return Math.ceil(Math.min(Math.max(seconds, 1), 40) * 1000);
}

/** Waits are capped per turn, so one turn cannot sit out the whole function limit. */
const WAIT_BUDGET_MS = 150_000;

const cut = (text: string, max = RESULT_MAX) => (text.length > max ? `${text.slice(0, max)}\n... (cut at ${max} characters)` : text);

/** A screen of a doc by handle, name or id. */
function screenIn(doc: Doc, ref: unknown, fallback?: string): Screen | undefined {
  const want = typeof ref === "string" && ref.trim() ? ref.trim().toLowerCase() : undefined;
  if (!want) return doc.screens.find((s) => s.UniqueId === fallback) ?? doc.screens[0];
  return doc.screens.find(
    (s) => s.UniqueId.toLowerCase() === want || s.Name.toLowerCase() === want || (doc.handles?.[s.UniqueId] ?? "").toLowerCase() === want,
  );
}

/** The digest of one screen of a doc, the way the context block writes the active one. */
function screenBlock(doc: Doc, screen: Screen, input: AgentChatInput): string {
  const digest = digestOf({
    name: doc.name,
    target: doc.target,
    screens: doc.screens,
    foreign: doc.foreign,
    activeScreenId: screen.UniqueId,
    variables: doc.variables,
    alarms: doc.alarms,
    bindings: doc.bindings,
    selectedIds: [],
    handles: doc.handles ?? {},
    structure: input.structure,
    objectMeta: doc.objectMeta,
  });
  // The tag list is the context's job; a screen is its objects and its room.
  return volatileContext(digest).split("\nTags relevant")[0];
}

/** Everything the loop holds for one request. */
class Session {
  /** The project as the last clean try left it. */
  draft: Doc;
  /** The ops behind the draft, so finish can be checked against them. */
  tried: Op[] = [];
  steps: AgentStep[] = [];

  constructor(readonly input: AgentChatInput) {
    this.draft = docOf(input.doc);
  }

  /** The screen the engineer has open, by the handle the digest names it with. */
  private activeId() {
    const handle = this.input.digest.screens.find((d) => d.active)?.handle;
    return this.input.doc.screens.find((s) => handle && this.input.doc.handles?.[s.UniqueId] === handle)?.UniqueId;
  }

  /** Runs one call; returns what the model reads, and an image when there is one. */
  async run(name: string, args: Record<string, unknown>): Promise<{ text: string; image?: Uint8Array; isError?: boolean }> {
    if (name === "get_screen") {
      const screen = screenIn(this.draft, args.screen);
      if (!screen) return { text: `No screen "${String(args.screen)}". Screens: ${this.draft.screens.map((s) => `${this.draft.handles?.[s.UniqueId] ?? "?"} ${s.Name}`).join(", ")}`, isError: true };
      return { text: screenBlock(this.draft, screen, this.input) };
    }

    if (name === "try_ops") {
      // The same cleaning finish gets: a raw op from the model can miss a
      // field the store assumes is there.
      const ops = (coerceTurn({ mode: "edit", reply: "", ops: Array.isArray(args.ops) ? args.ops : [] })?.ops ?? []) as Op[];
      if (ops.length === 0) return { text: "No usable ops given. Each op needs at least op and what it applies to, as finish takes them.", isError: true };
      // Against the project as it was at the start of the turn: finish sends
      // the whole list, and that is what the browser will run.
      const screen = screenIn(this.input.doc, args.screen, this.activeId());
      const run = dryRunToDoc(this.input.doc, ops, screen?.UniqueId);
      const o = run.outcome;
      const lines = [
        ...o.applied.map((l) => `done: ${l}`),
        ...o.rejected.map((r) => `refused: ${describeOp(r.op)} - ${r.reason}`),
        ...o.created.map((c) => `created: ${c.handle} ${c.name} (${c.type}) on ${c.screen}`),
        ...o.renamed.map((r) => `renamed: asked "${r.asked}", became "${r.became}" (${r.handle})`),
      ];
      if (o.rejected.length === 0) {
        this.draft = run.after;
        this.tried = ops;
      }
      const touched = screen ? screenIn(run.after, screen.UniqueId) : undefined;
      const overlaps = touched ? (screenBlock(run.after, touched, this.input).match(/Overlaps on it:([\s\S]*?)(\nObjects on it:|$)/)?.[1] ?? "").trim() : "";
      return {
        text: [
          `${o.applied.length} applied, ${o.rejected.length} refused.${o.rejected.length === 0 ? " This is now the draft." : " The draft is unchanged; fix the refused ops and try the whole list again."}`,
          ...lines,
          overlaps ? `Overlaps afterwards: ${overlaps}` : "",
        ].filter(Boolean).join("\n"),
        isError: o.rejected.length > 0 && o.applied.length === 0,
      };
    }

    if (name === "render_screen") {
      const screen = screenIn(this.draft, args.screen, this.activeId());
      if (!screen) return { text: `No screen "${String(args.screen)}".`, isError: true };
      const size = rootBox(screen.Children[0], { width: this.draft.target.width, height: this.draft.target.height });
      // Small enough to keep the request light; large enough to judge a layout.
      const scale = Math.min(1, 900 / Math.max(size.width, size.height, 1));
      const image = await screenToPng(screen, this.draft.foreign?.[screen.UniqueId], scale, {
        contents: this.draft.screens,
        contentForeign: this.draft.foreign,
        panel: { width: this.draft.target.width, height: this.draft.target.height },
      });
      return { text: `Screen ${this.draft.handles?.[screen.UniqueId] ?? "?"} "${screen.Name}", ${size.width}x${size.height}, as the draft stands${this.tried.length ? " after your last clean try" : ""}.`, image };
    }

    if (name === "validate") {
      const { findings, summary } = await validateInput(packageInputOf(this.draft));
      const lines = findings.slice(0, 40).map((f) => `[${f.severity}] ${f.rule}: ${f.message}${f.suggestion ? ` -> ${f.suggestion}` : ""}`);
      return { text: [`${summary.all} findings: ${summary.errors} errors, ${summary.warnings} warnings.`, ...lines].join("\n") };
    }

    const lookup = runTool(name, args, toolContext(this.input));
    return { text: lookup.text, isError: lookup.isError };
  }
}

/** One line for the chat, from a call and its answer. */
function summarise(name: string, args: Record<string, unknown>, text: string): string {
  const first = text.split("\n")[0].slice(0, 140);
  const arg = Object.values(args).find((v) => typeof v === "string") as string | undefined;
  if (name === "try_ops") return `Tried ${Array.isArray(args.ops) ? args.ops.length : 0} op(s): ${first}`;
  if (name === "render_screen") return `Looked at ${arg ?? "the active screen"}`;
  if (name === "get_screen") return `Read screen ${arg ?? ""}`.trim();
  if (name === "validate") return `Checked the draft: ${first}`;
  return `${name}${arg ? `(${arg.slice(0, 60)})` : ""}: ${first}`;
}

export async function agentChat(input: AgentChatInput, model: string): Promise<AgentChatResult | null> {
  const { GoogleGenAI, FunctionCallingConfigMode } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!.trim() });
  const session = new Session(input);
  const usage: Usage = { input: 0, cached: 0, output: 0 };
  const { anchor, recent } = splitHistory(input.history);
  const routed = routedLines(input, toolContext(input));

  const contents: Content[] = [
    {
      role: "user",
      parts: [
        {
          text:
            projectContext(input.digest) +
            "\n\n" +
            volatileContext(input.digest) +
            (routed.length ? `\n\n${routed.join("\n\n")}` : "") +
            (anchor ? `\n\n${anchor}` : ""),
        },
      ],
    },
  ];
  for (const item of recent) {
    contents.push(item.role === "user" ? { role: "user", parts: [{ text: item.text }] } : { role: "model", parts: [{ text: recordText(item) }] });
  }
  if (input.repair) contents.push({ role: "user", parts: [{ text: REPAIR_NOTE }] });

  const declarations = [...LOOKUP_DECLARATIONS, ...LOOP_TOOLS, FINISH()];
  /** Whether the answer's ops were already checked once against a refusal. */
  let checkedFinish = false;
  let waited = 0;

  /** One model call, waiting out a rate limit while the turn's budget lasts. */
  const call = async (params: Parameters<typeof ai.models.generateContent>[0]) => {
    for (;;) {
      try {
        return await ai.models.generateContent(params);
      } catch (error) {
        const wait = retryAfter(error);
        if (wait === null || waited + wait > WAIT_BUDGET_MS) throw error;
        waited += wait;
        session.steps.push({ tool: "wait", summary: `Rate limited by Gemini; waited ${Math.round(wait / 1000)} s`, isError: true });
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  };

  for (let step = 0; step <= MAX_STEPS; step++) {
    // Out of waiting time with work done: answer with what it has rather than fail.
    const last = step === MAX_STEPS || (waited > WAIT_BUDGET_MS * 0.6 && step > 0);
    const response = await call({
      model,
      contents,
      config: {
        systemInstruction: `${SYSTEM}\n\n${AGENT_GUIDE}`,
        tools: [{ functionDeclarations: last ? [FINISH()] : declarations }],
        toolConfig: {
          functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, ...(last ? { allowedFunctionNames: ["finish"] } : {}) },
        },
        temperature: 0.2,
      },
    });
    const u = response.usageMetadata;
    if (u) {
      usage.input += u.promptTokenCount ?? 0;
      usage.cached += u.cachedContentTokenCount ?? 0;
      usage.output += (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
    }
    const said = response.candidates?.[0]?.content;
    const calls = response.functionCalls ?? [];
    if (!said || calls.length === 0) {
      // Forced calling makes this rare; one nudge, then give up cleanly.
      if (step === MAX_STEPS) return null;
      contents.push({ role: "user", parts: [{ text: "Call a tool, or finish." }] });
      continue;
    }
    // The model's own content goes back verbatim: it carries the thought
    // signatures Gemini needs to keep reasoning across tool calls.
    contents.push(said);

    const finish = calls.find((c) => c.name === "finish");
    if (finish) {
      const turn = coerceTurn(finish.args ?? {});
      if (!turn) {
        contents.push({ role: "user", parts: [{ functionResponse: { id: finish.id, name: "finish", response: { error: "That turn did not match the schema. Call finish again with mode and reply set." } } }] });
        continue;
      }
      // An edit is checked once more here, so a refused op is fixed in the
      // loop rather than in a second round trip from the browser.
      if (turn.mode === "edit" && turn.ops?.length && !checkedFinish && !last) {
        checkedFinish = true;
        const check = await session.run("try_ops", { ops: turn.ops });
        if (/^\d+ applied, [1-9]/.test(check.text)) {
          session.steps.push({ tool: "finish", summary: `Checked the answer: ${check.text.split("\n")[0]}`, isError: true });
          contents.push({
            role: "user",
            parts: [{ functionResponse: { id: finish.id, name: "finish", response: { output: `Not finished: some of these ops are refused.\n${cut(check.text)}\nFix them and call finish again with the whole list.` } } }],
          });
          continue;
        }
      }
      return { turn: turn as Turn, provider: "gemini", model, usage, steps: session.steps };
    }

    const replies: Part[] = [];
    for (const call of calls) {
      const name = call.name ?? "";
      const args = (call.args ?? {}) as Record<string, unknown>;
      let result: { text: string; image?: Uint8Array; isError?: boolean };
      try {
        result = await session.run(name, args);
      } catch (error) {
        result = { text: `${name} failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
      session.steps.push({ tool: name, summary: summarise(name, args, result.text), ...(result.isError ? { isError: true } : {}) });
      replies.push({
        functionResponse: {
          id: call.id,
          name,
          response: result.isError ? { error: cut(result.text) } : { output: cut(result.text) },
          ...(result.image ? { parts: [{ inlineData: { mimeType: "image/png", data: Buffer.from(result.image).toString("base64") } }] } : {}),
        },
      });
    }
    contents.push({ role: "user", parts: replies });
  }
  return null;
}
