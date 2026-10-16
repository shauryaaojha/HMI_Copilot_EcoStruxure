/**
 * Upload handles are unguessable capabilities for anonymous use and are also
 * bound to an account when signed in. Completion is idempotent, and importing
 * verifies ownership again rather than trusting a source id sent by the client.
 * Each request stays below the host's body ceiling; the repository enforces the
 * declared size and the aggregate 100 MB limit before storing any part.
 */
import { repo, type Repo, type User } from "./repo";
import { ServerError } from "./errors";
export async function uploadedSource(uploadId: unknown, user: User | null, storage: Repo = repo()) {
  if (typeof uploadId !== "string") throw new ServerError(400, "invalid", "Expected uploadId");
  const upload = await storage.uploads.get(uploadId);
  if (!upload) throw new ServerError(404, "not-found", "Upload is missing or expired");
  if (upload.ownerId !== (user?.id ?? null)) throw new ServerError(403, "forbidden", "This upload belongs to another user");
  if (!upload.sourceId) throw new ServerError(409, "incomplete", "Complete the upload before importing it");
  const source = await storage.sources.get(upload.sourceId);
  if (!source) throw new ServerError(404, "not-found", "Source is missing or expired");
  return source;
}
