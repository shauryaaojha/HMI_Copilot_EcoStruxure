/**
 * The two MCP Apps cards: M4 of phase 4.
 *
 * An MCP App is an HTML resource under the `ui://` scheme, served by this same
 * server, that a tool result points at. The host reads the resource, renders it
 * in a sandboxed iframe on web and a native WebView on mobile, and pushes the
 * tool result into the frame; the frame draws it. So there are three pieces and
 * they live apart: the HTML is here, the pointer is the `ui` field on the
 * tool's `ToolOutput` (`result.ts`), and `registerCards` puts the resources on
 * the server next to the tools.
 *
 * Verified against claude.com/docs/connectors/building/mcp-apps/quickstart and
 * .../design-guidelines (fetched 2026-10-31). Those confirm what
 * docs/RESEARCH_CLAUDE_AI_INTEGRATION.md line 49 filed as third-party and
 * unverified - `_meta.ui.resourceUri` naming a `ui://` resource is real - and
 * correct line 41 and the header of `result.ts` on one point: the canonical
 * place for `resourceUri` is the *tool definition's* `_meta`, which the host
 * reads from `tools/list`, and the result carries the data the card draws. We
 * declare it in both places from the one constant below, so a host that looks
 * in either finds the same resource.
 *
 * Three constraints shape everything here:
 *
 * No external origin, so no CSP origin to declare. Everything a card needs is
 * either in the HTML or in the result the host hands it: the style variables
 * come from the host, the screenshot is the PNG already in the result's image
 * content, and the frame-to-host bridge is the twenty lines at the bottom of
 * the script rather than the SDK's client loaded from unpkg. `connectDomains`
 * and the rest are therefore declared empty - stated, not omitted, because an
 * empty list is a claim a reviewer can check and a missing field is not.
 *
 * Customer text reaches the DOM only through `textContent`. Screen names,
 * object names and tag names come out of somebody's engineering file, same as
 * in `data.ts`, and a card that built markup out of them would be handing a
 * string from a PLC export the run of its own document.
 *
 * Nothing the card needs goes into `structuredContent`. A host may give the
 * model the structured object in place of the text content (the quickstart
 * notes this of Claude Code), and the text content is where `data.ts` puts its
 * fence - so moving customer strings into `structuredContent` to feed the card
 * would quietly cost the injection defence. The card's data rides in
 * `_meta.ui.data` instead, where only the card reads it, and both tools'
 * existing `content` and `structuredContent` are untouched.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Severity } from "@/lib/validation/rules";

/** The MIME type an MCP App resource must carry, per the quickstart. */
export const CARD_MIME_TYPE = "text/html;profile=mcp-app";

export const SCREEN_CARD_URI = "ui://hmi-copilot/screen-preview";
export const VALIDATION_CARD_URI = "ui://hmi-copilot/validation";

/**
 * What each card may reach, which is nothing. All three lists are spelled out
 * because `_meta.ui.csp` is the whole of what a reviewer has to go on, and
 * "we asked for no origins" is worth saying out loud. `frameDomains` is absent
 * rather than empty: Claude restricts it pending security review, and a field
 * we have no use for should not appear at all.
 */
export const CARD_CSP = { connectDomains: [], resourceDomains: [], baseUriDomains: [] } as const;

/** One object on a previewed screen, as the card lists it. */
export interface CardBinding {
  handle: string;
  name: string;
  type: string;
  tag?: string;
}

/** What the screen preview card draws, beside the PNG in the result. */
export interface ScreenCardData {
  handle: string;
  name: string;
  width: number;
  height: number;
  scale: number;
  objects: number;
  bound: number;
  bindings: CardBinding[];
  more: number;
}

/** One finding, as the validation card names it. */
export interface CardFinding {
  severity: Severity;
  rule: string;
  message: string;
  /** The object handle and name, or the tag, the finding is about. */
  where: string;
  suggestion?: string;
}

/** What the validation card draws. */
export interface ValidationCardData {
  projectId: string;
  errors: number;
  warnings: number;
  info: number;
  all: number;
  findings: CardFinding[];
}

/**
 * The `ui` field for a result. The data travels with the pointer so the card
 * has everything in one notification, and the shape is the card's own - there
 * is no second attachment mechanism to keep in step with this one.
 */
