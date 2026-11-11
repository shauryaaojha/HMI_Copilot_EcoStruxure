/**
 * One conversational turn.
 *
 * The decision is never streamed: a turn's whole value is what it decides -
 * clarify, build, extend, edit or answer - and a half-arrived op list is
 * worse than none. What the loop does on the way there is streamed when the
 * client asks (`stream: true`): each lookup, try, look and thought as NDJSON
 * lines as they happen, then the turn as the last line, whole. An older
 * client gets the turn as one JSON body, as before.
 *
 * The body carries the structured history (what happened, not what was said)
 * and the digest; `repair` marks the one retry after rejected ops; `model` is
 * a menu id from /api/provider (lib/ai/menu.ts).
 */

import { modelCaller } from "@/lib/server/model-gate";
import { errorResponse, json } from "@/lib/server/http";
import { describeModelError } from "@/lib/ai/model-error";
import { converse, withGemini, withOpenAI, type Catalog, type HistoryItem, type ProjectDigest } from "@/lib/ai/converse";
import { agentChat, type AgentStep } from "@/lib/ai/agent-chat";
import type { Doc } from "@/lib/collab/types";
import { providerName } from "@/lib/ai/provider";
import { chooseModel } from "@/lib/ai/menu";
import type { Turn } from "@/core/ops";
import type { StructureHint } from "@/lib/ai/infer";
import { backendFor } from "@/lib/backend";
import { allKnowledge, ownedBy } from "@/lib/knowledge/store";
import { loadKb } from "@/lib/kb";
import { readProject } from "@/lib/ote/reader";
import { describeOwn, harvest, type OwnObject } from "@/lib/ote/exemplars";
import { getImport } from "@/lib/ote/imports";
import { hasMongo } from "@/lib/db/mongo";
import { readSource } from "@/lib/server/access";
import { currentUser } from "@/lib/server/session";
import { shareTokens } from "@/lib/server/shares";

export const runtime = "nodejs";
/**
 * The agent loop (lib/ai/agent-chat.ts) makes several model calls a turn and
 * renders screens between them, so it gets the longest a function may run.
 */
export const maxDuration = 300;

interface Body {
  history?: HistoryItem[];
  digest?: ProjectDigest;
  repair?: boolean;
  catalog?: Catalog;
  structure?: StructureHint[];
  /** The id of the file the project was opened from, when it was. */
  source?: string;
  /** The whole project, for the agent loop's draft. Absent from an older client. */
  doc?: Doc;
  /** Steps as NDJSON lines while the loop works, then the turn; one JSON body otherwise. */
  stream?: boolean;
  /** The model the engineer picked, by menu id; the configured default when absent or unknown. */
  model?: string;
}

/**
 * How the opened project draws its objects, read from its file with the same
 * access check the export makes. A file that cannot be read costs the turn
 * this lookup, never the turn.
 */
async function ownObjects(source: string | undefined, request: Request): Promise<OwnObject[] | undefined> {
  if (!source || !/^[0-9a-f-]{36}$/i.test(source)) return undefined;
  try {
    const stored = hasMongo() || !process.env.VERCEL ? await readSource(source, await currentUser(), "read", undefined, shareTokens(request)) : null;
    const bytes = stored?.bytes ?? (await getImport(source));
    if (!bytes) return undefined;
    const read = await readProject(bytes);
    return describeOwn(harvest(read.preserved, read.variables));
  } catch {
    return undefined;
  }
}

