/** Large cloud saves stay below the host body ceiling, even for imported plants. */
import type { PersistedProject } from "@/store/persist";
import { expectJson } from "@/lib/ingest/client";

const REQUEST_BYTES = 3.5 * 1024 * 1024;
const SNAPSHOT_BYTES = 64 * 1024 * 1024;

/** Compress before staging; each request remains independently retryable. */
export async function snapshotRequest(snapshot: PersistedProject, rev?: number): Promise<RequestInit> {
  const serialized = JSON.stringify(snapshot);
  if (new TextEncoder().encode(serialized).length > SNAPSHOT_BYTES) throw new Error("The project exceeds the 64 MB snapshot limit.");
  const body = JSON.stringify({ rev, snapshot });
  const headers = { "Content-Type": "application/json" };
  if (new TextEncoder().encode(body).length <= REQUEST_BYTES) return { headers, body };
  const compressed = await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
  if (compressed.size <= REQUEST_BYTES) return { headers: { "Content-Type": "application/gzip" }, body: compressed };
  const { uploadId } = await expectJson<{ uploadId: string }>(await fetch("/api/upload", {
    method: "POST", headers, body: JSON.stringify({ fileName: "snapshot.json.gz", size: compressed.size }),
  }), "Starting snapshot upload");
  for (let start = 0, part = 0; start < compressed.size; start += REQUEST_BYTES, part++) {
    await expectJson(await fetch(`/api/upload/${uploadId}?part=${part}`, {
      method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: compressed.slice(start, start + REQUEST_BYTES),
    }), "Uploading snapshot");
  }
  await expectJson(await fetch(`/api/upload/${uploadId}/complete`, { method: "POST" }), "Completing snapshot upload");
  return { headers, body: JSON.stringify({ rev, snapshotUploadId: uploadId }) };
}
