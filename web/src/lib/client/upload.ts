/**
 * The two open-file flows share one transport. Small files retain the existing
 * raw-body API; larger ones travel in sequential four-megabyte parts so no
 * Vercel function receives a body above its request ceiling. The server checks
 * the real lengths as well as these client-side conveniences.
 */
import { expectJson } from "@/lib/ingest/client";
const PART = 4 * 1024 * 1024;
export async function importFile(file: File): Promise<Response> {
  if (file.size > 100 * 1024 * 1024) throw new Error("The file exceeds the 100 MB limit.");
  const headers = { "X-File-Name": encodeURIComponent(file.name) };
  if (file.size <= PART) return fetch("/api/import", { method: "POST", headers: { ...headers, "Content-Type": "application/octet-stream" }, body: file });
  const { uploadId } = await expectJson<{ uploadId: string }>(await fetch("/api/upload", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, size: file.size }),
  }), "Starting upload");
  for (let start = 0, part = 0; start < file.size; start += PART, part++) {
    await expectJson(await fetch(`/api/upload/${uploadId}?part=${part}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: file.slice(start, start + PART) }), "Uploading file");
  }
  await expectJson(await fetch(`/api/upload/${uploadId}/complete`, { method: "POST" }), "Completing upload");
  return fetch("/api/import", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ uploadId }) });
}
