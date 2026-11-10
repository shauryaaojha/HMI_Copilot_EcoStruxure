/**
 * The project around the screens: what is waiting for the engineer, whether
 * changes wait at all, and renaming, copying and deleting a project.
 *
 * These are the things an engineer does in the app's project pages. Each asks
 * `lib/server/access.ts` the same question the app's own route asks, so the
 * connector can do exactly what the person signed in to it may do and nothing
 * more: turning direct writes on needs "manage", as it does in the app.
 */
import { z } from "zod";
import { announceRevision } from "@/lib/realtime/announce";
import { ServerError } from "@/lib/server/errors";
import { repo } from "@/lib/server/repo";
import { callerUser } from "./caller";
import { field, limited, projectData, RESULT_LIMIT } from "./data";
import { directWrites, openProject } from "./project";
import { refusal } from "./result";
import { tool, type McpTool } from "./spec";

const projectId = z.string().describe("The project id, from list_projects.");

const proposals = tool({
  name: "proposals",
  title: "Proposals",
  description:
    "What is waiting for the engineer on a project, and what they decided about earlier changes: each proposal's id, its request, its changes, and whether it is open, accepted or discarded. Call it before telling the engineer something is still waiting, and after they say they accepted, to see what landed.",
  annotations: { readOnlyHint: true, openWorldHint: false },
  input: {
    projectId,
    status: z.enum(["open", "decided", "all"]).optional().describe("Only the open ones, only the decided ones, or all. Open if left out."),
  },
  async run({ projectId: id, status }, { caller }) {
    await openProject(caller, id, "read");
    const wanted = status ?? "open";
    const rows = (await repo().proposals.list(id))
      .filter((p) => wanted === "all" || (wanted === "open" ? p.status === "open" : p.status !== "open"))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 30);
    const lines = rows.flatMap((p) => [
      `${p._id}  ${p.status}${p.decidedByName ? ` by ${field(p.decidedByName, 60)}` : ""}${p.rev ? `, landed as revision ${p.rev}` : ""}  "${field(p.request, 160)}"`,
      ...p.labels.slice(0, 8).map((l, i) => `    ${p.status === "accepted" && p.acceptedOpIndexes && !p.acceptedOpIndexes.includes(i) ? "left out" : "change"}: ${field(l, 200)}`),
      ...(p.labels.length > 8 ? [`    and ${p.labels.length - 8} more`] : []),
      ...p.rejected.slice(0, 4).map((r) => `    could not be done: ${field(r, 200)}`),
    ]);
    return {
      text: [
        rows.length ? `${rows.length} proposal${rows.length === 1 ? "" : "s"} (${wanted}).` : `No ${wanted === "all" ? "" : `${wanted} `}proposals on this project.`,
        projectData("proposals", limited(lines.length ? lines : ["none"], RESULT_LIMIT - 2_000)),
      ].join("\n"),
      structured: { count: rows.length, open: rows.filter((p) => p.status === "open").length, ids: rows.map((p) => p._id) },
    };
  },
});

const setDirectWrites = tool({
  name: "set_direct_writes",
  title: "Direct writes on or off",
  description:
    "Whether changes to a project land at once or wait as proposals for the engineer to accept. Turn it on only when the engineer has said, in this conversation, that changes may land without their accepting each one; turn it off when they ask for review again. Needs the engineer to be the project's owner. Deleting, and changing a project opened from the engineer's own file, still need confirm: true on the change itself.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  input: { projectId, on: z.boolean().describe("True: changes land at once. False: every change waits for the engineer.") },
  async run({ projectId: id, on }, { caller }) {
    const { project } = await openProject(caller, id, "manage");
    if (directWrites(project) === on) return { text: `Direct writes were already ${on ? "on" : "off"} for "${field(project.name, 120)}".`, structured: { directWrites: on, changed: false } };
    await repo().projects.connector(id, { directWrites: on });
    return {
      text: on
        ? `Direct writes are now on for "${field(project.name, 120)}": what you change lands at once, and render_screen shows it straight away. Tell the engineer; they can turn it off on the project's page or by asking.`
        : `Direct writes are now off for "${field(project.name, 120)}": every change waits as a proposal for the engineer to accept.`,
      structured: { directWrites: on, changed: true },
    };
  },
});

const renameProject = tool({
  name: "rename_project",
  title: "Rename a project",
  description: "Gives a project a new name. The screens, tags and history are untouched, and a tab that has it open shows the new name.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  input: { projectId, name: z.string().min(1).max(255).describe("The new name.") },
  async run({ projectId: id, name: asked }, { caller }) {
    const { project, rev } = await openProject(caller, id, "edit");
    const name = asked.trim();
    if (!name) return refusal("A project name needs at least one character.", "invalid");
    // A rename is an edit of the document, so it travels as one, as the app's own rename does.
    const result = await repo().live.append(id, [{ id: crypto.randomUUID(), base: rev, author: caller.userId, ops: [{ kind: "setField", field: "name", value: name }] }]);
    if (result.rejected.length > 0) throw new ServerError(409, "stale", "The project changed while this was being done; try the rename again");
    announceRevision({ projectId: id, rev: result.rev, author: caller.userId });
    return { text: `Renamed "${field(project.name, 120)}" to "${field(name, 120)}".`, structured: { projectId: id, name, rev: result.rev } };
  },
});

const duplicateProject = tool({
  name: "duplicate_project",
  title: "Copy a project",
  description: "Makes a copy of a project as it stands now, owned by the engineer. Use it to try a redesign without touching the original, or to start a similar machine from one that is done. The copy's history and conversation start empty.",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  input: { projectId, name: z.string().min(1).max(255).optional().describe("The copy's name. '<name> copy' if left out.") },
  async run({ projectId: id, name }, { caller }) {
    // A copy is a way out of the project, so it asks what an export asks.
    const { project } = await openProject(caller, id, "export");
    const version = await repo().versions.current(id);
    if (!version) throw new ServerError(409, "no-snapshot", "That project has no saved snapshot yet; open it in the app once");
    const copyName = (name?.trim() || `${project.name} copy`).slice(0, 255);
    const copy = await repo().projects.create(callerUser(caller).id, { ...version.snapshot, id: crypto.randomUUID(), name: copyName, versions: [], chat: [] }, project.layout);
    return {
      text: `Copied "${field(project.name, 120)}" to project ${copy._id} "${field(copyName, 120)}". Changes to the copy wait as proposals until direct writes are turned on for it.`,
      structured: { projectId: copy._id, name: copyName, from: id },
    };
  },
});

const deleteProject = tool({
  name: "delete_project",
  title: "Delete a project",
  description:
    "Deletes a project for good: its screens, tags, history and comments. It cannot be brought back. Only when the engineer has asked for this project to be deleted, by name, in this conversation; say its name and what is in it and get a yes first. Needs the engineer to be its owner.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  input: {
    projectId,
    confirmName: z.string().describe("The project's exact name, as list_projects shows it. A delete whose name does not match is refused."),
  },
  async run({ projectId: id, confirmName }, { caller }) {
    const { project } = await openProject(caller, id, "manage");
    if (confirmName.trim() !== project.name) {
      return refusal(`Not deleted: the name given does not match this project's name, "${field(project.name, 120)}". Check with the engineer which project they mean.`, "needs-confirm");
    }
    await repo().projects.delete(id);
    return { text: `Deleted project "${field(project.name, 120)}". It cannot be brought back.`, structured: { deleted: true, projectId: id } };
  },
});

export const MANAGE_TOOLS: readonly McpTool[] = [proposals, setDirectWrites, renameProject, duplicateProject, deleteProject];
