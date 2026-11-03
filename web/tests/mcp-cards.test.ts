/**
 * The two MCP Apps preview cards: phase 4, M4.
 *
 * Two halves, and the second is the one that matters more. The first drives the
 * server over JSON-RPC, the way mcp.test.ts does, to see that the host finds
 * the card where the docs say it looks - `_meta.ui.resourceUri` on the tool, the
 * `ui://` resource behind it, and the data on the result - and that `validate`
 * and `render_screen` answer a text-only client exactly what they answered
 * before the cards existed. A card that cost the plain answer anything would be
 * a bad trade whatever it looked like.
 *
 * The second half reads the card documents as text, because the things that go
 * wrong in a sandboxed frame are invisible from here: an origin nobody declared,
 * a colour that only exists in light mode, a width that needs 400 px. Those are
 * checkable as strings, so they are checked as strings.
 *
 * No model is called, and no frame is rendered: there is no host to render in.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { demoScreen, demoVariables } from "@/fixtures";
import { MemoryRepo, type Snapshot, type User } from "@/lib/server/repo";
import type { Variable } from "@/lib/ote/schema";
import { sample } from "./fixtures/collab";

const state = vi.hoisted(() => ({ repo: null as unknown as MemoryRepo, user: null as User | null }));
vi.mock("@/lib/server/repo", async original => ({ ...await original<typeof import("@/lib/server/repo")>(), repo: () => state.repo }));
vi.mock("@/lib/server/session", () => ({ currentUser: async () => state.user }));
import { POST as mcpPost } from "@/app/api/mcp/route";
import { CARD_CSP, CARD_MIME_TYPE, CARD_RESOURCES, SCREEN_CARD_URI, VALIDATION_CARD_URI } from "@/lib/mcp/cards";
import { toolResult } from "@/lib/mcp/result";
import { TOOLS } from "@/lib/mcp/tools";

const ID = "project-test";
const URL_MCP = "https://hmi.example.com/api/mcp";

let seq = 0;

async function rpc(method: string, params?: unknown) {
  const response = await mcpPost(
    new Request(URL_MCP, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, ...(params ? { params } : {}) }),
    }),
  );
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

/** One tool call, as the whole result: `_meta` is the point here. */
async function call(name: string, args: Record<string, unknown> = {}) {
  const { body } = await rpc("tools/call", { name, arguments: args });
  expect(body.error, `${name} answered a protocol error: ${JSON.stringify(body.error)}`).toBeUndefined();
  return body.result as {
    content: { type: string; text?: string; data?: string; mimeType?: string }[];
    structuredContent?: Record<string, unknown>;
    _meta?: { ui?: { resourceUri?: string; data?: Record<string, unknown> } };
    isError?: boolean;
  };
}

beforeAll(() => vi.stubEnv("AI_PROVIDER", "none"));
afterAll(() => vi.unstubAllEnvs());

beforeEach(async () => {
  vi.stubEnv("MCP_DEV_USER_ID", "");
  const screen = structuredClone(demoScreen);
  const lamp = screen.Children[0].Children.find(p => p.Name === "Lamp_PUMP1_RUN")!;
  const variables: Variable[] = [
    ...structuredClone(demoVariables),
    { Name: "LVL_201_PV", DataType: "REAL", Comments: "never shown on a screen", DeviceAddress: "" },
  ];
  const snapshot: Snapshot = {
    ...sample(ID),
    name: "Pump Station",
    screens: [screen],
    variables,
    handles: { [screen.UniqueId]: "s1", [lamp.UniqueId]: "o1" },
    handleSeq: 2,
    bindings: [{ tag: "PMP_101_RUN", targetId: lamp.UniqueId, targetName: lamp.Name, property: "CurrentValue" }],
  };
  state.repo = new MemoryRepo();
  await state.repo.projects.create("alice", snapshot);
  state.user = { id: "alice", name: "Alice" };
});

