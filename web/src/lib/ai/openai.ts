/**
 * Any OpenAI-compatible endpoint, as one more provider (AI_PROVIDER=openai).
 *
 * The models that cost a tenth of Gemini Flash (GLM-5.3-Flash, Qwen, DeepSeek)
 * and the ones that cost more (Opus, through the same key) all sit behind
 * endpoints that speak the Chat Completions dialect: Vercel AI Gateway,
 * OpenRouter, AICredits (pays in rupees over UPI), Z.ai itself. One client
 * here, used by every call site, means moving between them is a base URL and
 * a model id, never code.
 *
 *   OPENAI_API_KEY     the key
 *   OPENAI_BASE_URL    the endpoint, e.g. https://api.aicredits.in/v1
 *   AI_MODEL           the model id (default z-ai/glm-5.3-flash)
 *   AI_REASONING       overrides the reasoning effort every call sends:
 *                      low | medium | high, or none to send nothing
 *
 * Checked against api.aicredits.in on 2026-11-11 with GLM-5.3-Flash: tools,
 * tool_choice "required" and by name, parallel calls, reasoning_effort,
 * response_format json_schema, image_url parts, streaming, and cached tokens
 * reported in prompt_tokens_details. A model id the gateway does not have is
 * a 400, never a quiet substitute (another gateway did that, and was dropped).
 */

import OpenAI from "openai";

export type Effort = "low" | "medium" | "high";

const env = (name: string) => process.env[name]?.trim() || undefined;

/** The default when AI_MODEL is unset: the cheapest model that passed the loop checks. */
export const DEFAULT_OPENAI_MODEL = "z-ai/glm-5.3-flash";

export function openaiClient(): OpenAI {
  // The SDK retries 429 and 5xx twice on its own; the loops wait longer on top.
  return new OpenAI({ apiKey: env("OPENAI_API_KEY"), baseURL: env("OPENAI_BASE_URL"), timeout: 120_000, maxRetries: 2 });
}

/** The host the key talks to, for the status bar and the logs: "aicredits.in", not "OpenAI". */
export function gatewayName(): string {
  try {
    return new URL(env("OPENAI_BASE_URL") ?? "").hostname.replace(/^api\./, "") || "the gateway";
  } catch {
    return "the gateway";
  }
}

/**
 * The reasoning hint for one call. A thinking model (GLM-5.3-Flash) decides
 * how much to think; the hint says how hard the step is. The call site states
 * what it needs; AI_REASONING is the operator's override.
 */
export function reasoning(effort: Effort): { reasoning_effort?: Effort } {
  const asked = env("AI_REASONING")?.toLowerCase();
  if (asked === "none") return {};
  if (asked === "low" || asked === "medium" || asked === "high") return { reasoning_effort: asked };
  return { reasoning_effort: effort };
}

/** Claude's effort words (AGENT_EFFORT) in this dialect's three. */
export function effortOf(word: string | undefined, fallback: Effort): Effort {
  const w = word?.toLowerCase();
  if (w === "low" || w === "medium") return w;
  if (w === "high" || w === "xhigh" || w === "max") return "high";
  return fallback;
}

export interface OpenAIUsage {
  input: number;
  cached: number;
  output: number;
}

/** Tokens as the dialect reports them; reasoning tokens are inside completion_tokens. */
export function usageOf(u: OpenAI.CompletionUsage | null | undefined): OpenAIUsage {
  return { input: u?.prompt_tokens ?? 0, cached: u?.prompt_tokens_details?.cached_tokens ?? 0, output: u?.completion_tokens ?? 0 };
}

/** A picture as the dialect takes it: a data URL in a user message. A tool message carries text only. */
export function imagePart(png: Uint8Array): OpenAI.ChatCompletionContentPartImage {
  return { type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.from(png).toString("base64")}` } };
}

/**
 * How long to wait before trying a failed call again, or null when it should
 * not be: the error is not load (429, 5xx) or too many tries went by. The
 * gateway's Retry-After is honoured when it sends one, capped at 40 s.
 */
export function retryWaitMs(error: unknown, attempt: number): number | null {
  const e = error as { status?: number; headers?: { get?: (name: string) => string | null } | Record<string, string> } | null;
  const status = e?.status;
  const busy = status === 429 || status === 500 || status === 502 || status === 503 || status === 529;
  if (!busy || attempt >= 4) return null;
  const h = e?.headers;
  const told = Number(typeof h?.get === "function" ? h.get("retry-after") : (h as Record<string, string> | undefined)?.["retry-after"]);
  const seconds = Number.isFinite(told) && told > 0 ? told + 1 : 2 ** attempt * 3;
  return Math.min(seconds, 40) * 1000;
}

/** One call, waited out while a budget lasts; each wait is reported so the chat can show it. */
export async function withRetry<T>(call: () => Promise<T>, onWait: (ms: number) => void, budgetMs: number): Promise<T> {
  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const wait = retryWaitMs(error, attempt);
      if (wait === null || waited + wait > budgetMs) throw error;
      waited += wait;
      onWait(wait);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

/** A model that wraps its JSON in a code fence still answered. */
const unfence = (text: string) => text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

export interface AskJsonOptions {
  model: string;
  system: string;
  user: string | OpenAI.ChatCompletionContentPart[];
  schema: Record<string, unknown>;
  effort: Effort;
  maxTokens?: number;
}

/**
 * One JSON object matching a schema, or null when the model gave none.
 * response_format json_schema first; a server that refuses the format (400)
 * is asked again with the same schema as one forced tool, which every
 * dialect has. Anything that is not JSON is null: the callers fall back to
 * their rules and say so.
 */
export async function askJsonOpenAI(options: AskJsonOptions): Promise<unknown> {
  const client = openaiClient();
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: options.system },
    { role: "user", content: options.user },
  ];
  const base = { model: options.model, max_tokens: options.maxTokens ?? 8192, temperature: 0.2, messages, ...reasoning(options.effort) };
  const parse = (text: string | null | undefined): unknown => {
    if (!text) return null;
    try {
      return JSON.parse(unfence(text));
    } catch {
      return null;
    }
  };
  try {
    const response = await client.chat.completions.create({
      ...base,
      response_format: { type: "json_schema", json_schema: { name: "answer", schema: options.schema } },
    });
    const choice = response.choices[0];
    if (!choice || choice.finish_reason === "length") return null;
    return parse(choice.message.content);
  } catch (error) {
    if (!(error instanceof OpenAI.APIError) || error.status !== 400) throw error;
    const response = await client.chat.completions.create({
      ...base,
      tools: [{ type: "function", function: { name: "answer", description: "The answer, in the shape asked for.", parameters: options.schema } }],
      tool_choice: { type: "function", function: { name: "answer" } },
    });
    const call = response.choices[0]?.message.tool_calls?.[0];
    return call && call.type === "function" ? parse(call.function.arguments) : null;
  }
}
