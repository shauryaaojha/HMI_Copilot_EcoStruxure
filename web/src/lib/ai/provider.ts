/**
 * Which model answers, decided by configuration and never by which key
 * happens to be lying around.
 *
 * The demo chose Gemini whenever its key was set, before it looked for Claude.
 * The Gemini model configured was Flash Lite, so every conversational turn ran
 * on the smallest model available and nobody had chosen that. This module
 * makes the choice explicit:
 *
 *   AI_PROVIDER=claude | gemini | openai | none   the provider, stated
 *   AI_MODEL=<model id>                           optional override of the default model
 *
 * With AI_PROVIDER unset, a Claude key selects Claude. A Gemini key on its own
 * selects nothing - Gemini is available, but only by asking for it - and the
 * reason is returned so the UI can say so instead of silently degrading.
 *
 * `openai` is any endpoint that speaks the Chat Completions dialect (lib/ai/
 * openai.ts): OPENAI_BASE_URL says which, OPENAI_API_KEY opens it, and the
 * model id is whatever that gateway lists. It is how GLM, Qwen, DeepSeek or
 * Opus-through-a-gateway are used, and it needs both variables: the SDK's
 * own default URL would send a GLM model id to OpenAI.
 *
 * docs/LLD.md §2 F1.
 */

export type Provider = "gemini" | "claude" | "openai";

export interface ProviderChoice {
  provider: Provider | null;
  /** The model id to call, when there is a provider. */
  model: string | null;
  /** One sentence for the UI and the build timeline. */
  reason: string;
}

const DEFAULT_MODEL: Record<Provider, string> = {
  // Claude Opus 5.5, the current Opus. Its effort defaults to medium rather
  // than Opus 5's high, so every call site states its effort explicitly.
  claude: "claude-opus-5-5",
  // Gemini 3.8 Flash: fast enough for the chat's tool-calling loop, and
  // able to read the screens it renders. Checked against the model list.
  gemini: "gemini-3.8-flash",
  // GLM-5.3-Flash: passed every loop check through a gateway (tools, parallel
  // calls, a picture, json_schema) at a tenth of Gemini Flash's price.
  openai: "z-ai/glm-5.3-flash",
};

const env = (name: string) => process.env[name]?.trim() || undefined;

const KEY: Record<Provider, string> = {
  claude: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
};

export function resolveProvider(): ProviderChoice {
  const asked = env("AI_PROVIDER")?.toLowerCase();
  const override = env("AI_MODEL");

  const choose = (provider: Provider): ProviderChoice => ({
    provider,
    model:
      override ??
      (provider === "gemini" ? env("GEMINI_MODEL") : undefined) ??
      DEFAULT_MODEL[provider],
    reason: `${providerName(provider)} (${asked ? "AI_PROVIDER" : "default"})`,
  });

  if (asked === "none") {
    return { provider: null, model: null, reason: "AI_PROVIDER=none: no model is used" };
  }

  if (asked === "claude" || asked === "gemini" || asked === "openai") {
    if (!env(KEY[asked])) {
      return {
        provider: null,
        model: null,
        reason: `AI_PROVIDER=${asked} but ${KEY[asked]} is not set`,
      };
    }
    if (asked === "openai" && !env("OPENAI_BASE_URL")) {
      return { provider: null, model: null, reason: "AI_PROVIDER=openai but OPENAI_BASE_URL is not set (the gateway's endpoint)" };
    }
    return choose(asked);
  }

  if (asked !== undefined) {
    return {
      provider: null,
      model: null,
      reason: `AI_PROVIDER=${asked} is not one of claude, gemini, openai, none`,
    };
  }

  if (env(KEY.claude)) return choose("claude");

  if (env(KEY.gemini)) {
    return {
      provider: null,
      model: null,
      reason:
        "A Gemini key is set but AI_PROVIDER is not. Set AI_PROVIDER=gemini to use it, " +
        "or set ANTHROPIC_API_KEY for Claude.",
    };
  }

  return { provider: null, model: null, reason: "No model key is configured" };
}

/** The provider in use, or null. Kept as the one-word form the pipeline logs. */
export const activeProvider = (): Provider | null => resolveProvider().provider;

export const hasApiKey = (): boolean => activeProvider() !== null;

/** For the gateway, the host the key talks to ("aicredits.in"), because "OpenAI" would be untrue. */
export const providerName = (provider: Provider): string => {
  if (provider === "claude") return "Claude";
  if (provider === "gemini") return "Gemini";
  try {
    return new URL(env("OPENAI_BASE_URL") ?? "").hostname.replace(/^api\./, "") || "the gateway";
  } catch {
    return "the gateway";
  }
};