describe("how the host finds a card", () => {
  it("names the card on the tool definition, where tools/list is read", async () => {
    const { body } = await rpc("tools/list");
    const tools = body.result.tools as { name: string; _meta?: { ui?: { resourceUri?: string } } }[];
    const uris = Object.fromEntries(tools.map(t => [t.name, t._meta?.ui?.resourceUri]));
    expect(uris.render_screen).toBe(SCREEN_CARD_URI);
    expect(uris.validate).toBe(VALIDATION_CARD_URI);
    // Exactly two tools claim a card. A tool that grew one by accident - by
    // copying a neighbour's definition, say - shows up here.
    expect(tools.filter(t => t._meta?.ui).map(t => t.name).sort()).toEqual(["render_screen", "validate"]);
    expect(TOOLS.filter(t => t.ui).map(t => t.name).sort()).toEqual(["render_screen", "validate"]);
  });

  it("serves both cards as ui:// resources with the MCP App MIME type", async () => {
    const { body } = await rpc("resources/list");
    const resources = body.result.resources as { uri: string; mimeType?: string }[];
    expect(resources.map(r => r.uri).sort()).toEqual([SCREEN_CARD_URI, VALIDATION_CARD_URI]);
    for (const uri of [SCREEN_CARD_URI, VALIDATION_CARD_URI]) {
      expect(uri.startsWith("ui://")).toBe(true);
      const read = await rpc("resources/read", { uri });
      const contents = read.body.result.contents as { uri: string; mimeType: string; text: string; _meta?: unknown }[];
      expect(contents).toHaveLength(1);
      expect(contents[0].mimeType).toBe(CARD_MIME_TYPE);
      expect(CARD_MIME_TYPE).toBe("text/html;profile=mcp-app");
      expect(contents[0].text).toContain("<!DOCTYPE html>");
    }
  });

  it("declares a CSP on the resource that asks for no origin at all", async () => {
    for (const uri of [SCREEN_CARD_URI, VALIDATION_CARD_URI]) {
      const { body } = await rpc("resources/read", { uri });
      const meta = (body.result.contents as { _meta?: { ui?: { csp?: Record<string, string[]> } } }[])[0]._meta;
      const csp = meta?.ui?.csp;
      expect(csp).toEqual({ connectDomains: [], resourceDomains: [], baseUriDomains: [] });
      // Stated, not omitted: every list the host honours is spelled out empty,
      // and `frameDomains` is absent because Claude restricts it.
      expect(Object.keys(csp!).sort()).toEqual(["baseUriDomains", "connectDomains", "resourceDomains"]);
      expect(csp).not.toHaveProperty("frameDomains");
    }
  });

  it("asks for no wildcard anywhere in the policy", () => {
    const origins = Object.values(CARD_CSP).flat();
    expect(origins).toEqual([]);
    expect(JSON.stringify(CARD_CSP)).not.toContain("*");
  });
});

describe("the screen preview card", () => {
  it("carries the screen's name, what is on it and what is bound", async () => {
    const result = await call("render_screen", { projectId: ID, screenId: "s1" });
    expect(result._meta?.ui?.resourceUri).toBe(SCREEN_CARD_URI);
    const data = result._meta!.ui!.data as {
      handle: string;
      name: string;
      width: number;
      height: number;
      scale: number;
      objects: number;
      bound: number;
      bindings: { handle: string; name: string; type: string; tag?: string }[];
      more: number;
    };
    expect(data.handle).toBe("s1");
    expect(data.name).toBe(demoScreen.Name);
    expect(data).toMatchObject({ width: 1024, height: 600 });
    expect(data.objects).toBeGreaterThan(0);
    // One binding in the fixture, and the card names the tag behind it.
    expect(data.bound).toBe(1);
    expect(data.bindings.find(b => b.tag)?.tag).toBe("PMP_101_RUN");
    expect(data.bindings.every(b => b.handle && b.name && b.type)).toBe(true);
    expect(data.bindings.length + data.more).toBe(data.objects);
  });

  it("points the card at the PNG already in the result rather than sending it twice", async () => {
    const result = await call("render_screen", { projectId: ID, screenId: "s1" });
    const image = result.content.find(c => c.type === "image")!;
    expect(image.data).toBeTruthy();
    // The frame builds a data: URI out of the image content, so the biggest
    // thing in the result appears once against the 150,000-character cap.
    expect(JSON.stringify(result._meta)).not.toContain(image.data!.slice(0, 64));
    expect(CARD_RESOURCES[SCREEN_CARD_URI].html).toContain('"data:"');
  });
});

