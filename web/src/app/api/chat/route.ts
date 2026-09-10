/**
 * One conversational turn.
 *
 * Not streamed, unlike /api/generate: a turn's whole value is the decision it
 * makes - clarify, build, edit or answer - and a half-arrived op list is worse
 * than none. Generation still streams, because watching a screen fill in object
 * by object is the demo; this is the thing that decides whether to run it.
 */

import { converse, type ProjectDigest } from "@/lib/ai/converse";
import { activeProvider } from "@/lib/ai/plan";
import type { Turn } from "@/lib/ai/ops";

export const runtime = "nodejs";
/** A model call with the whole project in context can outrun the default. */
export const maxDuration = 120;

interface Body {
  history?: { role: "user" | "assistant"; text: string }[];
  digest?: ProjectDigest;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const history = (body.history ?? []).filter((m) => m?.text?.trim());
  const digest = body.digest;
  if (!digest || history.length === 0) {
    return Response.json(
      { error: "a turn needs the project digest and at least one message" },
      { status: 400 },
    );
  }

  if (!activeProvider()) {
    // Not an error: the product runs without a key, it just cannot converse.
    // Saying so plainly beats a 500 the client has to guess the meaning of.
    return Response.json(
      {
        provider: null,
        turn: {
          mode: "answer",
          reply:
            "No model key is configured, so I cannot read a request in words. " +
            "The Generate button still lays out a screen from the tag names, and " +
            "every editing tool works.",
        } satisfies Turn,
      },
      { status: 200 },
    );
  }

  try {
    const result = await converse({ history, digest });
    if (!result) {
      return Response.json(
        {
          provider: activeProvider(),
          turn: {
            mode: "answer",
            reply: "The model answered with something I could not read as a turn.",
          } satisfies Turn,
        },
        { status: 200 },
      );
    }
    return Response.json({ provider: result.provider, turn: result.turn });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "the model call failed",
      },
      { status: 502 },
    );
  }
}
