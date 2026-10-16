/**
 * A failed model call, as the engineer reads it (lib/ai/model-error.ts).
 *
 * The first case is the exact error Gemini returned on the live site on
 * 17 October 2026, which the chat used to print as raw JSON.
 */

import { describe, expect, it } from "vitest";
import { buildsWithoutModel, describeModelError } from "@/lib/ai/model-error";

const GEMINI_503 =
  '{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}';

describe("describeModelError", () => {
  it("turns Gemini's overload JSON into a sentence, with no JSON left in it", () => {
    const e = describeModelError(new Error(GEMINI_503), "Gemini");
    expect(e).toMatchObject({ code: "busy", retryable: true, status: 503 });
    expect(e.message).toBe("Gemini is overloaded right now and did not answer (503). Nothing in the project changed. Try again in a minute.");
    expect(e.message).not.toMatch(/[{}"]/);
  });

  it("reads Anthropic-style errors by their status", () => {
    expect(describeModelError(Object.assign(new Error("Overloaded"), { status: 529 }), "Claude").code).toBe("busy");
    expect(describeModelError(Object.assign(new Error("rate_limit_error"), { status: 429 }), "Claude")).toMatchObject({ code: "quota", retryable: true });
    expect(describeModelError(Object.assign(new Error("invalid x-api-key"), { status: 401 }), "Claude")).toMatchObject({ code: "auth", retryable: false });
  });

  it("recognises quota, key and timeout failures in Gemini's own words", () => {
    expect(describeModelError(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded"}}')).code).toBe("quota");
    expect(describeModelError(new Error('{"error":{"code":403,"status":"PERMISSION_DENIED","message":"API key not valid"}}')).code).toBe("auth");
    expect(describeModelError(new Error("The operation was aborted due to timeout")).code).toBe("timeout");
  });

  it("keeps an unknown failure's reason, short and on one line", () => {
    const e = describeModelError(new Error("socket hang up\n   at TLSSocket"), "Gemini");
    expect(e.code).toBe("failed");
    expect(e.message).toMatch(/^Gemini call failed: socket hang up at TLSSocket\. Nothing in the project changed\.$/);
  });
});

describe("buildsWithoutModel", () => {
  it("builds from tag names only on a project with tags and nothing drawn", () => {
    expect(buildsWithoutModel({ hasContent: false, hasTags: true })).toBe(true);
    expect(buildsWithoutModel({ hasContent: true, hasTags: true })).toBe(false);
    expect(buildsWithoutModel({ hasContent: false, hasTags: false })).toBe(false);
  });
});
