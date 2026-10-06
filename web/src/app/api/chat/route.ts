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

import { converse, type Catalog, type HistoryItem, type ProjectDigest } from "@/lib/ai/converse";
import { resolveProvider } from "@/lib/ai/provider";
import type { Turn } from "@/lib/ai/ops";
import type { StructureHint } from "@/lib/ai/infer";
import { backendFor } from "@/lib/backend";
import { allKnowledge } from "@/lib/knowledge/store";

export const runtime = "nodejs";
/** A model call with the whole project in context can outrun the default. */
export const maxDuration = 120;

interface Body {
  history?: HistoryItem[];
  digest?: ProjectDigest;
  repair?: boolean;
  catalog?: Catalog;
  structure?: StructureHint[];
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const history = (body.history ?? []).filter((m) => m && typeof m.text === "string");
  const digest = body.digest;
  if (!digest || history.length === 0) {
    return Response.json(
      { error: "a turn needs the project digest and at least one message" },
      { status: 400 },
    );
  }

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
      },
      { status: 200 },
    );
  }

  try {
    const catalog =
      body.catalog && Array.isArray(body.catalog.tags) && Array.isArray(body.catalog.objects)
        ? body.catalog
        : undefined;
    // The knowledge base informs the tools; a store that cannot be read
    // costs the turn its precedents, never the turn itself.
    const knowledge = await allKnowledge().catch(() => []);
    const target = backendFor();
    const result = await converse({
      history,
      digest,
      repair: body.repair === true,
      catalog,
      structure: Array.isArray(body.structure) ? body.structure : undefined,
      knowledge,
      target: { name: target.name, parts: target.capabilities.parts },
    });
    if (!result) {
      return Response.json(
        {
          provider: choice.provider,
          model: choice.model,
          turn: {
            mode: "answer",
            reply: "The model answered with something I could not read as a turn.",
          } satisfies Turn,
        },
        { status: 200 },
      );
    }
    return Response.json({
      provider: result.provider,
      model: result.model,
      turn: result.turn,
      usage: result.usage,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "the model call failed" },
      { status: 502 },
    );
  }
}