describe("the validation card", () => {
  it("groups the findings by severity, each naming its object or its tag", async () => {
    const result = await call("validate", { projectId: ID });
    expect(result._meta?.ui?.resourceUri).toBe(VALIDATION_CARD_URI);
    const data = result._meta!.ui!.data as {
      projectId: string;
      all: number;
      errors: number;
      warnings: number;
      info: number;
      findings: { severity: string; rule: string; message: string; where: string }[];
    };
    expect(data.projectId).toBe(ID);
    expect(data.all).toBe(data.errors + data.warnings + data.info);
    expect(data.findings.length).toBeGreaterThan(0);
    expect(data.findings.length).toBeLessThanOrEqual(data.all);
    // Grouped means at most three of any one severity reach the card, so a
    // run full of errors still shows the notes underneath them.
    for (const severity of ["error", "warning", "info"]) {
      expect(data.findings.filter(f => f.severity === severity).length).toBeLessThanOrEqual(3);
    }
    expect(data.findings.every(f => f.rule && f.message)).toBe(true);
    // The tag nothing shows is a finding about a tag, and the card says so.
    const about = data.findings.map(f => f.where);
    expect(about.some(w => w.startsWith("tag ") || /^o\d+ /.test(w))).toBe(true);
  });

  it("offers two actions, and no third", () => {
    const html = CARD_RESOURCES[VALIDATION_CARD_URI].html;
    expect(html.match(/<button/g)).toHaveLength(2);
    // The one that needs interpretation goes to the composer; the one on data
    // the card already owns is a tool call it makes itself.
    expect(html).toContain("askClaude(");
    expect(html).toContain('callTool("validate"');
  });

  it("has no action on the screen card, which has nothing to act on", () => {
    expect(CARD_RESOURCES[SCREEN_CARD_URI].html).not.toContain("<button");
  });
});

describe("a client with no UI support", () => {
  it("gets the same text, image and structured content as before the cards", async () => {
    const validation = await call("validate", { projectId: ID });
    expect(validation.content.filter(c => c.type === "text")).toHaveLength(1);
    expect(validation.content[0].text).toMatch(/^\d+ findings: \d+ errors, \d+ warnings, \d+ info\./);
    expect(validation.content[0].text).toContain("<project-data kind=\"findings\">");
    expect(Object.keys(validation.structuredContent!).sort()).toEqual(["all", "errors", "info", "warnings"]);

    const render = await call("render_screen", { projectId: ID, screenId: "s1" });
    expect(render.content.map(c => c.type)).toEqual(["text", "image"]);
    expect(render.content[0].text).toContain("1024x600");
    expect(Object.keys(render.structuredContent!).sort()).toEqual(["handle", "height", "scale", "width"]);
  });

  it("keeps the card's copy of a customer's string out of structuredContent", async () => {
    // A host may hand the model `structuredContent` instead of the text, and
    // the text is where lib/mcp/data.ts puts its fence. So the card's data -
    // screen names, object names, tag names - rides in `_meta.ui` only.
    const render = await call("render_screen", { projectId: ID, screenId: "s1" });
    expect(JSON.stringify(render.structuredContent)).not.toContain("PMP_101_RUN");
    expect(JSON.stringify(render._meta)).toContain("PMP_101_RUN");
  });

  it("puts the card in _meta and nowhere else, for any tool that sets one", () => {
    const plain = toolResult({ text: "hello" });
    expect(plain._meta).toBeUndefined();
    const carded = toolResult({ text: "hello", ui: { resourceUri: SCREEN_CARD_URI } });
    expect(carded._meta).toEqual({ ui: { resourceUri: SCREEN_CARD_URI } });
    // Same content either way: the card is metadata beside the answer.
    expect(carded.content).toEqual(plain.content);
  });

  it("answers a tool with no card with no _meta", async () => {
    const result = await call("find_tags", { projectId: ID, query: "pump" });
    expect(result._meta?.ui).toBeUndefined();
  });
});