export const screenCard = (data: ScreenCardData) => ({ resourceUri: SCREEN_CARD_URI, data });
export const validationCard = (data: ValidationCardData) => ({ resourceUri: VALIDATION_CARD_URI, data });

/**
 * Colours and type, from the host, with both themes written out.
 *
 * Every colour is a host style variable. The hex after each one is the fallback
 * for a frame that was handed no variables at all - local development, or a
 * host that renders the resource without the token layer - and it is paired:
 * the light value in `:root`, the dark value again under
 * `prefers-color-scheme: dark`. Both values are Anthropic's published token
 * values, so an unstyled frame still looks like the thing it stands in for,
 * and no colour exists in one theme only.
 *
 * Widths run from 320px with no breakpoint, because an inline card is always
 * its container's width and the container on a phone is the conversation.
 * Nothing scrolls inside the card: the host clips an inline app that outgrows
 * its height, so the lists below are cut by the server to what fits and say
 * how many they left.
 */
const CARD_CSS = `
:root {
  color-scheme: light dark;
  --card-bg: var(--color-background-primary, #FFFFFF);
  --card-panel: var(--color-background-secondary, #F5F4ED);
  --card-fg: var(--color-text-primary, #141413);
  --card-fg-dim: var(--color-text-secondary, #3D3D3A);
  --card-fg-faint: var(--color-text-tertiary, #73726C);
  --card-line: var(--color-border-tertiary, rgba(31, 30, 29, 0.15));
  --card-error-bg: var(--color-background-danger, #F7ECEC);
  --card-error-fg: var(--color-text-danger, #7F2C28);
  --card-warning-bg: var(--color-background-warning, #F6EEDF);
  --card-warning-fg: var(--color-text-warning, #5A4815);
  --card-info-bg: var(--color-background-info, #D6E4F6);
  --card-info-fg: var(--color-text-info, #3266AD);
  --card-action-bg: var(--color-background-inverse, #141413);
  --card-action-fg: var(--color-text-inverse, #FFFFFF);
}
@media (prefers-color-scheme: dark) {
  :root {
    --card-bg: var(--color-background-primary, #30302E);
    --card-panel: var(--color-background-secondary, #262624);
    --card-fg: var(--color-text-primary, #FAF9F5);
    --card-fg-dim: var(--color-text-secondary, #C2C0B6);
    --card-fg-faint: var(--color-text-tertiary, #9C9A92);
    --card-line: var(--color-border-tertiary, rgba(222, 220, 209, 0.15));
    --card-error-bg: var(--color-background-danger, #602A28);
    --card-error-fg: var(--color-text-danger, #EE8884);
    --card-warning-bg: var(--color-background-warning, #483A0F);
    --card-warning-fg: var(--color-text-warning, #D1A041);
    --card-info-bg: var(--color-background-info, #253E5F);
    --card-info-fg: var(--color-text-info, #80AADD);
    --card-action-bg: var(--color-background-inverse, #FAF9F5);
    --card-action-fg: var(--color-text-inverse, #141413);
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  /* The composer can overlay the bottom of an inline card on web as well as on
     mobile, and a button under it cannot be tapped. The CSS env() insets are the
     part of the safe area a frame can read without asking the host for it. */
  padding: 12px calc(12px + env(safe-area-inset-right, 0px)) calc(12px + env(safe-area-inset-bottom, 0px)) calc(12px + env(safe-area-inset-left, 0px));
  background: var(--card-bg);
  color: var(--card-fg);
  font-family: var(--font-sans, system-ui, sans-serif);
  font-size: var(--font-text-sm-size, 14px);
  line-height: var(--font-text-sm-line-height, 1.4);
  overflow: hidden;
}
h1 {
  margin: 0;
  font-size: var(--font-heading-sm-size, 14px);
  line-height: var(--font-heading-sm-line-height, 1.4);
  font-weight: var(--font-weight-semibold, 600);
  overflow-wrap: anywhere;
}
.sub { color: var(--card-fg-faint); font-size: var(--font-text-xs-size, 12px); margin-top: 2px; }
.stats { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-top: 10px; }
.stat { min-width: 64px; }
.stat b { display: block; font-size: var(--font-heading-md-size, 16px); font-weight: var(--font-weight-semibold, 600); }
.stat span { color: var(--card-fg-faint); font-size: var(--font-text-xs-size, 12px); }
.shot {
  display: block;
  width: 100%;
  height: auto;
  margin-top: 10px;
  border: var(--border-width-regular, 0.5px) solid var(--card-line);
  border-radius: var(--border-radius-md, 8px);
  background: var(--card-panel);
}
ul { list-style: none; margin: 10px 0 0; padding: 0; }
li {
  padding: 6px 8px;
  border-radius: var(--border-radius-sm, 6px);
  background: var(--card-panel);
  margin-top: 4px;
  overflow-wrap: anywhere;
}
li .where { color: var(--card-fg-dim); font-size: var(--font-text-xs-size, 12px); }
li .fix { color: var(--card-fg-faint); font-size: var(--font-text-xs-size, 12px); }
.group { margin-top: 10px; }
.tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: var(--border-radius-full, 9999px);
  font-size: var(--font-text-xs-size, 12px);
  font-weight: var(--font-weight-medium, 500);
}
.tag.error { background: var(--card-error-bg); color: var(--card-error-fg); }
.tag.warning { background: var(--card-warning-bg); color: var(--card-warning-fg); }
.tag.info { background: var(--card-info-bg); color: var(--card-info-fg); }
.rest { color: var(--card-fg-faint); font-size: var(--font-text-xs-size, 12px); margin-top: 6px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
button {
  flex: 1 1 auto;
  min-height: 44px;
  min-width: 44px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--border-radius-md, 8px);
  background: var(--card-action-bg);
  color: var(--card-action-fg);
  font-family: inherit;
  font-size: var(--font-text-sm-size, 14px);
  font-weight: var(--font-weight-semibold, 600);
  cursor: pointer;
}
button.quiet { background: var(--card-panel); color: var(--card-fg); }
button[disabled] { opacity: 0.5; cursor: default; }
.skeleton { background: var(--card-panel); border-radius: var(--border-radius-sm, 6px); height: 14px; margin-top: 8px; }
`;

