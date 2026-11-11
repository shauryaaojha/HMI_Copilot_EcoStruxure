/**
 * The models an engineer can pick in the chat, and what each costs.
 *
 * Why a menu and not a free string: the browser names a model by menu id and
 * the server maps it to a provider and model id it holds a key for. Nobody
 * can steer the account to a model that is not on the list, and the list
 * carries the price beside the name so the pick is made with the number in
 * sight. An id the server does not know falls back to the configured
 * default, never to an error. docs/MODEL_GATEWAY.md.
 */

import { resolveProvider, type Provider, type ProviderChoice } from "./provider";

export interface MenuEntry {
  id: string;
  label: string;
  provider: Provider;
  model: string;
  /** Rupees for one measured agent run (190k in, 0.7k out) at list price, cache not counted. */
  inrPerRun: number;
  note: string;
}

const env = (name: string) => process.env[name]?.trim() || undefined;

/** Through the gateway, in the order the eval ranked them by cost. */
const GATEWAY: Omit<MenuEntry, "provider">[] = [
  { id: "glm", label: "GLM-5.3-Flash", model: "z-ai/glm-5.3-flash", inrPerRun: 1.4, note: "cheapest; thinks before each step" },
  { id: "haiku", label: "Claude Haiku 5.5", model: "anthropic/claude-haiku-5.5", inrPerRun: 1.8, note: "fastest in the eval" },
  { id: "qwen", label: "Qwen3.8-Flash", model: "qwen/qwen3.8-flash", inrPerRun: 2.7, note: "" },
  { id: "gemini", label: "Gemini 3.8 Flash", model: "google/gemini-3.8-flash", inrPerRun: 14, note: "through the gateway" },
];

/** What this installation can offer: only models it holds a key for. */
export function modelMenu(): MenuEntry[] {
  const out: MenuEntry[] = [];
  if (env("OPENAI_API_KEY") && env("OPENAI_BASE_URL")) out.push(...GATEWAY.map((e) => ({ ...e, provider: "openai" as const })));
  if (env("GEMINI_API_KEY")) out.push({ id: "gemini-native", label: "Gemini 3.8 Flash", provider: "gemini", model: "gemini-3.8-flash", inrPerRun: 14, note: "Google key" });
  return out;
}

/** The menu id the configured default corresponds to, or null when it is not on the menu. */
export function defaultMenuId(): string | null {
  const d = resolveProvider();
  return modelMenu().find((e) => e.provider === d.provider && e.model === d.model)?.id ?? null;
}

/** The choice for a menu id, or the configured default when the id is not on the menu. */
export function chooseModel(id: unknown): ProviderChoice {
  const entry = typeof id === "string" ? modelMenu().find((e) => e.id === id) : undefined;
  return entry ? { provider: entry.provider, model: entry.model, reason: `${entry.label} (chosen in the chat)` } : resolveProvider();
}
