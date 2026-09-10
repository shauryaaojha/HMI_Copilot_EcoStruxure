/**
 * The generation pipeline, streamed.
 *
 * Emits one complete object at a time rather than parsing partial JSON: more
 * robust, and a natural fit for the build timeline. The event contract is in
 * src/types/events.ts and is frozen.
 *
 * Phase 4 of docs/BUILD_PLAN.md.
 */

import { runPipeline } from "@/lib/ai/pipeline";
import type { GenerationEvent } from "@/types/events";
import type { Variable } from "@/lib/ote/schema";

export const runtime = "nodejs";
/** A model call plus layout can outrun the default serverless window. */
export const maxDuration = 120;

export async function POST(request: Request) {
  let body: { intent?: string; variables?: Variable[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const intent = (body.intent ?? "").trim();
  const variables = body.variables ?? [];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: GenerationEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      try {
        for await (const event of runPipeline({ intent, variables })) {
          send(event);
        }
      } catch (error) {
        // The client renders an error event; a dropped connection renders
        // nothing, so a thrown pipeline must still say what happened.
        send({
          type: "error",
          message: error instanceof Error ? error.message : "generation failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx and friends buffer SSE into uselessness without this.
      "X-Accel-Buffering": "no",
    },
  });
}