export async function POST(request: Request) {
  let body: Body;
  let caller: Awaited<ReturnType<typeof modelCaller>>;
  try {
    caller = await modelCaller();
  } catch (e) {
    return errorResponse(e);
  }
  try {
    // Capped at 4 MB before parsing, so an oversized turn never reaches the model.
    body = (await json(request)) as Body;
  } catch (e) {
    return errorResponse(e);
  }

  const history = (body.history ?? []).filter((m) => m && typeof m.text === "string");
  const digest = body.digest;
  if (!digest || history.length === 0) {
    return Response.json(
      { error: "a turn needs the project digest and at least one message" },
      { status: 400 },
    );
  }

  const kb = loadKb();
  const trace = { kb: kb?.version ?? null };
  const choice = chooseModel(body.model);
  if (!choice.provider) {
    // Not an error: the product runs without a model, it just cannot converse.
    // Saying which configuration is missing beats a 500.
    return Response.json(
      {
        provider: null,
        model: null,
        turn: {
          mode: "answer",
          reply:
            `No conversational model is configured (${choice.reason}). ` +
            "The Generate button still lays out a screen from the tag names, and " +
            "every editing tool works.",
        } satisfies Turn,
        trace,
      },
      { status: 200 },
    );
  }

  const catalog =
    body.catalog && Array.isArray(body.catalog.tags) && Array.isArray(body.catalog.objects)
      ? body.catalog
      : undefined;
  // binding_precedent and example_screens read the caller's own scans until
  // the corpus layer replaces them. Nobody else's scan ever reaches a turn, and
  // a store that cannot be read costs the turn its precedents, never the turn.
  const knowledge = (await allKnowledge().catch(() => [])).filter((record) => ownedBy(record, caller.id));
  const own = await ownObjects(body.source, request);
  const target = backendFor();
  const input = {
    history,
    digest,
    repair: body.repair === true,
    catalog,
    structure: Array.isArray(body.structure) ? body.structure : undefined,
    knowledge,
    kb,
    own,
    target: { name: target.name, parts: target.capabilities.parts },
  };
  // Gemini or the gateway with the project in hand works in a tool-calling
  // loop; anything else (Claude, or an older client that sent no doc)
  // answers in one call.
  const doc = body.doc && Array.isArray(body.doc.screens) && Array.isArray(body.doc.variables) ? body.doc : undefined;

  /** The provider working at the moment, so a failure names the one that failed, not the one picked. */
  let active: NonNullable<typeof choice.provider> = choice.provider;
  /** The turn as the JSON body, every step reported as it happens. Throws on a model failure. */
  const answer = async (onStep: (step: AgentStep) => void) => {
    let result: (Awaited<ReturnType<typeof converse>> & { steps?: AgentStep[] }) | null;
    if (doc && (choice.provider === "gemini" || choice.provider === "openai") && choice.model) {
      const loop = choice.provider;
      try {
        result = await agentChat({ ...input, doc, onStep }, choice.model, loop);
      } catch (error) {
        // Out of quota or overloaded: the turn is still answered, in one call
        // on a model with its own quota, and says so. Anything else is a
        // real failure and goes to the handler below. The gateway has no
        // fallback unless OPENAI_FALLBACK_MODEL names one of its models.
        const failed = describeModelError(error);
        // The gateway out of budget or overloaded, with a Google key on the
        // installation: the same loop runs on Gemini, with its tools, and says so.
        if (loop === "openai" && (failed.code === "quota" || failed.code === "busy") && process.env.GEMINI_API_KEY?.trim()) {
          const geminiModel = process.env.GEMINI_LOOP_MODEL?.trim() || "gemini-3.8-flash";
          active = "gemini";
          onStep({ tool: "fallback", summary: `${providerName("openai")} refused ${choice.model} (${failed.code === "quota" ? "budget or quota used up" : "overloaded"}), so ${geminiModel} on the Google key took the turn`, isError: true });
          result = await agentChat({ ...input, doc, onStep }, geminiModel, "gemini");
          return result
            ? { provider: result.provider, model: result.model, turn: result.turn, usage: result.usage, ...(result.steps?.length ? { steps: result.steps } : {}), trace }
            : { provider: "gemini" as const, model: geminiModel, turn: { mode: "answer", reply: "The model answered with something I could not read as a turn." } satisfies Turn, trace };
        }
        const fallback = loop === "gemini" ? process.env.GEMINI_FALLBACK_MODEL?.trim() || "gemini-flash-lite-latest" : process.env.OPENAI_FALLBACK_MODEL?.trim();
        if (!fallback || (failed.code !== "quota" && failed.code !== "busy") || fallback === choice.model) throw error;
        const step: AgentStep = {
          tool: "fallback",
          summary: `${choice.model} is ${failed.code === "quota" ? "out of quota" : "overloaded"}, so ${fallback} answered in one call, without tools`,
          isError: true,
        };
        onStep(step);
        const single = loop === "gemini" ? await withGemini(input, fallback) : await withOpenAI(input, fallback);
        result = single && { ...single, steps: [step] };
      }
    } else {
      result = await converse(input);
      // Claude's thinking, when it came back, is shown the way the loop's thoughts are.
      if (result?.thoughts?.length) {
        const thoughts = result.thoughts.map((summary): AgentStep => ({ tool: "thought", summary }));
        thoughts.forEach(onStep);
        result = { ...result, steps: [...thoughts, ...(result.steps ?? [])] };
      }
    }
    if (!result) {
      return {
        provider: choice.provider,
        model: choice.model,
        turn: { mode: "answer", reply: "The model answered with something I could not read as a turn." } satisfies Turn,
        trace,
      };
    }
    return {
      provider: result.provider,
      model: result.model,
      turn: result.turn,
      usage: result.usage,
      ...(result.steps?.length ? { steps: result.steps } : {}),
      trace,
    };
  };

  // The provider's own error is JSON or an SDK object; the engineer gets a
  // sentence, and the client gets a code it can act on (lib/ai/model-error).
  const failure = (error: unknown) => {
    const failed = describeModelError(error, providerName(active));
    return { error: failed.message, code: failed.code, retryable: failed.retryable };
  };

  if (body.stream !== true) {
    try {
      return Response.json(await answer(() => {}));
    } catch (error) {
      return Response.json(failure(error), { status: 502 });
    }
  }

  // Streamed: {type:"step"} lines as the loop works, then {type:"turn"} whole,
  // or {type:"error"} with the same code the JSON path sends as a 502.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        send({ type: "turn", ...(await answer((step) => send({ type: "step", step }))) });
      } catch (error) {
        send({ type: "error", ...failure(error) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
