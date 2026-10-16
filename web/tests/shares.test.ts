/**
 * Share links: only the token's hash is stored, links expire and can be
 * revoked, joining never lowers a role, and a signed-out visitor can only ever
 * read - through a viewer link, for that one project.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRepo, type User } from "@/lib/server/repo";
import { accessOf, can } from "@/lib/server/access";
import { createShare, hashShareToken, inspectShare, joinShare, shareDays, shareTokens, SHARE_COOKIE } from "@/lib/server/shares";
import { sample } from "./fixtures/collab";

const state = vi.hoisted(() => ({ repo: null as unknown as MemoryRepo, user: null as User | null }));
vi.mock("@/lib/server/repo", async original => ({ ...await original<typeof import("@/lib/server/repo")>(), repo: () => state.repo }));
vi.mock("@/lib/server/session", () => ({ currentUser: async () => state.user }));
import { POST as open } from "@/app/api/shares/open/route";
import { GET as getProject } from "@/app/api/projects/[id]/route";
import { GET as listShares, POST as postShare } from "@/app/api/projects/[id]/shares/route";
import { DELETE as revokeShare } from "@/app/api/projects/[id]/shares/[shareId]/route";

const DAY = 24 * 60 * 60 * 1000;
let clock = 1_000_000;
const now = () => clock;
const context = (id = "project-test") => ({ params: Promise.resolve({ id }) });
const post = (url: string, body: unknown, cookie?: string) => new Request(`http://localhost${url}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body),
});

beforeEach(async () => {
  clock = 1_000_000;
  state.repo = new MemoryRepo(now);
  state.user = { id: "owner", name: "Owner" };
  await state.repo.projects.create("owner", sample());
  await state.repo.projects.create("owner", sample("other-project"));
});

describe("tokens", () => {
  it("stores only the SHA-256 of a 32-byte url-safe token", async () => {
    const { token, share } = await createShare("project-test", "owner", { role: "viewer" }, state.repo);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(share._id).toBe(hashShareToken(token));
    expect(share._id).toMatch(/^[0-9a-f]{64}$/);
    expect(hashShareToken(token)).toBe(hashShareToken(token));
    const stored = JSON.stringify(await state.repo.shares.list("project-test"));
    expect(stored).not.toContain(token);
  });
  it("reads cookie tokens and ignores anything that is not one", () => {
    const token = "a".repeat(43);
    const request = new Request("http://localhost/", { headers: { Cookie: `other=1; ${SHARE_COOKIE}=${token}.bogus` } });
    expect(shareTokens(request)).toEqual([token]);
    expect(shareTokens(new Request("http://localhost/"))).toEqual([]);
  });
});

describe("expiry and revocation", () => {
  it("defaults to 14 days, caps at 90, and reports an expired link", async () => {
    expect(shareDays(undefined)).toBe(14);
    expect(shareDays(400)).toBe(90);
    expect(shareDays(0)).toBe(1);
    const { token } = await createShare("project-test", "owner", { role: "viewer" }, state.repo);
    expect((await inspectShare(token, state.repo)).status).toBe("ok");
    clock += 14 * DAY + 1;
    expect((await inspectShare(token, state.repo)).status).toBe("expired");
    await expect(joinShare(token, { id: "bob", name: "Bob" }, state.repo)).rejects.toMatchObject({ status: 410, code: "expired" });
    expect(await accessOf(null, "project-test", state.repo, [token])).toBeNull();
  });
  it("stops a revoked link at once, for members and for cookies", async () => {
    const { token, share } = await createShare("project-test", "owner", { role: "viewer" }, state.repo);
    await state.repo.shares.revoke("project-test", share._id);
    expect((await inspectShare(token, state.repo)).status).toBe("revoked");
    await expect(joinShare(token, { id: "bob", name: "Bob" }, state.repo)).rejects.toMatchObject({ status: 410, code: "revoked" });
    expect(await can(null, "project-test", "read", state.repo, [token])).toBe(false);
    await expect(state.repo.shares.revoke("other-project", share._id)).rejects.toMatchObject({ status: 404 });
  });
  it("says a made-up token is missing", async () => {
    expect((await inspectShare("x".repeat(43), state.repo)).status).toBe("missing");
    expect((await inspectShare("short", state.repo)).status).toBe("missing");
  });
});

describe("joining", () => {
  it("never downgrades an existing role and upgrades a weaker one", async () => {
    const viewer = await createShare("project-test", "owner", { role: "viewer" }, state.repo);
    const editor = await createShare("project-test", "owner", { role: "editor" }, state.repo);
    await state.repo.members.put("project-test", "ed", "editor");
    expect(await joinShare(viewer.token, { id: "ed", name: "Ed" }, state.repo)).toEqual({ projectId: "project-test", role: "editor" });
    expect((await state.repo.members.get("project-test", "ed"))?.role).toBe("editor");
    expect((await joinShare(viewer.token, { id: "owner", name: "O" }, state.repo)).role).toBe("owner");
    expect((await joinShare(viewer.token, { id: "val", name: "Val" }, state.repo)).role).toBe("viewer");
    expect((await joinShare(editor.token, { id: "val", name: "Val" }, state.repo)).role).toBe("editor");
    expect((await state.repo.members.get("project-test", "val"))?.role).toBe("editor");
  });
  it("keeps the export flag of a viewer link on the membership it creates", async () => {
    const quiet = await createShare("project-test", "owner", { role: "viewer" }, state.repo);
    await joinShare(quiet.token, { id: "val", name: "Val" }, state.repo);
    expect(await can({ id: "val", name: "Val" }, "project-test", "read", state.repo)).toBe(true);
    expect(await can({ id: "val", name: "Val" }, "project-test", "export", state.repo)).toBe(false);
    const loud = await createShare("project-test", "owner", { role: "viewer", allowExport: true }, state.repo);
    await joinShare(loud.token, { id: "val", name: "Val" }, state.repo);
    expect(await can({ id: "val", name: "Val" }, "project-test", "export", state.repo)).toBe(true);
  });
});

describe("signed-out visitors", () => {
  it("read through a viewer link, for that one project only", async () => {
    const viewer = await createShare("project-test", "owner", { role: "viewer" }, state.repo);
    const access = await accessOf(null, "project-test", state.repo, [viewer.token]);
    expect(access).toEqual({ role: "viewer", actions: ["read"], via: "share" });
    expect(await can(null, "other-project", "read", state.repo, [viewer.token])).toBe(false);
    for (const action of ["comment", "edit", "manage", "export"] as const) {
      expect(await can(null, "project-test", action, state.repo, [viewer.token])).toBe(false);
    }
  });
  it("get nothing from a commenter or editor cookie", async () => {
    const commenter = await createShare("project-test", "owner", { role: "commenter" }, state.repo);
    const editor = await createShare("project-test", "owner", { role: "editor" }, state.repo);
    expect(await accessOf(null, "project-test", state.repo, [commenter.token, editor.token])).toBeNull();
  });
  it("get a cookie for a viewer link and a sign-in request for the others", async () => {
    state.user = null;
    const viewer = await createShare("project-test", "owner", { role: "viewer" }, state.repo);
    const editor = await createShare("project-test", "owner", { role: "editor" }, state.repo);
    const opened = await open(post("/api/shares/open", { token: viewer.token }));
    expect(opened.status).toBe(200);
    expect(await opened.json()).toEqual({ projectId: "project-test", role: "viewer", member: false });
    const cookie = opened.headers.get("Set-Cookie")!;
    expect(cookie).toContain(`${SHARE_COOKIE}=${viewer.token}`);
    expect(cookie).toContain("HttpOnly");
    expect((await open(post("/api/shares/open", { token: editor.token }))).status).toBe(401);
    const read = await getProject(new Request("http://localhost/api/projects/project-test", { headers: { Cookie: `${SHARE_COOKIE}=${viewer.token}` } }), context());
    expect(read.status).toBe(200);
    expect((await read.json()).access).toMatchObject({ role: "viewer", via: "share" });
    const other = await getProject(new Request("http://localhost/api/projects/other-project", { headers: { Cookie: `${SHARE_COOKIE}=${viewer.token}` } }), context("other-project"));
    expect(other.status).toBe(401);
  });
  it("become members when they open a link signed in", async () => {
    const commenter = await createShare("project-test", "owner", { role: "commenter" }, state.repo);
    state.user = { id: "cat", name: "Cat" };
    const opened = await open(post("/api/shares/open", { token: commenter.token }));
    expect(await opened.json()).toEqual({ projectId: "project-test", role: "commenter", member: true });
    expect(opened.headers.get("Set-Cookie")).toBeNull();
    expect((await state.repo.members.get("project-test", "cat"))?.role).toBe("commenter");
  });
});

describe("routes", () => {
  it("lets only the owner create, list and revoke links, and never lists a token", async () => {
    const created = await postShare(post("/api/projects/project-test/shares", { role: "viewer", days: 3 }), context());
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.url).toBe(`/s/${body.token}`);
    expect(body.share).toMatchObject({ role: "viewer", allowExport: false, expiresAt: clock + 3 * DAY });
    const listed = await (await listShares(new Request("http://localhost/x"), context())).json();
    expect(JSON.stringify(listed)).not.toContain(body.token);
    expect(listed.shares[0].id).toBe(hashShareToken(body.token));
    await state.repo.members.put("project-test", "ed", "editor");
    state.user = { id: "ed", name: "Ed" };
    expect((await postShare(post("/api/projects/project-test/shares", { role: "viewer" }), context())).status).toBe(403);
    state.user = { id: "owner", name: "Owner" };
    const revoked = await revokeShare(new Request("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ id: "project-test", shareId: body.share.id }) });
    expect((await revoked.json()).share.revokedAt).toBe(clock);
    expect((await postShare(post("/api/projects/project-test/shares", { role: "owner" }), context())).status).toBe(400);
  });
});
