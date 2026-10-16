/** Decode bounded cloud saves before running the same snapshot validation as inline JSON. */
import { gunzipSync } from "node:zlib";
import { readBody } from "@/lib/ingest/body";
import { json, sameOrigin } from "./http";
import { uploadedSource } from "./uploads";
import { ServerError } from "./errors";
import type { User } from "./repo";

const MAX_SNAPSHOT = 64 * 1024 * 1024;
// A small envelope allowance keeps the snapshot itself capped at exactly 64 MiB.
function decode(bytes: Uint8Array): Record<string, unknown> {
  let raw: Buffer;
  try { raw = gunzipSync(bytes, { maxOutputLength: MAX_SNAPSHOT + 1024 }); }
  catch { throw new ServerError(400, "invalid", "Invalid gzip snapshot or snapshot exceeds 64 MB"); }
  const value = JSON.parse(raw.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ServerError(400, "invalid", "Expected a snapshot envelope");
  return value;
}

/** Uploaded saves enforce account ownership and the same uncompressed size bound. */
export async function snapshotBody(request: Request, user: User): Promise<Record<string, unknown>> {
  sameOrigin(request);
  let body = request.headers.get("content-type")?.includes("application/gzip")
    ? decode(await readBody(request, 4 * 1024 * 1024)) : await json(request);
  if (body.snapshotUploadId !== undefined) {
    const uploaded = await uploadedSource(body.snapshotUploadId, user);
    body = { ...decode(uploaded.bytes), rev: body.rev };
  }
  if (Buffer.byteLength(JSON.stringify(body.snapshot) ?? "") > MAX_SNAPSHOT) throw new ServerError(413, "too-large", "The snapshot exceeds 64 MB");
  return body;
}
