/**
 * Shared request validation for the thin route adapters. JSON is bounded before
 * parsing and snapshots are projected onto the persisted shape: selection,
 * simulation, undo stacks and arbitrary store actions cannot enter history.
 * Mutation requests with a foreign browser Origin are refused, including in
 * local mode where no session cookie is necessary.
 */
import { readBody } from "@/lib/ingest/body";
import { getImport } from "@/lib/ote/imports";
import { repo } from "./repo";
import { currentUser } from "./session";
import { ServerError, errorResponse } from "./errors";
import { sourceInfo } from "./access";
import type { Snapshot, User } from "./repo";
export { errorResponse };
export type Context = { params: Promise<{ id: string }> };
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new ServerError(403, "origin", "Cross-origin writes are not allowed");
}
export async function json(request: Request): Promise<Record<string, unknown>> {
  sameOrigin(request);
  const value = JSON.parse(new TextDecoder().decode(await readBody(request, 4 * 1024 * 1024)));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ServerError(400, "invalid", "Expected a JSON object");
  return value;
}
export async function userRequired() {
  const user = await currentUser();
  if (!user) throw new ServerError(401, "unauthorized", "Sign in to access projects");
  return user;
}
export function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new ServerError(400, "invalid", "Expected a positive revision");
  return value as number;
}
export function label(value: unknown) { return typeof value === "string" ? value.slice(0, 200) : undefined; }
export async function snapshot(value: unknown, user: User): Promise<Snapshot> {
  if (!value || typeof value !== "object") throw new ServerError(400, "invalid", "Expected a project snapshot");
  const p = value as Snapshot;
  if (p.v !== 3 || typeof p.id !== "string" || typeof p.name !== "string" || !p.name.trim() || p.name.length > 255 || !p.target || typeof p.target.model !== "string" || !Number.isFinite(p.target.width) || !Number.isFinite(p.target.height) || ![p.screens, p.variables, p.alarms, p.bindings].every(Array.isArray) || !p.standards) {
    throw new ServerError(400, "invalid", "Invalid project snapshot");
  }
  for (const field of ["source", "sourceId"] as const) {
    const id = p[field];
    if (!id) continue;
    if (typeof id !== "string") throw new ServerError(400, "invalid", "Invalid source");
    const source = await sourceInfo(id, user);
    if (!source || source.ownerId === null) {
      const bytes = source ? (await repo().sources.get(id))?.bytes : await getImport(id);
      if (!bytes) throw new ServerError(400, "source-expired", "Reopen the original file while signed in before saving this project to the server");
      const permanent = await repo().sources.put(bytes, source?.fileName ?? "project.eote", user.id);
      p[field] = permanent;
      if (p.sourceId === id) p.sourceId = permanent;
    }
  }
  const { id, name, target, screens, variables, alarms, bindings, objectMeta, screenPlacement, handles, handleSeq, source, sourceId, layout, foreign, composites, programs, plant, standards, versions, chat, tagImport } = p;
  return { v: 3, savedAt: Date.now(), id, name, target, screens, variables, alarms, bindings, objectMeta: objectMeta ?? {}, screenPlacement: screenPlacement ?? {}, handles, handleSeq, source, sourceId, layout, foreign, composites, programs, plant, standards, versions: versions ?? [], chat: chat ?? [], tagImport };
}
