/**
 * Which model answers, decided by configuration and never by which key
 * happens to be lying around.
 *
 * The demo chose Gemini whenever its key was set, before it looked for Claude.
 * The Gemini model configured was Flash Lite, so every conversational turn ran
 * on the smallest model available and nobody had chosen that. This module
 * makes the choice explicit:
 *
 *   AI_PROVIDER=claude | gemini | none   the provider, stated
 *   AI_MODEL=<model id>                  optional override of the default model
 *
 * With AI_PROVIDER unset, a Claude key selects Claude. A Gemini key on its own
 * selects nothing - Gemini is available, but only by asking for it - and the
 * reason is returned so the UI can say so instead of silently degrading.
 *
 * docs/LLD.md §2 F1.
 */

export type Provider = "gemini" | "claude";

export interface ProviderChoice {
  provider: Provider | null;
  /** The model id to call, when there is a provider. */
  model: string | null;
  /** One sentence for the UI and the build timeline. */
  reason: string;
}

const DEFAULT_MODEL: Record<Provider, string> = {
  claude: "claude-opus-5",
  gemini: "gemini-flash-lite-latest",
};

const env = (name: string) => process.env[name]?.trim() || undefined;

const KEY: Record<Provider, string> = {
  claude: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
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
    reason: `${provider === "claude" ? "Claude" : "Gemini"} (${asked ? "AI_PROVIDER" : "default"})`,
  });

  if (asked === "none") {
    return { provider: null, model: null, reason: "AI_PROVIDER=none: no model is used" };
  }

  if (asked === "claude" || asked === "gemini") {
    if (!env(KEY[asked])) {
      return {
        provider: null,
        model: null,
        reason: `AI_PROVIDER=${asked} but ${KEY[asked]} is not set`,
      };
    }
    return choose(asked);
  }

  if (asked !== undefined) {
    return {
      provider: null,
      model: null,
      reason: `AI_PROVIDER=${asked} is not one of claude, gemini, none`,
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

export const providerName = (provider: Provider) =>
  provider === "claude" ? "Claude" : "Gemini";