/**
 * The bridge to the host, hand-written.
 *
 * The MCP Apps SDK ships a client for this, and the quickstart loads it from
 * unpkg - which is the one thing we will not do, because an inline card that
 * needs a CDN needs a `resourceDomains` entry and then a reviewer has to take
 * our word for what we fetch from it. The protocol is JSON-RPC over
 * `postMessage` to the host frame, so the part we use is small enough to own:
 * say hello, take the tool result, ask for a tool call or a prompt.
 *
 * `ui/initialize` and the `ui/*` namespace are the design guidelines' own
 * spelling. The method names for calling a tool and for putting a prompt in
 * the composer were not on either page read, so both spellings are tried and
 * the handlers accept the result notification under any of its plausible
 * names: a card that misses the notification shows nothing, and that is the
 * one failure worth being generous about. Pin these against the MCP Apps SDK
 * before the connector is submitted (M5).
 */
const CARD_BRIDGE = `
var host = window.parent;
var seq = 0;
var ready = false;
function send(method, params) {
  var id = ++seq;
  host.postMessage({ jsonrpc: "2.0", id: id, method: method, params: params || {} }, "*");
  return id;
}
function notify(method, params) {
  host.postMessage({ jsonrpc: "2.0", method: method, params: params || {} }, "*");
}
/** The host's push of the tool result, under any of the names it may use. */
function resultOf(message) {
  if (!message || typeof message !== "object") return null;
  var method = message.method || "";
  if (method.indexOf("tool-result") >= 0 || method.indexOf("toolResult") >= 0) {
    return message.params && (message.params.result || message.params);
  }
  if (message.result && (message.result.content || message.result._meta)) return message.result;
  return null;
}
window.addEventListener("message", function (event) {
  var result = resultOf(event.data);
  if (!result) return;
  ready = true;
  try {
    render(result, (result._meta && result._meta.ui && result._meta.ui.data) || null);
  } catch (error) {
    /* A card that throws must not take the answer with it: the text content
       beside it is the real answer and is already in the conversation. */
  }
});
/** Runs one of this card's tools again, through the host. */
function callTool(name, args) {
  send("ui/call-tool", { name: name, arguments: args });
  send("ui/tool-call", { name: name, arguments: args });
}
/** Hands the engineer's request to the composer, where language work belongs. */
function askClaude(text) {
  notify("ui/send-prompt", { prompt: text });
  notify("ui/prompt", { prompt: text });
}
send("ui/initialize", { appCapabilities: { availableDisplayModes: ["inline"] } });
`;

