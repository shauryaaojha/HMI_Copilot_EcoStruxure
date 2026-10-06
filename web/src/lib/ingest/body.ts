/**
 * A request body as bytes, with a ceiling that holds before the bytes arrive.
 *
 * `await request.arrayBuffer()` buffers whatever the client sends. A declared
 * Content-Length over the limit is refused before reading; an undeclared or
 * lying one is cut off while streaming, so memory never exceeds the limit
 * however the request was made.
 */

import { IngestError } from "./errors";
import { DEFAULT_LIMITS } from "./zip";

export async function readBody(request: Request, maxBytes = DEFAULT_LIMITS.maxBytes): Promise<Uint8Array> {
  const mb = (n: number) => `${(n / 1048576).toFixed(0)} MB`;
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new IngestError("too-large", `The file is ${mb(declared)}; the limit is ${mb(maxBytes)}.`);
  }
  if (!request.body) throw new IngestError("empty", "No file was sent.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let step: ReadableStreamReadResult<Uint8Array>;
    try {
      step = await reader.read();
    } catch {
      throw new IngestError("empty", "The upload was interrupted before the whole file arrived.", "Try again.");
    }
    if (step.done) break;
    total += step.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new IngestError("too-large", `The file is over the ${mb(maxBytes)} limit.`);
    }
    chunks.push(step.value);
  }
  if (total === 0) throw new IngestError("empty", "The file is empty.");
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
