/**
 * The model menu (lib/ai/menu.ts): only models the installation holds a key
 * for are offered, a pick maps to a provider and model id, and an unknown
 * pick falls back to the configured default rather than failing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseModel, defaultMenuId, modelMenu } from "@/lib/ai/menu";
import { GET as providerGet } from "@/app/api/provider/route";

beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", "openai");
  vi.stubEnv("OPENAI_API_KEY", "k");
  vi.stubEnv("OPENAI_BASE_URL", "https://api.example.in/v1");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("AI_MODEL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("the model menu", () => {
  it("offers the gateway's models only when the gateway is configured, each with a price", () => {
    expect(modelMenu().map((e) => e.id)).toEqual(["glm", "haiku", "qwen", "gemini"]);
    for (const e of modelMenu()) expect(e.inrPerRun).toBeGreaterThan(0);
    vi.stubEnv("OPENAI_BASE_URL", "");
    expect(modelMenu()).toEqual([]);
    vi.stubEnv("GEMINI_API_KEY", "g");
    expect(modelMenu().map((e) => e.id)).toEqual(["gemini-native"]);
  });

  it("maps a pick to its provider and model, and an unknown pick to the default", () => {
    expect(chooseModel("haiku")).toMatchObject({ provider: "openai", model: "anthropic/claude-haiku-5.5" });
    expect(chooseModel("qwen")).toMatchObject({ provider: "openai", model: "qwen/qwen3.8-flash" });
    expect(chooseModel("nope")).toMatchObject({ provider: "openai", model: "z-ai/glm-5.3-flash" });
    expect(chooseModel(undefined)).toMatchObject({ provider: "openai", model: "z-ai/glm-5.3-flash" });
    expect(chooseModel({ id: "haiku" })).toMatchObject({ model: "z-ai/glm-5.3-flash" });
    expect(defaultMenuId()).toBe("glm");
    vi.stubEnv("AI_MODEL", "something/else");
    expect(defaultMenuId()).toBeNull();
  });

  it("is what /api/provider hands the picker, with no key in it", async () => {
    const body = await (await providerGet()).json();
    expect(body).toMatchObject({ provider: "openai", model: "z-ai/glm-5.3-flash", chosen: "glm" });
    expect(body.menu.map((e: { id: string }) => e.id)).toEqual(["glm", "haiku", "qwen", "gemini"]);
    expect(JSON.stringify(body)).not.toContain("example.in/v1");
    expect(JSON.stringify(body)).not.toContain('"k"');
  });
});
