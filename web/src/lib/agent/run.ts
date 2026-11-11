/**
 * The agent: a model working in the project's working directory with the
 * tools of lib/agent/tools.ts, turn after turn, until the job is done.
 *
 * The same loop an engineer runs at a terminal: look (summary, screens,
 * objects, the engineer's own objects), change (files, bindings, copies),
 * prove (check, look at the screen), repeat. Every step is yielded, so the
 * API streams it to the chat and the CLI prints it; nothing is hidden.
 *
 * Two providers, chosen as the rest of the app chooses (lib/ai/provider.ts):
 *
 *   claude   streaming Messages API with adaptive thinking and an explicit
 *            effort; the tool list and system prompt are cached, old tool
 *            results are cleared when the context grows, and a declined
 *            request falls back server-side to another model
 *   gemini   function calling, the model's content passed back whole so its
 *            thought signatures survive
 *   openai   any Chat Completions endpoint (lib/ai/openai.ts): GLM, Qwen,
 *            DeepSeek, or Opus through a gateway; reasoning_effort sent, the
 *            assistant message passed back whole so reasoning_content survives
 *
 *   AGENT_MODEL    the model id (default: the provider's, Gemini Flash rather
 *                  than Flash Lite, which is too small for a tool loop; on the
 *                  gateway, AI_MODEL - set it to anthropic/claude-opus-5.5 to
 *                  give the agent Opus while the chat stays on GLM)
 *   AGENT_EFFORT   Claude's effort, default high; the gateway maps it to
 *                  reasoning_effort low | medium | high
 *   AGENT_STEPS    most model turns per request, default 40
 */

import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import type { Kb } from "@/lib/kb";
import { providerName, resolveProvider, type Provider } from "@/lib/ai/provider";
import { TOOLS, availableTools, closeShell, contextFor, inputSchema, runAgentTool, type ToolResult } from "./tools";
import type { Change, Workspace } from "./workspace";

export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; input: unknown; writes: boolean }
  | { type: "result"; id: string; name: string; ok: boolean; summary: string; image?: boolean }
  | { type: "usage"; input: number; output: number; cached: number }
  | { type: "error"; message: string }
  | { type: "done"; text: string; changes: Change[]; steps: number; provider: Provider; model: string; kbVersion?: Kb["version"] };

export interface AgentTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AgentOptions {
  ws: Workspace;
  instruction: string;
  /** Earlier turns of this conversation, as text. */
  history?: AgentTurn[];
  signal?: AbortSignal;
  /** For tests: the provider client is injected rather than built from env. */
  claude?: Pick<Anthropic, "beta">;
  openai?: Pick<OpenAI, "chat">;
}

export const SYSTEM = `You are the HMI Copilot agent. You work inside one EcoStruxure Operator Terminal Expert (OTE) project, opened as a working directory, for a controls engineer. You have tools to read, search and edit its files, to work with its screens, objects, bindings and tags, to check it, to look at a screen, and to run a script in a sandbox. Where the shell tool is offered, a Linux shell with Python holds a copy of the project, for bulk work and analysis.

How the project is made (an .eote is a ZIP; all of it is visible to you except the PLC connection):
- Screens/<id>/Screen.dat is a screen (JSON). Screens/<id>/Metadata.dat holds its number (Id, used by screen switches), Name and Order. Screens/Hierarchy.dat is the screen tree: a master screen's children are shown inside its frame (header, navigation).
- Contents/<id>/Screen.dat is a content screen, shown inside a ContentDisplay on a screen.
- CompoundObjects/<id>/Screen.dat is not a screen: it is the drawing of one Compound Object's definition (root Type "CompoundObject"). The screens are only those list_screens gives.
- An object is a JSON node with Type, UniqueId (a GUID) and Name, nested under Children: grids, groups and canvases hold others. Compound Objects are instances (Type "CompoundObject.<Name>") of definitions under CompoundObjects/<id>/, and expose properties of their own (for example CV).
- Bindings.dat links tags to object properties: Sources (tags), Targets (objects, ObjectType 8), Bindings (TargetProperty, Mode 1 tag to object / 2 both ways, BindingText). Use the bind and unbind tools rather than editing it by hand.
- Tags live in Variables.db; PLC symbols bind by their full path (e.g. MachineExpertEquipment1.Main.Run_CMD).
- Facts that matter: a push button writes its bit through ClickTrigger.Destination (Mode 1); a momentary button has ClickTrigger Operation 10; a screen switch has OperationType 4 and the target screen's number. NumericDisplay digits are FloatDigits and IntegerDigits, its unit is Suffix, and a reading has IsInputModeEnabled false (true makes it an entry box).

How to work:
1. Look before you change: project_summary first, then the screens and objects the request is about. Answer a question from what you find, without changing anything.
2. Copy what the engineer did. The project is the source of truth: own_objects says how it draws a button, a display, an entry; clone_object copies one; bindings shows how they bind. Never invent a field or a format: find an example in the project (search) and follow it.
3. Change as little as the request needs. Take a checkpoint before a large change. To change one field, use json_set with the file and JSON pointer that screen_objects and clone_object give. Objects in a Grid sit in cells (Location Row, Column, spans), not at Left/Top: place them with row and column. Never delete a Screen.dat or a folder to start over; use undo.
4. Prove it: run check after your changes and fix every problem it names. Use view_screen to see a screen you changed when its layout matters.
5. Finish with a short plain answer: what you found or changed, by screen and object, and anything you could not do and why. No code blocks, no JSON.

The PLC connection (DriverConfig.db) is hidden on purpose; never ask for it. You cannot open the project in the OTE editor; say so if the engineer needs that proof.`;

