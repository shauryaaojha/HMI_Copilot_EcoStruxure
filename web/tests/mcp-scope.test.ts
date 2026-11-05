/**
 * S3-01 (docs/audit/BUGS.md): a connector token's scopes are enforced. Moved
 * from web/scripts/audit/ with the fix. Before it, scopes were recorded and
 * never read.
 *
 * The consent screen lists scope by scope what the engineer grants
 * (lib/server/oauth.ts SCOPE_LABEL), and a client that asked only for
 * `mcp:read` gets a consent page that says only "Read the projects...". The
 * token then carries `scopes: ["mcp:read"]` onto the Caller
 * (lib/mcp/caller.ts:92) - and no tool ever reads it. So a read-only token
 * still queues proposals (and on a direct-writes project, writes).
 *
 * Expected: a write tool called with a token that lacks `mcp:write` is refused
 * (MCP authorization, "Scope Challenge Handling": 403 insufficient_scope, or at
 * least an isError result). Actual: the proposal is queued.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoScreen, demoVariables } from "@/fixtures";
import { MemoryRepo, type Snapshot, type User } from "@/lib/server/repo";
import { tokenHash } from "@/lib/server/oauth";
import { sample } from "./fixtures/collab";

const state = vi.hoisted(() => ({ repo: null as unknown as MemoryRepo, user: null as User | null }));
vi.mock("@/lib/server/repo", async (original) => ({ ...(await original<typeof import("@/lib/server/repo")>()), repo: () => state.repo }));
vi.mock("@/lib/server/session", () => ({ currentUser: async () => state.user }));
import { POST as mcpPost } from "@/app/api/mcp/route";

const ID = "project-scope";
const URL_MCP = "https://hmi.example.com/api/mcp";
const READ_ONLY_TOKEN = "s3-read-only-token-0123456789abcdef0123456789abcdef";
const WRITE_TOKEN = "s3-read-write-token-0123456789abcdef0123456789abcdef";

async function callWith(token: string, name: string, args: Record<string, unknown>) {
  const response = await mcpPost(
    new Request(URL_MCP, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }),
  );
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return { status: response.status, challenge: response.headers.get("WWW-Authenticate"), result: body?.result as { isError?: boolean; content: { text?: string }[]; structuredContent?: Record<string, unknown> } | undefined };
}

beforeEach(async () => {
  vi.stubEnv("AI_PROVIDER", "none");
  vi.stubEnv("MCP_DEV_USER_ID", "");
  state.repo = new MemoryRepo();
  const screen = structuredClone(demoScreen);
  const snapshot: Snapshot = { ...sample(ID), name: "Scope test", screens: [screen], variables: structuredClone(demoVariables), handles: { [screen.UniqueId]: "s1" }, handleSeq: 2 };
  await state.repo.projects.create("alice", snapshot);
  state.user = null; // a connector call carries no browser session
  // What approveAuthorization + the token endpoint store for a client that asked for scope=mcp:read only.
  const grant = await state.repo.connector.putGrant({
    userId: "alice", clientId: "client_s3", clientName: "Read-only client", redirectHost: "127.0.0.1:33418",
    scopes: ["mcp:read"], resource: URL_MCP, createdAt: Date.now(),
  });
  await state.repo.connector.issue({
    hash: tokenHash(READ_ONLY_TOKEN), kind: "access", userId: "alice", scopes: ["mcp:read"],
    grantId: grant._id, audience: URL_MCP, createdAt: Date.now(), expiresAt: Date.now() + 3_600_000,
  });
  const writeGrant = await state.repo.connector.putGrant({
    userId: "alice", clientId: "client_s3w", clientName: "Read-write client", redirectHost: "127.0.0.1:33418",
    scopes: ["mcp:read", "mcp:write"], resource: URL_MCP, createdAt: Date.now(),
  });
  await state.repo.connector.issue({
    hash: tokenHash(WRITE_TOKEN), kind: "access", userId: "alice", scopes: ["mcp:read", "mcp:write"],
    grantId: writeGrant._id, audience: URL_MCP, createdAt: Date.now(), expiresAt: Date.now() + 3_600_000,
  });
});

describe("S3-01 scope enforcement", () => {
  it("challenges an invalid token with invalid_token", async () => {
    const r = await callWith("not-a-token", "list_projects", {});
    expect(r.status).toBe(401);
    expect(r.challenge).toContain('error="invalid_token"');
    expect(r.challenge).toContain("resource_metadata=");
  });
  it("a token granted only mcp:read can read", async () => {
    const r = await callWith(READ_ONLY_TOKEN, "list_projects", {});
    expect(r.status).toBe(200);
    expect(r.result?.isError).not.toBe(true);
  });

  it("a token granted only mcp:read is refused by the write tool `propose`", async () => {
    const r = await callWith(READ_ONLY_TOKEN, "propose", {
      projectId: ID,
      note: "rename the screen",
      ops: [{ op: "renameScreen", screen: "s1", target: "Renamed by a read-only token", note: "rename" }],
    });
    const queued = (await state.repo.proposals.list(ID)).length;
    expect(
      r.status === 403 || r.result?.isError === true,
      `read-only token (scopes ["mcp:read"]) was NOT refused: HTTP ${r.status}, isError=${r.result?.isError}, proposals queued=${queued}, structured=${JSON.stringify(r.result?.structuredContent)}`,
    ).toBe(true);
    expect(r.status).toBe(403);
    expect(r.challenge).toContain('error="insufficient_scope"');
    expect(r.challenge).toContain('scope="mcp:write"');
  });

  it("a token granted mcp:write still queues a proposal", async () => {
    const r = await callWith(WRITE_TOKEN, "propose", {
      projectId: ID,
      note: "rename the screen",
      ops: [{ op: "renameScreen", screen: "s1", target: "Renamed with write scope", note: "rename" }],
    });
    expect(r.result?.isError).not.toBe(true);
    expect((await state.repo.proposals.list(ID)).length).toBe(1);
  });
});
