/**
 * A failed model call, in words an engineer can act on.
 *
 * The providers' SDKs throw whatever their HTTP layer produced: Gemini's is
 * the response body as a JSON string ({"error":{"code":503,"message":"This
 * model is currently experiencing high demand...","status":"UNAVAILABLE"}}),
 * Anthropic's an error object with a numeric status. Shown as they come, the
 * chat printed that JSON at the engineer. This reads the code out of either
 * shape and says what happened, whether anything changed (never: a failed
 * call commits nothing) and whether waiting helps.
 *
 * Pure, so the chat client can read the same codes the route sends.
 */

export type ModelErrorCode = "busy" | "quota" | "auth" | "timeout" | "failed";

export interface ModelError {
  code: ModelErrorCode;
  /** Whether trying the same request again later can work. */
  retryable: boolean;
  /** One or two sentences for the chat. */
  message: string;
  /** The HTTP status, when there was one. */
  status?: number;
}

function statusOf(error: unknown): { status?: number; label?: string; detail?: string } {
  const e = error as { status?: unknown; code?: unknown; message?: unknown; error?: { type?: unknown } } | null;
  let status = typeof e?.status === "number" ? e.status : typeof e?.code === "number" ? e.code : undefined;
  let label: string | undefined = typeof e?.error?.type === "string" ? e.error.type : undefined;
  const text = typeof e?.message === "string" ? e.message : typeof error === "string" ? error : "";
  let detail = text;
  // Gemini: the body as JSON, sometimes after a prefix.
  const brace = text.indexOf("{");
  if (brace >= 0) {
    try {
      const body = JSON.parse(text.slice(brace)) as { error?: { code?: number; status?: string; message?: string; type?: string } };
      if (body.error) {
        status ??= typeof body.error.code === "number" ? body.error.code : undefined;
        label ??= body.error.status ?? body.error.type;
        detail = body.error.message ?? detail;
      }
    } catch {
      // not JSON after all
    }
  }
  status ??= Number(/\b(4\d\d|5\d\d)\b/.exec(text)?.[1]) || undefined;
  return { status, label, detail };
}

export function describeModelError(error: unknown, provider = "The model"): ModelError {
  const { status, label, detail } = statusOf(error);
  const said = `${label ?? ""} ${detail ?? ""}`.toLowerCase();
  const code: ModelErrorCode =
    status === 503 || status === 529 || status === 500 || /unavailable|overloaded|high demand/.test(said)
      ? "busy"
      : status === 429 || /resource_exhausted|rate.?limit|quota/.test(said)
        ? "quota"
        : status === 401 || status === 403 || /permission_denied|unauthenticated|api key|authentication/.test(said)
          ? "auth"
          : status === 408 || status === 504 || /timed? ?out|etimedout|deadline|aborted/.test(said)
            ? "timeout"
            : "failed";
  const tag = status ? ` (${status})` : "";
  const unchanged = "Nothing in the project changed.";
  const message =
    code === "busy"
      ? `${provider} is overloaded right now and did not answer${tag}. ${unchanged} Try again in a minute.`
      : code === "quota"
        ? `${provider} refused the request because its rate or quota limit was reached${tag}. ${unchanged} Try again later, or raise the limit on the key.`
        : code === "auth"
          ? `${provider} rejected the API key${tag}. ${unchanged} The key in the server's environment needs fixing.`
          : code === "timeout"
            ? `${provider} took too long to answer${tag}. ${unchanged} Try again, or ask for less at once.`
            : `${provider} call failed${tag}: ${(detail || "no reason given").replace(/\s+/g, " ").slice(0, 160)}. ${unchanged}`;
  return { code, retryable: code === "busy" || code === "quota" || code === "timeout", message, ...(status ? { status } : {}) };
}

/**
 * Whether a turn whose model call failed should lay out screens anyway. On a
 * project with tags and nothing drawn the pipeline can build from the tag
 * names alone, exactly as it does with no model configured; anywhere else a
 * failed call changes nothing.
 */
export function buildsWithoutModel(project: { hasContent: boolean; hasTags: boolean }): boolean {
  return !project.hasContent && project.hasTags;
}