const env = (name: string) => process.env[name]?.trim() || undefined;

/** One model call, at most. */
const CALL_MS = 120_000;

/** What the chat shows for a tool call: the arguments, short. */
function summary(result: ToolResult): string {
  const first = result.text.split("\n").slice(0, 3).join(" | ");
  return first.length > 240 ? `${first.slice(0, 240)}...` : first;
}

export async function* runAgent(options: AgentOptions): AsyncGenerator<AgentEvent> {
  const choice = resolveProvider();
  const provider: Provider | null = options.claude ? "claude" : options.openai ? "openai" : choice.provider;
  if (!provider) {
    yield { type: "error", message: `No model is configured for the agent: ${choice.reason}.` };
    return;
  }
  const model = env("AGENT_MODEL") ?? (provider === "gemini" ? "gemini-flash-latest" : choice.model ?? (provider === "openai" ? "z-ai/glm-5.3-flash" : "claude-opus-5-5"));
  yield { type: "status", message: `${providerName(provider)} (${model}) working in ${options.ws.fileName}` };
  const steps = Number(env("AGENT_STEPS") ?? 40);
  try {
    yield* provider === "claude" ? claudeLoop(options, model, steps) : provider === "openai" ? openaiLoop(options, model, steps) : geminiLoop(options, model, steps);
  } finally {
    // A sandbox the run started is stopped with it, however the run ends.
    await closeShell(options.ws);
  }
}

/* ------------------------------------------------------------------ claude */

async function* claudeLoop(options: AgentOptions, model: string, maxSteps: number): AsyncGenerator<AgentEvent> {
  const client = options.claude ?? new (await import("@anthropic-ai/sdk")).default();
  const ctx = contextFor(options.ws);
  // Sorted and fixed for the whole session: the tool list is the start of the
  // cached prefix, so it must not change between turns.
  const tools: Anthropic.Beta.BetaToolUnion[] = availableTools().map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: inputSchema(t),
    eager_input_streaming: true,
  }));
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...(options.history ?? []).map((h) => ({ role: h.role, content: h.text })),
    { role: "user", content: options.instruction },
  ];
  let finalText = "";
  let jsonRetries = 0;

  for (let step = 1; step <= maxSteps; step++) {
    if (options.signal?.aborted) break;
    const stream = client.beta.messages.stream({
      model,
      max_tokens: 32_000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools,
      messages,
      cache_control: { type: "ephemeral" },
      thinking: { type: "adaptive" },
      output_config: { effort: (env("AGENT_EFFORT") as "low" | "medium" | "high" | "xhigh" | "max" | undefined) ?? "high" },
      context_management: {
        edits: [{ type: "clear_tool_uses_20250919", trigger: { type: "input_tokens", value: 120_000 }, keep: { type: "tool_uses", value: 12 } }],
      },
      fallbacks: "default",
      betas: ["context-management-2025-06-27", "server-side-fallback-2026-07-01"],
    }, { signal: options.signal });

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (e) {
      const { APIError } = await import("@anthropic-ai/sdk");
      if (e instanceof APIError || jsonRetries++ >= 2) {
        yield { type: "error", message: `The model call failed: ${(e as Error).message}` };
        return;
      }
      continue;
    }
    const u = message.usage;
    yield { type: "usage", input: u.input_tokens, output: u.output_tokens, cached: u.cache_read_input_tokens ?? 0 };

    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    if (text) {
      finalText = text;
      yield { type: "text", text };
    }
    if (message.stop_reason === "refusal") {
      yield { type: "error", message: "The model declined this request." };
      break;
    }
    const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    if (calls.length === 0) break;
    if (message.stop_reason === "max_tokens") {
      yield { type: "error", message: "A tool call was cut off at the output limit; ask for a smaller step." };
      break;
    }

    messages.push({ role: "assistant", content: message.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      const tool = TOOLS.find((t) => t.name === call.name);
      yield { type: "tool", id: call.id, name: call.name, input: call.input, writes: Boolean(tool?.writes) };
      const r = await runAgentTool(ctx, call.name, call.input);
      yield { type: "result", id: call.id, name: call.name, ok: !r.isError, summary: summary(r), image: Boolean(r.image) };
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        ...(r.isError ? { is_error: true } : {}),
        content: r.image
          ? [{ type: "text", text: r.text }, { type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from(r.image).toString("base64") } }]
          : r.text,
      });
    }
    // Every result of one turn in one message, as the API expects.
    messages.push({ role: "user", content: results });
    if (step === maxSteps) yield { type: "error", message: `Stopped after ${maxSteps} steps; say "continue" to go on.` };
  }
  yield { type: "done", text: finalText, changes: options.ws.changes(), steps: messages.length, provider: "claude", model, kbVersion: ctx.kb?.version };
}

