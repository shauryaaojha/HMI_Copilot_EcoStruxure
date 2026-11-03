/**
 * Getting at a project on a caller's behalf, once and in one place.
 *
 * Every tool that names a project comes through `openProject`, which asks
 * `lib/server/access.ts` the question and lets its refusal through unchanged.
 * That is the point: a tool states which action it needs - "read", "edit" -
 * and has no say in whether the caller has it. A tool that decided for itself
 * would be a second role matrix, and two role matrices eventually disagree.
 *
 * What a tool then gets is the shared document at a stated revision, not the
 * store: a connector call is a second client of the same project
 * (docs/RESEARCH_CLAUDE_AI_INTEGRATION.md, "hard constraints" 2), so it reads
 * the server's snapshot like the browser does and writes through the same
 * change log.
 */
import { docOf } from "@/lib/collab/changes";
import { packageInputOf } from "@/lib/collab/package";
import type { Doc } from "@/lib/collab/types";
import { rootBox, type Screen } from "@/lib/ote/schema";
import { accessOf, requireAccess, type Action } from "@/lib/server/access";
import { ServerError } from "@/lib/server/errors";
import { repo, type Project, type Repo } from "@/lib/server/repo";
import { callerUser, type Caller } from "./caller";
import { field } from "./data";

/** A project as a tool reads it: the metadata row, the revision, the document. */
export interface OpenProject {
  project: Project;
  rev: number;
  doc: Doc;
}

/**
 * The project, if this caller may take this action on it. Throws the same
 * 401/403/404 the editor's own routes throw, which the tool wrapper turns
 * into a refusal the model can relay.
 */
export async function openProject(caller: Caller, projectId: unknown, action: Action, storage: Repo = repo()): Promise<OpenProject> {
  if (typeof projectId !== "string" || !projectId.trim()) throw new ServerError(400, "invalid", "Name the project by its id, from list_projects");
  await requireAccess(callerUser(caller), projectId, action);
  const project = await storage.projects.get(projectId);
  const current = await storage.versions.current(projectId);
  if (!project || !current) throw new ServerError(409, "no-snapshot", "That project has no saved snapshot yet; open it in the app once");
  return { project, rev: current.rev, doc: docOf(current.snapshot) };
}

/** The project as the checks and the packager take it. */
export const inputOf = (doc: Doc) => packageInputOf(doc);

/** Whether this project has been opted in to changes without a human deciding. */
export const directWrites = (project: Project) => project.connector?.directWrites === true;

/** The caller's role on a project, for a listing that has to say what they may do. */
export async function roleOn(caller: Caller, projectId: string, storage: Repo = repo()) {
  // No cookies on an MCP call, so no viewer link can be in play: membership
  // is the only way in, which `accessOf` reports as `via: "member"`.
  return accessOf(callerUser(caller), projectId, storage, []);
}

/** The handle a screen or object is addressed by, or its id when it has none. */
export const handleOf = (doc: Doc, id: string) => doc.handles?.[id] ?? id;

/**
 * The screen a tool was asked about: a handle (s2), a UniqueId, or the exact
 * name. Never a substring match - docs/LLD.md F2 is that an unresolved
 * reference is refused with the candidates named, because a tool that guessed
 * which screen was meant would render or edit the wrong one.
 */
export function findScreen(doc: Doc, ref: unknown): Screen {
  if (typeof ref !== "string" || !ref.trim()) throw new ServerError(400, "invalid", "Name the screen by its handle, from get_screens");
  const wanted = ref.trim().toLowerCase();
  const found = doc.screens.find(
    (s) => s.UniqueId.toLowerCase() === wanted || handleOf(doc, s.UniqueId).toLowerCase() === wanted || s.Name.toLowerCase() === wanted,
  );
  if (found) return found;
  const known = doc.screens.map((s) => `${handleOf(doc, s.UniqueId)} ${field(s.Name, 60)}`).join(", ");
  throw new ServerError(404, "not-found", `No screen is called that. The project has: ${known || "no screens"}`);
}

/** One object as a tool reports it: handle, name, type, and what drives it. */
export interface ObjectLine {
  handle: string;
  name: string;
  type: string;
  tag?: string;
}

/** A screen summarised: its handle and size, and every object on it. */
export interface ScreenLine {
  handle: string;
  name: string;
  width: number;
  height: number;
  objects: ObjectLine[];
}

/**
 * The project's screens, summarised rather than dumped. A scene graph of a
 * real plant application runs to megabytes and the cap is 150,000 characters
 * (docs/CONNECTOR_SPEC_NOTES.md §2), so what a caller gets is what it can
 * act on: handles to put in ops, and the tag behind each object.
 */
export function screenLines(doc: Doc): ScreenLine[] {
  const bound = new Map<string, string>();
  // The first binding that carries a value is the one worth naming; the rest
  // are colours and blink states, which say nothing about what the object is.
  for (const binding of doc.bindings) if (!bound.has(binding.targetId)) bound.set(binding.targetId, binding.tag);
  return doc.screens.map((screen) => {
    const view = screen.Children[0];
    // A view that never declared its own size is the panel's size, which is
    // what the canvas draws it at.
    const size = rootBox(view, { width: doc.target.width, height: doc.target.height });
    return {
      handle: handleOf(doc, screen.UniqueId),
      name: screen.Name,
      width: size.width,
      height: size.height,
      objects: view.Children.map((part) => ({
        handle: handleOf(doc, part.UniqueId),
        name: part.Name,
        type: part.Type,
        ...(bound.has(part.UniqueId) ? { tag: bound.get(part.UniqueId) } : {}),
      })),
    };
  });
}