/** Every card: one document, no external reference of any kind. */
const cardHtml = (title: string, body: string, script: string) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${title}</title>
<style>${CARD_CSS}</style>
</head>
<body>
${body}
<script>${CARD_BRIDGE}${script}</script>
</body>
</html>`;

/**
 * The screen preview card: the drawing, its name, how much is on it, and how
 * much of it is wired to the PLC.
 *
 * The PNG is the one already in the result's image content, turned into a
 * `data:` URI in the frame. Re-sending it as a field would double the biggest
 * thing in the result against a 150,000-character cap
 * (docs/CONNECTOR_SPEC_NOTES.md §2), and hosting it would need an origin.
 *
 * No action. The guidelines draw the line at direct manipulation of content
 * the card already owns, and everything an engineer wants to do to a screen -
 * move this, bind that, redo the layout - is a request in words that Claude
 * has to interpret. A button that could only mean "ask again" earns nothing.
 */
const SCREEN_CARD_HTML = cardHtml(
  "Screen preview",
  `<h1 id="name">Loading the screen…</h1>
<div class="sub" id="size"></div>
<div class="stats" id="stats"></div>
<img id="shot" class="shot" alt="" hidden>
<ul id="bindings"></ul>
<div class="rest" id="rest" hidden></div>
<div class="skeleton" id="skeleton" style="height:120px"></div>`,
  `
function stat(value, label) {
  var box = document.createElement("div");
  box.className = "stat";
  var big = document.createElement("b");
  big.textContent = String(value);
  var small = document.createElement("span");
  small.textContent = label;
  box.appendChild(big);
  box.appendChild(small);
  return box;
}
function render(result, data) {
  if (!data) return;
  document.getElementById("skeleton").hidden = true;
  document.getElementById("name").textContent = data.name || data.handle;
  document.getElementById("size").textContent =
    data.handle + " · " + data.width + "×" + data.height + " px · drawn at " + Math.round(data.scale * 100) + "%";
  var stats = document.getElementById("stats");
  stats.replaceChildren(
    stat(data.objects, data.objects === 1 ? "object" : "objects"),
    stat(data.bound, "bound to a tag"),
    stat(data.objects - data.bound, "unbound")
  );
  var image = (result.content || []).filter(function (part) { return part.type === "image"; })[0];
  var shot = document.getElementById("shot");
  if (image && image.data) {
    shot.src = "data:" + (image.mimeType || "image/png") + ";base64," + image.data;
    shot.alt = "Rendered screen " + (data.name || data.handle);
    shot.hidden = false;
  }
  var list = document.getElementById("bindings");
  list.replaceChildren();
  (data.bindings || []).forEach(function (binding) {
    var row = document.createElement("li");
    var who = document.createElement("div");
    who.textContent = binding.name + " (" + binding.type + ")";
    var what = document.createElement("div");
    what.className = "where";
    what.textContent = binding.tag ? "shows " + binding.tag : "not bound";
    row.appendChild(who);
    row.appendChild(what);
    list.appendChild(row);
  });
  var rest = document.getElementById("rest");
  rest.hidden = !data.more;
  rest.textContent = data.more ? data.more + " more objects, not listed here." : "";
}
`,
);

/**
 * The validation card: the findings, grouped by severity, each naming the
 * object or the tag it is about.
 *
 * Two actions, which is the ceiling an inline card has, and they are the two
 * ends of the loop an engineer is actually in. **Fix the errors** puts the
 * request in the composer rather than doing anything itself: choosing the ops
 * that fix a finding is interpretation, and the guidelines send interpretation
 * to the chat - the card has no business inventing an op. **Re-run the checks**
 * calls `validate` again, which is the one action on content this card already
 * owns, so a fix can be confirmed without retyping the project id. The pair
 * the research note guessed at - accept or reject a proposal
 * (docs/RESEARCH_CLAUDE_AI_INTEGRATION.md line 47) - belongs to `propose`,
 * which has a proposal to decide about; `validate` writes nothing.
 */
const VALIDATION_CARD_HTML = cardHtml(
  "Validation findings",
  `<h1 id="headline">Running the checks…</h1>
