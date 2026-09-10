/**
 * Reading a Server-Sent Events body into the events it carries.
 *
 * Split out from the hook because the framing is the part that is easy to get
 * subtly wrong and worth testing on its own: a frame can straddle two chunks,
 * a chunk can contain several frames, and a multi-byte character can be cut in
 * half by the transport.
 *
 * Phase 4 of docs/BUILD_PLAN.md.
 */

import type { GenerationEvent } from "@/types/events";

export async function* readEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<GenerationEvent> {
  // A manual decoder rather than TextDecoderStream: the pipeThrough typings
  // disagree about Uint8Array variance, and `stream: true` is what actually
  // matters here - a multi-byte character can straddle two chunks.
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; a frame may span two chunks.
    let split = buffer.indexOf("\n\n");
    while (split !== -1) {
      const event = parseFrame(buffer.slice(0, split));
      buffer = buffer.slice(split + 2);
      if (event) yield event;
      split = buffer.indexOf("\n\n");
    }
  }

  // A stream that ends without its final blank line still carries an event.
  const last = parseFrame(buffer);
  if (last) yield last;
}

function parseFrame(frame: string): GenerationEvent | null {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("");

  if (!data) return null;
  try {
    return JSON.parse(data) as GenerationEvent;
  } catch {
    // A frame we cannot parse is dropped rather than killing the run.
    return null;
  }
}