describe("both card documents", () => {
  const documents = Object.entries(CARD_RESOURCES);

  it("reference nothing outside themselves", () => {
    for (const [uri, card] of documents) {
      // A CDN script, a web font or a remote image would each need an origin
      // in `_meta.ui.csp`, and the policy above declares none.
      expect(card.html, uri).not.toMatch(/https?:\/\//);
      expect(card.html, uri).not.toMatch(/\bsrc\s*=\s*["']\/\//);
      expect(card.html, uri).not.toContain("@import");
      expect(card.html, uri).not.toContain("<link");
      expect(card.html, uri).not.toContain("fetch(");
      expect(card.html, uri).not.toContain("XMLHttpRequest");
      // On mobile the card is a WebView with none of these to offer.
      for (const forbidden of ["getUserMedia", "geolocation", "mediaDevices"]) {
        expect(card.html, uri).not.toContain(forbidden);
      }
    }
  });

  it("take every colour from a host style variable", () => {
    for (const [uri, card] of documents) {
      const css = card.html.slice(card.html.indexOf("<style>"), card.html.indexOf("</style>"));
      // Every literal colour in the sheet is the fallback inside a host
      // variable, never a value in its own right.
      for (const literal of css.match(/#[0-9A-Fa-f]{3,8}|rgba?\([^)]*\)/g) ?? []) {
        const at = css.indexOf(literal);
        const before = css.slice(Math.max(0, at - 120), at);
        expect(before, `${uri}: ${literal} is not a fallback`).toMatch(/var\(--color-[a-z-]+,\s*$/);
      }
      expect(css, uri).toContain("var(--color-background-primary,");
      expect(css, uri).toContain("var(--color-text-primary,");
    }
  });

  it("define every colour in both light and dark, and never in one only", () => {
    for (const [uri, card] of documents) {
      const css = card.html.slice(card.html.indexOf("<style>"), card.html.indexOf("</style>"));
      const dark = css.indexOf("@media (prefers-color-scheme: dark)");
      expect(dark, uri).toBeGreaterThan(0);
      const tokens = (text: string) => new Set((text.match(/--card-[a-z-]+(?=\s*:)/g) ?? []));
      const light = tokens(css.slice(0, dark));
      const night = tokens(css.slice(dark));
      expect(light.size, uri).toBeGreaterThan(0);
      // Set equality both ways: a token defined only in the light block goes
      // missing in dark mode, and one defined only in the dark block was never
      // a default at all.
      expect([...light].sort(), uri).toEqual([...night].sort());
      expect(card.html, uri).toContain('content="light dark"');
      expect(css, uri).toContain("color-scheme: light dark");
    }
  });

  it("fit a phone, with no scroll of their own and tappable actions", () => {
    for (const [uri, card] of documents) {
      expect(card.html, uri).toContain('name="viewport"');
      // The host clips an inline card that outgrows its height and owns the
      // vertical gesture, so nothing here may scroll or claim a fixed width.
      expect(card.html, uri).toContain("overflow: hidden");
      expect(card.html, uri).not.toMatch(/overflow-y:\s*(auto|scroll)/);
      expect(card.html, uri).not.toMatch(/\bwidth:\s*\d{3,}px/);
      expect(card.html, uri).not.toMatch(/\bmin-width:\s*(?!44px)\d{3,}px/);
    }
    // 44 px is the tap target both mobile guidelines ask for.
    expect(CARD_RESOURCES[VALIDATION_CARD_URI].html).toContain("min-height: 44px");
    // And the bottom inset, so the composer cannot sit on top of a button.
    expect(CARD_RESOURCES[VALIDATION_CARD_URI].html).toContain("env(safe-area-inset-bottom, 0px)");
  });

  it("put a customer's string in the DOM as text and never as markup", () => {
    for (const [uri, card] of documents) {
      // Screen names, object names and tag names come out of somebody's
      // engineering file, same as in lib/mcp/data.ts. `textContent` is the
      // whole defence, so no card may write markup at all.
      expect(card.html, uri).not.toContain("innerHTML");
      expect(card.html, uri).not.toContain("outerHTML");
      expect(card.html, uri).not.toContain("insertAdjacentHTML");
      expect(card.html, uri).not.toContain("document.write");
      expect(card.html, uri).toContain("textContent");
    }
  });
});
