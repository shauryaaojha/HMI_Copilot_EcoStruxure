/**
 * The generation pipeline, streamed.
 *
 * Emits one complete object at a time rather than parsing partial JSON: more
 * robust, and a natural fit for the build timeline. See src/types/events.ts for
 * the event contract. Phase 4 of docs/BUILD_PLAN.md.
 */

import type { GenerationEvent } from "@/types/events";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { intent } = (await request.json()) as { intent: string };

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: GenerationEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      send({ type: "step", step: "ingest", state: "running" });
      send({
        type: "log",
        at: new Date().toLocaleTimeString("en-GB", { hour12: false }),
        message: `Received intent (${intent.length} chars)`,
      });

      // TODO Phase 4: run the eight steps, each emitting step/log/object/binding
      // events. Model calls go through lib/ai/pipeline.ts with zodOutputFormat
      // against lib/ote/schema.ts, so an invented property cannot survive parsing.
      send({ type: "error", message: "pipeline not implemented - Phase 4" });

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
