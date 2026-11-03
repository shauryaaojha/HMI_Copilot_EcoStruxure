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

import { describeModelError } from "@/lib/ai/model-error";
import { converse, type Catalog, type HistoryItem, type ProjectDigest } from "@/lib/ai/converse";
import { providerName, resolveProvider } from "@/lib/ai/provider";
import type { Turn } from "@/lib/ai/ops";
import type { StructureHint } from "@/lib/ai/infer";
import { backendFor } from "@/lib/backend";
import { allKnowledge } from "@/lib/knowledge/store";
import { readProject } from "@/lib/ote/reader";
import { describeOwn, harvest, type OwnObject } from "@/lib/ote/exemplars";
import { getImport } from "@/lib/ote/imports";
import { hasMongo } from "@/lib/db/mongo";
import { readSource } from "@/lib/server/access";
import { currentUser } from "@/lib/server/session";
import { shareTokens } from "@/lib/server/shares";

export const runtime = "nodejs";
/** A model call with the whole project in context can outrun the default. */
export const maxDuration = 120;

interface Body {
  history?: HistoryItem[];
  digest?: ProjectDigest;
  repair?: boolean;
  catalog?: Catalog;
  structure?: StructureHint[];
  /** The id of the file the project was opened from, when it was. */
  source?: string;
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
    const own = await ownObjects(body.source, request);
    const target = backendFor();
    const result = await converse({
      history,
      digest,
      repair: body.repair === true,
      catalog,
      structure: Array.isArray(body.structure) ? body.structure : undefined,
      knowledge,
      own,
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
    // The provider's own error is JSON or an SDK object; the engineer gets a
    // sentence, and the client gets a code it can act on (lib/ai/model-error).
    const failed = describeModelError(error, choice.provider ? providerName(choice.provider) : undefined);
    return Response.json({ error: failed.message, code: failed.code, retryable: failed.retryable }, { status: 502 });
  }
}
