/**
 * Comments: the permissions matrix (viewers read, commenters write, authors
 * reword, authors or the owner delete), replies one level deep, and resolving.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRepo, COMMENT_MAX, type Role, type User } from "@/lib/server/repo";
import { createComment, deleteComment, listComments, unresolvedByScreen, updateComment } from "@/lib/server/comments";
import { createShare } from "@/lib/server/shares";
import { renderReport } from "@/lib/validation/report";
import { sample } from "./fixtures/collab";

let r: MemoryRepo;
const as = (id: string): User => ({ id, name: id });
const ROLES: Role[] = ["owner", "editor", "commenter", "viewer"];

beforeEach(async () => {
  r = new MemoryRepo();
  await r.projects.create("owner", sample());
  for (const role of ROLES) {
    await r.users.upsert(as(role));
    if (role !== "owner") await r.members.put("project-test", role, role);
  }
});

describe("permissions", () => {
  it("lets commenters and up write, viewers and links read, strangers nothing", async () => {
    const outcomes: Record<string, string> = {};
    for (const role of ROLES) {
      outcomes[role] = await createComment(as(role), "project-test", { body: `from ${role}` }, r).then(() => "ok", e => String(e.status));
    }
    expect(outcomes).toEqual({ owner: "ok", editor: "ok", commenter: "ok", viewer: "403" });
    expect((await listComments(as("viewer"), "project-test", [], r)).comments).toHaveLength(3);
    await expect(listComments(as("stranger"), "project-test", [], r)).rejects.toMatchObject({ status: 403 });
    await expect(createComment(as("stranger"), "project-test", { body: "hi" }, r)).rejects.toMatchObject({ status: 403 });
    const link = await createShare("project-test", "owner", { role: "viewer" }, r);
    const listed = await listComments(null, "project-test", [link.token], r);
    expect(listed.comments).toHaveLength(3);
    expect(listed.authors.owner).toBe("owner");
    await expect(listComments(null, "project-test", [], r)).rejects.toMatchObject({ status: 401 });
    await expect(createComment(null, "project-test", { body: "anonymous" }, r)).rejects.toMatchObject({ status: 401 });
  });
  it("edits a body only for its author, deletes for the author or the owner", async () => {
    const mine = await createComment(as("commenter"), "project-test", { body: "mine" }, r);
    await expect(updateComment(as("editor"), "project-test", mine._id, { body: "hijacked" }, r)).rejects.toMatchObject({ status: 403 });
    expect((await updateComment(as("commenter"), "project-test", mine._id, { body: "  reworded  " }, r)).body).toBe("reworded");
    await expect(deleteComment(as("editor"), "project-test", mine._id, r)).rejects.toMatchObject({ status: 403 });
    await expect(deleteComment(as("viewer"), "project-test", mine._id, r)).rejects.toMatchObject({ status: 403 });
    await deleteComment(as("owner"), "project-test", mine._id, r);
    const own = await createComment(as("editor"), "project-test", { body: "own" }, r);
    await deleteComment(as("editor"), "project-test", own._id, r);
    expect(await r.comments.list("project-test")).toEqual([]);
  });
  it("refuses an empty body and one over the limit", async () => {
    await expect(createComment(as("owner"), "project-test", { body: "   " }, r)).rejects.toMatchObject({ status: 400 });
    await expect(createComment(as("owner"), "project-test", { body: "x".repeat(COMMENT_MAX + 1) }, r)).rejects.toMatchObject({ status: 400 });
    expect((await createComment(as("owner"), "project-test", { body: "x".repeat(COMMENT_MAX) }, r)).body).toHaveLength(COMMENT_MAX);
  });
});

describe("threads", () => {
  it("keeps replies one level deep, where their thread is pinned", async () => {
    const thread = await createComment(as("owner"), "project-test", { body: "Move this lamp", screenId: "screen-1", objectId: "lamp-1", x: 40, y: 60 }, r);
    const reply = await createComment(as("commenter"), "project-test", { body: "Agreed", parentId: thread._id, screenId: "elsewhere", x: 1 }, r);
    expect(reply).toMatchObject({ parentId: thread._id, screenId: "screen-1", objectId: "lamp-1", x: 40, y: 60 });
    await expect(createComment(as("owner"), "project-test", { body: "Deeper", parentId: reply._id }, r)).rejects.toMatchObject({ status: 400 });
    await expect(createComment(as("owner"), "project-test", { body: "Orphan", parentId: "missing" }, r)).rejects.toMatchObject({ status: 404 });
    await deleteComment(as("owner"), "project-test", thread._id, r);
    expect(await r.comments.list("project-test")).toEqual([]);
  });
  it("resolves and reopens, recording who resolved", async () => {
    const thread = await createComment(as("owner"), "project-test", { body: "Check the colour", screenId: "screen-1" }, r);
    await createComment(as("owner"), "project-test", { body: "Project-wide note" }, r);
    expect(await unresolvedByScreen("project-test", r)).toEqual({ "screen-1": 1, "": 1 });
    await expect(updateComment(as("viewer"), "project-test", thread._id, { resolved: true }, r)).rejects.toMatchObject({ status: 403 });
    const resolved = await updateComment(as("commenter"), "project-test", thread._id, { resolved: true }, r);
    expect(resolved.resolvedBy).toBe("commenter");
    expect(resolved.resolvedAt).toBeTypeOf("number");
    expect(await unresolvedByScreen("project-test", r)).toEqual({ "": 1 });
    const reopened = await updateComment(as("editor"), "project-test", thread._id, { resolved: false }, r);
    expect(reopened.resolvedAt).toBeUndefined();
    expect(reopened.resolvedBy).toBeUndefined();
    await expect(updateComment(as("editor"), "project-test", thread._id, { resolved: "yes" }, r)).rejects.toMatchObject({ status: 400 });
  });
});

describe("sign-off", () => {
  it("lists unresolved comments per screen in the report", () => {
    const project = { name: "Station", target: { model: "HMIST6", width: 800, height: 480 }, screens: [], variables: [], alarms: [], wires: [] };
    const html = renderReport({ project, findings: [], comments: [{ screen: "Overview", unresolved: 2 }, { screen: "Pumps", unresolved: 0 }] });
    expect(html).toContain("Review comments");
    expect(html).toContain("<td>Overview</td><td>2</td>");
    expect(html).not.toContain("<td>Pumps</td>");
    expect(renderReport({ project, findings: [], comments: [] })).toContain("No unresolved comments");
    expect(renderReport({ project, findings: [] })).not.toContain("Review comments");
  });
});