/* ------------------------------------------------------------------ gemini */

async function* geminiLoop(options: AgentOptions, model: string, maxSteps: number): AsyncGenerator<AgentEvent> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: env("GEMINI_API_KEY")! });
  const ctx = contextFor(options.ws);
  type Part = Record<string, unknown>;
  type Content = { role: "user" | "model"; parts: Part[] };
  const contents: Content[] = [
    ...(options.history ?? []).map((h): Content => ({ role: h.role === "user" ? "user" : "model", parts: [{ text: h.text }] })),
    { role: "user", parts: [{ text: options.instruction }] },
  ];
  const declarations = availableTools().map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: inputSchema(t) }));
  let finalText = "";

  for (let step = 1; step <= maxSteps; step++) {
    if (options.signal?.aborted) break;
    let response;
    // Gemini answers 503 and 429 under load; a short wait usually clears it.
    for (let attempt = 0; ; attempt++) {
      try {
        response = await ai.models.generateContent({
          model,
          contents: contents as never,
          // A call that hangs under load is given up on and tried again.
          config: {
            systemInstruction: SYSTEM,
            tools: [{ functionDeclarations: declarations as never }],
            abortSignal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(CALL_MS)]) : AbortSignal.timeout(CALL_MS),
          },
        });
        break;
      } catch (e) {
        if (options.signal?.aborted) return;
        const busy = /\b(503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|aborted|timeout)\b/i.test(`${(e as Error).name} ${(e as Error).message}`);
        if (!busy || attempt >= 3) {
          yield { type: "error", message: `The model call failed: ${(e as Error).message.slice(0, 300)}` };
          return;
        }
        // A quota error says how long to wait ("retryDelay": "37s"); a daily quota cannot be waited out.
        const message = (e as Error).message;
        if (/PerDay/i.test(message)) {
          yield { type: "error", message: "The model's daily free quota is used up; try again tomorrow or set another key." };
          return;
        }
        const told = Number(/retryDelay\W+(\d+(?:\.\d+)?)s/i.exec(message)?.[1]);
        const wait = Math.min(Number.isFinite(told) ? told + 1 : 2 ** attempt * 3, 65);
        yield { type: "status", message: `Gemini is busy; trying again in ${Math.round(wait)} s` };
        await new Promise((r) => setTimeout(r, wait * 1000));
      }
    }
    const um = response.usageMetadata;
    if (um) yield { type: "usage", input: um.promptTokenCount ?? 0, output: um.candidatesTokenCount ?? 0, cached: um.cachedContentTokenCount ?? 0 };

    const content = response.candidates?.[0]?.content as Content | undefined;
    if (!content?.parts?.length) {
      yield { type: "error", message: `The model returned nothing (${response.candidates?.[0]?.finishReason ?? "no candidate"}).` };
      break;
    }
    contents.push({ role: "model", parts: content.parts });
    const text = content.parts.flatMap((p) => (typeof p.text === "string" && !p.thought ? [p.text] : [])).join("\n").trim();
    if (text) {
      finalText = text;
      yield { type: "text", text };
    }
    const calls = content.parts.flatMap((p) => (p.functionCall ? [p.functionCall as { id?: string; name: string; args?: unknown }] : []));
    if (calls.length === 0) break;

    const replies: Part[] = [];
    const images: Part[] = [];
    for (const [n, call] of calls.entries()) {
      const id = call.id ?? `${step}-${n}`;
      const tool = TOOLS.find((t) => t.name === call.name);
      yield { type: "tool", id, name: call.name, input: call.args ?? {}, writes: Boolean(tool?.writes) };
      const r = await runAgentTool(ctx, call.name, call.args ?? {});
      yield { type: "result", id, name: call.name, ok: !r.isError, summary: summary(r), image: Boolean(r.image) };
      replies.push({ functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response: r.isError ? { error: r.text } : { output: r.text } } });
      if (r.image) images.push({ inlineData: { mimeType: "image/png", data: Buffer.from(r.image).toString("base64") } });
    }
    contents.push({ role: "user", parts: [...replies, ...images] });
    if (step === maxSteps) yield { type: "error", message: `Stopped after ${maxSteps} steps; say "continue" to go on.` };
  }
  yield { type: "done", text: finalText, changes: options.ws.changes(), steps: contents.length, provider: "gemini", model, kbVersion: ctx.kb?.version };
}

