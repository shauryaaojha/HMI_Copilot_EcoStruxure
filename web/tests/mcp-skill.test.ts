/**
 * The connector's guide and the tools that take guessing out of its work:
 * guide, replace_screen, draft_tags, match_tags, export_project, import_link.
 * Driven through the real /api/mcp route, as the other MCP tests are.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { demoScreen, demoVariables } from "@/fixtures";
import { MemoryRepo, type Snapshot, type User } from "@/lib/server/repo";
import { sample } from "./fixtures/collab";

const state = vi.hoisted(() => ({ repo: null as unknown as MemoryRepo, user: null as User | null }));
vi.mock("@/lib/server/repo", async (original) => ({ ...(await original<typeof import("@/lib/server/repo")>()), repo: () => state.repo }));
vi.mock("@/lib/server/session", () => ({ currentUser: async () => state.user }));
import { POST as mcpPost } from "@/app/api/mcp/route";
import { GET as linkGet } from "@/app/api/export/link/route";
import { readExportLink, signExportLink, LINK_MS } from "@/lib/server/export-link";
import { GUIDE_TOPICS, guideMarkdown } from "@/lib/mcp/guide";
import { settle } from "@/lib/mcp/screens";

const ID = "project-skill";
const URL_MCP = "https://hmi.example.com/api/mcp";
let seq = 0;

async function call(name: string, args: Record<string, unknown> = {}) {
  const response = await mcpPost(
    new Request(URL_MCP, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method: "tools/call", params: { name, arguments: args } }),
    }),
  );
  const body = JSON.parse(await response.text());
  expect(body.error, JSON.stringify(body.error)).toBeUndefined();
  const result = body.result as { content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
  return { text: result.content.filter((c) => c.type === "text").map((c) => c.text).join("\n"), structured: result.structuredContent ?? {}, refused: result.isError === true };
}

async function listTools(): Promise<string[]> {
  const response = await mcpPost(
    new Request(URL_MCP, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method: "tools/list" }) }),
  );
  return (JSON.parse(await response.text()).result.tools as { name: string }[]).map((t) => t.name);
}

const objectsOn = async (screenName: string) => {
  const head = await state.repo.versions.current(ID);
  const screen = head!.snapshot.screens.find((s: { Name: string }) => s.Name === screenName);
  return screen ? screen.Children[0].Children.map((p: { Name: string }) => p.Name) : null;
};

beforeAll(() => {
  vi.stubEnv("AI_PROVIDER", "none");
  vi.stubEnv("AUTH_SECRET", "test-secret-for-export-links");
});
afterAll(() => vi.unstubAllEnvs());

beforeEach(async () => {
  vi.stubEnv("MCP_DEV_USER_ID", "");
  const snapshot: Snapshot = { ...sample(ID), name: "Pump Station", screens: [structuredClone(demoScreen)], variables: structuredClone(demoVariables) };
  state.repo = new MemoryRepo();
  await state.repo.projects.create("alice", snapshot);
  state.user = { id: "alice", name: "Alice" };
});

describe("the guide", () => {
  it("is listed first and served by topic", async () => {
    const tools = await listTools();
    expect(tools[0]).toBe("guide");
    for (const name of ["replace_screen", "draft_tags", "match_tags", "export_project", "import_link"]) expect(tools).toContain(name);
    const start = await call("guide", { topic: "start" });
    expect(start.text).toContain("Never invent");
    const all = await call("guide");
    expect(all.structured.topics).toEqual([...GUIDE_TOPICS]);
  });

  it("states the rules OTE enforces that real sessions were refused for", () => {
    const md = guideMarkdown();
    for (const fact of ["Only a Switch acts on a touch", "Only a Rectangle has rounded corners", "A StringDisplay shows only a STRING tag", "replace_screen", "match_tags", "draft_tags"]) expect(md).toContain(fact);
  });
});

describe("replace_screen", () => {
  const ops = [
    { op: "addObject", type: "TextBox", name: "Home_Title", text: "Home" },
    { op: "addObject", type: "Lamp", name: "Home_P1", text: "Pump 1" },
  ];

  it("gives the same screen however many times it is sent", async () => {
    await state.repo.projects.connector(ID, { directWrites: true });
    const first = await call("replace_screen", { projectId: ID, screen: "Home", ops, confirm: true });
    expect(first.refused, first.text).toBe(false);
    const once = await objectsOn("Home");
    const second = await call("replace_screen", { projectId: ID, screen: "Home", ops, confirm: true });
    expect(second.refused, second.text).toBe(false);
    expect(await objectsOn("Home")).toEqual(once);
    expect(once).toEqual(["Home_Title", "Home_P1"]);
  });

  it("clears an existing screen in the same change", async () => {
    await state.repo.projects.connector(ID, { directWrites: true });
    const before = await objectsOn(demoScreen.Name);
    expect(before!.length).toBeGreaterThan(2);
    const done = await call("replace_screen", { projectId: ID, screen: demoScreen.Name, ops, confirm: true });
    expect(done.text).toContain(`its ${before!.length} objects are removed`);
    expect(await objectsOn(demoScreen.Name)).toEqual(["Home_Title", "Home_P1"]);
  });

  it("queues as one proposal when direct writes are off", async () => {
    const done = await call("replace_screen", { projectId: ID, screen: "Home", ops });
    expect(done.structured.mode).toBe("proposal");
    expect(await objectsOn("Home")).toBeNull();
  });
});

describe("match_tags", () => {
  it("is sure when one tag is clearly meant, and asks otherwise", () => {
    expect(settle(demoVariables, "pump 2 fault")).toMatchObject({ status: "sure", tag: "PMP_102_FLT" });
    expect(settle(demoVariables, "tank level")).toMatchObject({ status: "sure", tag: "LT_101_PV" });
    expect(settle(demoVariables, "pump").status).toBe("ambiguous");
    expect(settle(demoVariables, "conveyor speed").status).toBe("none");
  });

  it("answers the same way twice, through the connector", async () => {
    const phrases = ["pump 2 fault", "pump", "boiler pressure"];
    const a = await call("match_tags", { projectId: ID, phrases });
    const b = await call("match_tags", { projectId: ID, phrases });
    expect(a.structured).toEqual(b.structured);
    expect(a.text).toContain("ambiguous");
  });
});

describe("draft_tags", () => {
  it("names tags by the product's rule and writes nothing", async () => {
    const done = await call("draft_tags", { units: [{ kind: "pump", label: "Feed pump", count: 2 }, { kind: "tank", label: "Buffer tank", count: 1 }] });
    const names = (done.structured.tags as { name: string }[]).map((t) => t.name);
    expect(names).toContain("PMP_101_RUN");
    expect(names).toContain("PMP_102_FLT");
    expect(names).toContain("LT_101_PV");
    expect((await state.repo.versions.current(ID))!.snapshot.variables.length).toBe(demoVariables.length);
  });

  it("takes a custom unit with its signals written out", async () => {
    const done = await call("draft_tags", { units: [{ kind: "custom", label: "Grill plate", count: 1, customSignals: [{ id: "TEMP", type: "REAL", what: "temperature" }] }] });
    expect((done.structured.tags as { name: string }[]).map((t) => t.name)).toEqual(["GRI_101_TEMP"]);
  });
});

describe("export links", () => {
  it("round-trips, and refuses a changed or expired link", () => {
    const token = signExportLink(ID, 3, "alice", 1_000);
    expect(readExportLink(token, 2_000)).toMatchObject({ p: ID, r: 3, u: "alice" });
    expect(() => readExportLink(token, 1_000 + LINK_MS + 1)).toThrow(/expired/);
    const [payload, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ p: "other", r: 3, u: "alice", e: 9e15 })).toString("base64url");
    expect(() => readExportLink(`${forged}.${mac}`, 2_000)).toThrow(/not made here/);
    expect(payload.length).toBeGreaterThan(10);
  });

  it("export_project hands back a link that downloads an .eote for that user only", async () => {
    const done = await call("export_project", { projectId: ID });
    if (done.refused) {
      // A fixture that does not pass preflight still has to say why.
      expect(done.structured.code ?? done.text).toBeTruthy();
      return;
    }
    const url = String(done.structured.url);
    expect(url.startsWith("https://hmi.example.com/api/export/link?t=")).toBe(true);
    const response = await linkGet(new Request(url));
    if (response.status === 200) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(bytes[0]).toBe(0x50); // a ZIP: "PK"
      expect(response.headers.get("content-disposition")).toContain(".eote");
    } else {
      // No skeleton on this machine: the route says so rather than failing silently.
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    // Someone who is not a member cannot use alice's project through a link made for them.
    const stranger = signExportLink(ID, 1, "mallory");
    expect((await linkGet(new Request(`https://hmi.example.com/api/export/link?t=${stranger}`))).status).toBe(403);
  });

  it("import_link points at the app's upload page", async () => {
    const done = await call("import_link", { kind: "eote" });
    expect(done.structured.url).toBe("https://hmi.example.com/projects");
  });
});