<div class="sub" id="counts"></div>
<div id="groups"></div>
<div class="rest" id="rest" hidden></div>
<div class="actions">
  <button id="fix" disabled>Fix the errors</button>
  <button id="again" class="quiet" disabled>Re-run the checks</button>
</div>
<div class="skeleton" id="skeleton"></div>`,
  `
var current = null;
var ORDER = ["error", "warning", "info"];
var LABEL = { error: "Errors", warning: "Warnings", info: "Notes" };
function group(severity, findings) {
  var block = document.createElement("div");
  block.className = "group";
  var head = document.createElement("span");
  head.className = "tag " + severity;
  head.textContent = LABEL[severity] + " · " + findings.length;
  block.appendChild(head);
  var list = document.createElement("ul");
  findings.forEach(function (finding) {
    var row = document.createElement("li");
    var what = document.createElement("div");
    what.textContent = finding.message;
    row.appendChild(what);
    if (finding.where) {
      var where = document.createElement("div");
      where.className = "where";
      where.textContent = finding.where;
      row.appendChild(where);
    }
    if (finding.suggestion) {
      var fix = document.createElement("div");
      fix.className = "fix";
      fix.textContent = finding.suggestion;
      row.appendChild(fix);
    }
    list.appendChild(row);
  });
  block.appendChild(list);
  return block;
}
function render(result, data) {
  if (!data) return;
  current = data;
  document.getElementById("skeleton").hidden = true;
  document.getElementById("headline").textContent =
    data.all === 0 ? "No findings" : data.all + (data.all === 1 ? " finding" : " findings");
  document.getElementById("counts").textContent =
    data.errors + " errors · " + data.warnings + " warnings · " + data.info + " notes";
  var groups = document.getElementById("groups");
  groups.replaceChildren();
  ORDER.forEach(function (severity) {
    var found = (data.findings || []).filter(function (finding) { return finding.severity === severity; });
    if (found.length) groups.appendChild(group(severity, found));
  });
  var listed = (data.findings || []).length;
  var rest = document.getElementById("rest");
  rest.hidden = listed >= data.all;
  rest.textContent = listed < data.all ? data.all - listed + " more findings; ask for the full list." : "";
  document.getElementById("fix").disabled = data.errors === 0;
  document.getElementById("again").disabled = false;
}
document.getElementById("fix").onclick = function () {
  if (!current) return;
  askClaude("Fix the " + current.errors + " validation errors on project " + current.projectId + ". Show me the ops before you apply them.");
};
document.getElementById("again").onclick = function () {
  if (!current) return;
  document.getElementById("again").disabled = true;
  callTool("validate", { projectId: current.projectId });
};
`,
);

/** Both cards, by URI, so a test can read what the host would read. */
export const CARD_RESOURCES: Readonly<Record<string, { title: string; description: string; html: string }>> = {
  [SCREEN_CARD_URI]: {
    title: "Screen preview",
    description: "The rendered screen, with its name, what is on it and what is bound.",
    html: SCREEN_CARD_HTML,
  },
  [VALIDATION_CARD_URI]: {
    title: "Validation findings",
    description: "The design-time findings, grouped by severity.",
    html: VALIDATION_CARD_HTML,
  },
};

/**
 * Puts the cards on the server.
 *
 * Here and not in `tools.ts`: a resource is not a tool, and the tool table is
 * the one file three streams are editing at once. `server.ts` calls this
 * beside `registerTools`.
 */
export function registerCards(server: McpServer): void {
  for (const [uri, card] of Object.entries(CARD_RESOURCES)) {
    server.registerResource(
      card.title,
      uri,
      { title: card.title, description: card.description, mimeType: CARD_MIME_TYPE },
      async () => ({
        contents: [{ uri, mimeType: CARD_MIME_TYPE, text: card.html, _meta: { ui: { csp: CARD_CSP } } }],
      }),
    );
  }
}
