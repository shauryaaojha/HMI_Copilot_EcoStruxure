/**
 * One conversational turn.
 *
 * Not streamed, unlike /api/generate: a turn's whole value is the decision it
 * makes - clarify, build, extend, edit or answer - and a half-arrived op list
 * is worse than none. Generation still streams, because watching a screen
 * fill in object by object is the demo; this is the thing that decides
 * whether to run it.
 *
 * The body carries the structured history (what happened, not what was said)
 * and the digest; `repair` marks the one retry after rejected ops.
 */

import { modelCaller } from "@/lib/server/model-gate";
import { errorResponse, json } from "@/lib/server/http";
import { describeModelError } from "@/lib/ai/model-error";
import { converse, withGemini, type Catalog, type HistoryItem, type ProjectDigest } from "@/lib/ai/converse";
import { agentChat, type AgentStep } from "@/lib/ai/agent-chat";
import type { Doc } from "@/lib/collab/types";
import { providerName, resolveProvider } from "@/lib/ai/provider";
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
  const choice = resolveProvider();
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

  try {
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
    // Gemini with the project in hand works in a tool-calling loop; anything
    // else (Claude, or an older client that sent no doc) answers in one call.
    const doc = body.doc && Array.isArray(body.doc.screens) && Array.isArray(body.doc.variables) ? body.doc : undefined;
    let result: (Awaited<ReturnType<typeof converse>> & { steps?: AgentStep[] }) | null;
    if (doc && choice.provider === "gemini" && choice.model) {
      try {
        result = await agentChat({ ...input, doc }, choice.model);
      } catch (error) {
        // Out of quota or overloaded: the turn is still answered, in one call
        // on a model with its own quota, and says so. Anything else is a
        // real failure and goes to the handler below.
        const failed = describeModelError(error);
        const fallback = process.env.GEMINI_FALLBACK_MODEL?.trim() || "gemini-flash-lite-latest";
        if ((failed.code !== "quota" && failed.code !== "busy") || fallback === choice.model) throw error;
        const single = await withGemini(input, fallback);
        result = single && {
          ...single,
          steps: [{ tool: "fallback", summary: `${choice.model} is ${failed.code === "quota" ? "out of quota" : "overloaded"}, so ${fallback} answered in one call, without tools`, isError: true }],
        };
      }
    } else {
      result = await converse(input);
    }
    if (!result) {
      return Response.json(
        {
          provider: choice.provider,
          model: choice.model,
          turn: {
            mode: "answer",
            reply: "The model answered with something I could not read as a turn.",
          } satisfies Turn,
          trace,
        },
        { status: 200 },
      );
    }
    return Response.json({
      provider: result.provider,
      model: result.model,
      turn: result.turn,
      usage: result.usage,
      ...(result.steps?.length ? { steps: result.steps } : {}),
      trace,
    });
  } catch (error) {
    // The provider's own error is JSON or an SDK object; the engineer gets a
    // sentence, and the client gets a code it can act on (lib/ai/model-error).
    const failed = describeModelError(error, choice.provider ? providerName(choice.provider) : undefined);
    return Response.json({ error: failed.message, code: failed.code, retryable: failed.retryable }, { status: 502 });
  }
}