/* ------------------------------------------------------------------ openai */

async function* openaiLoop(options: AgentOptions, model: string, maxSteps: number): AsyncGenerator<AgentEvent> {
  const { openaiClient, reasoning, usageOf, retryWaitMs, imagePart, effortOf, gatewayName } = await import("@/lib/ai/openai");
  const client = options.openai ?? openaiClient();
  const ctx = contextFor(options.ws);
  const tools: OpenAI.ChatCompletionTool[] = availableTools().map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: inputSchema(t) as Record<string, unknown> },
  }));
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM },
    ...(options.history ?? []).map((h): OpenAI.ChatCompletionMessageParam => ({ role: h.role, content: h.text })),
    { role: "user", content: options.instruction },
  ];
  const effort = reasoning(effortOf(env("AGENT_EFFORT"), "high"));
  let finalText = "";

  for (let step = 1; step <= maxSteps; step++) {
    if (options.signal?.aborted) break;
    let response: OpenAI.ChatCompletion;
    // The gateway answers 429 and 5xx under load; a short wait usually clears it.
    for (let attempt = 0; ; attempt++) {
      try {
        response = await client.chat.completions.create(
          { model, messages, tools, max_tokens: 16_000, ...effort },
          { signal: options.signal, timeout: CALL_MS },
        );
        break;
      } catch (e) {
        if (options.signal?.aborted) return;
        const wait = retryWaitMs(e, attempt);
        if (wait === null) {
          yield { type: "error", message: `The model call failed: ${(e as Error).message.slice(0, 300)}` };
          return;
        }
        yield { type: "status", message: `${gatewayName()} is busy; trying again in ${Math.round(wait / 1000)} s` };
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    const u = usageOf(response.usage);
    yield { type: "usage", input: u.input, output: u.output, cached: u.cached };

    const choice = response.choices[0];
    const said = choice?.message;
    if (!said) {
      yield { type: "error", message: `The model returned nothing (${choice?.finish_reason ?? "no choice"}).` };
      break;
    }
    // Whole, so a thinking model's reasoning_content goes back with its calls.
    messages.push(said as OpenAI.ChatCompletionMessageParam);
    const text = (said.content ?? "").trim();
    if (text) {
      finalText = text;
      yield { type: "text", text };
    }
    const calls = (said.tool_calls ?? []).filter((c): c is OpenAI.ChatCompletionMessageFunctionToolCall => c.type === "function");
    if (calls.length === 0) break;
    if (choice.finish_reason === "length") {
      yield { type: "error", message: "A tool call was cut off at the output limit; ask for a smaller step." };
      break;
    }

    const images: OpenAI.ChatCompletionContentPart[] = [];
    for (const call of calls) {
      const tool = TOOLS.find((t) => t.name === call.function.name);
      let input: unknown;
      try {
        input = JSON.parse(call.function.arguments || "{}");
      } catch {
        yield { type: "tool", id: call.id, name: call.function.name, input: call.function.arguments, writes: Boolean(tool?.writes) };
        yield { type: "result", id: call.id, name: call.function.name, ok: false, summary: "the arguments were not valid JSON" };
        messages.push({ role: "tool", tool_call_id: call.id, content: "Error: the arguments were not valid JSON. Send the call again." });
        continue;
      }
      yield { type: "tool", id: call.id, name: call.function.name, input, writes: Boolean(tool?.writes) };
      const r = await runAgentTool(ctx, call.function.name, input);
      yield { type: "result", id: call.id, name: call.function.name, ok: !r.isError, summary: summary(r), image: Boolean(r.image) };
      messages.push({ role: "tool", tool_call_id: call.id, content: r.isError ? `Error: ${r.text}` : r.text });
      if (r.image) images.push(imagePart(r.image));
    }
    // A tool message carries text only in this dialect; the picture follows as the user.
    if (images.length) messages.push({ role: "user", content: [{ type: "text", text: "The picture view_screen returned:" }, ...images] });
    if (step === maxSteps) yield { type: "error", message: `Stopped after ${maxSteps} steps; say "continue" to go on.` };
  }
  yield { type: "done", text: finalText, changes: options.ws.changes(), steps: messages.length, provider: "openai", model, kbVersion: ctx.kb?.version };
}
