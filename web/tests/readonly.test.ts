/**
 * A read-only project hides its edit affordances, and a local one keeps them.
 *
 * Phase B gives a server project a role, and a viewer or commenter must not be
 * offered an edit the server would refuse. The rule lives in one hook,
 * useCanEdit() in src/store/access.ts; these tests render the components that
 * ask it, once as a viewer and once as a browser-only project (no access
 * record), and read the markup.
 *
 * Rendering store-connected components needs one step the canvas tests do not.
 * Under renderToStaticMarkup zustand serves its *server* snapshot, which is the
 * store's initial state, not whatever getState() returns after a set() - so a
 * viewer set the ordinary way would render as a local project and every
 * assertion below would pass for the wrong reason. `serve()` copies the live
 * state into the initial-state object after each set, and `reset()` puts both
 * back, so what the test sets is what the render sees.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// ChatPanel's "New" button routes through next/navigation, which has no app
// router to talk to outside Next.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => "/project/p",
}));

import { demoScreen } from "@/fixtures";
import { useAccess } from "@/store/access";
import { CanvasToolbar } from "@/components/canvas/CanvasToolbar";
import { ScreenRenderer } from "@/components/canvas/ScreenRenderer";
import { ScreenStrip } from "@/components/canvas/ScreenStrip";
import { ChatPanel } from "@/components/chat/ChatPanel";

/** The initial state as the module created it, so every test can go back to it. */
const pristine = { ...useAccess.getInitialState() };

/** Make the server snapshot agree with the live state. See the header. */
function serve() {
  Object.assign(useAccess.getInitialState(), useAccess.getState());
}

function asViewer() {
  useAccess.getState().set("p", { role: "viewer", actions: ["read", "export"], via: "member" });
  serve();
}

function asLocal() {
  useAccess.getState().set("p", null);
  serve();
}

afterEach(() => {
  useAccess.setState(pristine);
  Object.assign(useAccess.getInitialState(), pristine);
});

const toolbarProps = {
  tool: null,
  onTool: () => {},
  panMode: false,
  onPanMode: () => {},
  zoom: 100,
  onZoom: () => {},
  onZoomStep: () => {},
  onFit: () => {},
  simulating: false,
  onSimulate: () => {},
  activeAlarms: 0,
  elapsed: 0,
  view: "board" as const,
  onView: () => {},
  canBoard: false,
};

const toolbar = () => renderToStaticMarkup(createElement(CanvasToolbar, toolbarProps));
const chat = () => renderToStaticMarkup(createElement(ChatPanel));
const strip = () => renderToStaticMarkup(createElement(ScreenStrip));

/** Every <button> in the markup that carries `label`, with whether it is disabled. */
function buttons(markup: string, label: string) {
  return [...markup.matchAll(/<button\b([^>]*)>/g)]
    .map((m) => m[1])
    .filter((attrs) => attrs.includes(`aria-label="${label}"`))
    .map((attrs) => ({ disabled: /\bdisabled=""/.test(attrs) }));
}

describe("a viewer gets a canvas to look at, not to change", () => {
  it("the toolbar has no drawing, history or delete buttons for a viewer", () => {
    asViewer();
    const markup = toolbar();
    expect(buttons(markup, "Delete (Del)")).toEqual([]);
    expect(buttons(markup, "Rectangle (R)")).toEqual([]);
    expect(buttons(markup, "Undo (Ctrl+Z)")).toEqual([]);
    expect(buttons(markup, "Group (Ctrl+G)")).toEqual([]);
    expect(markup).not.toContain("Insert");
    // Looking is still allowed.
    expect(buttons(markup, "Select (V)")).toHaveLength(1);
    expect(buttons(markup, "Zoom in")).toHaveLength(1);
  });

  it("the toolbar keeps every tool for a local project", () => {
    asLocal();
    const markup = toolbar();
    expect(buttons(markup, "Rectangle (R)")).toEqual([{ disabled: false }]);
    // Present; disabled only because nothing is selected.
    expect(buttons(markup, "Delete (Del)")).toEqual([{ disabled: true }]);
    expect(buttons(markup, "Undo (Ctrl+Z)")).toHaveLength(1);
  });

  it("the chat has no composer for a viewer, and says why", () => {
    asViewer();
    const markup = chat();
    expect(markup).not.toContain("<textarea");
    expect(markup).toContain("View only — ask an editor for changes");
  });

  it("the chat composer is there and enabled for a local project", () => {
    asLocal();
    const markup = chat();
    const area = markup.match(/<textarea\b([^>]*)>/);
    expect(area).not.toBeNull();
    expect(area![1]).not.toMatch(/\bdisabled=""/);
    expect(markup).not.toContain("View only");
  });

  it("the screen strip offers no add or import for a viewer, and does for a local project", () => {
    asViewer();
    expect(buttons(strip(), "Add a screen")).toEqual([]);
    expect(buttons(strip(), "Import screens from another project")).toEqual([]);
    asLocal();
    expect(buttons(strip(), "Add a screen")).toHaveLength(1);
  });
});

describe("ScreenRenderer's readOnly prop", () => {
  const selected = demoScreen.Children[0].Children[0].UniqueId;
  const render = (readOnly: boolean) =>
    renderToStaticMarkup(
      createElement(ScreenRenderer, { screen: demoScreen, selectedIds: [selected], readOnly }),
    );

  it("draws no resize handles on a read-only selection, but still outlines it", () => {
    const markup = render(true);
    expect(markup).not.toContain("selection-handle");
    expect(markup).toContain(`data-object-id="${selected}"`);
    expect(markup).toContain('stroke="var(--color-brand-400)"');
  });

  it("draws the eight handles when editing is allowed", () => {
    expect(render(false).match(/selection-handle/g)).toHaveLength(8);
  });
});

describe("comment pins", () => {
  const pins = [
    { id: "c1", n: 1, x: 120, y: 80, resolved: false },
    { id: "c2", n: 2, x: 400, y: 300, resolved: true },
  ];
  const markup = renderToStaticMarkup(
    createElement(ScreenRenderer, { screen: demoScreen, selectedIds: [], comments: pins }),
  );

  /** How many <g> elements are open at `index` - zero means outside every group. */
  function depthAt(index: number): number {
    let depth = 0;
    for (const m of markup.slice(0, index).matchAll(/<(\/?)g\b[^>]*?(\/?)>/g)) {
      if (m[2]) continue;
      depth += m[1] ? -1 : 1;
    }
    return depth;
  }

  /** The pin layer's own markup, from its opening tag to its matching close. */
  function layer(): string {
    const start = markup.indexOf("data-comment-pins");
    const open = markup.lastIndexOf("<g", start);
    let depth = 0;
    for (const m of markup.slice(open).matchAll(/<(\/?)g\b[^>]*?(\/?)>/g)) {
      if (m[2]) continue;
      depth += m[1] ? -1 : 1;
      if (depth === 0) return markup.slice(open, open + m.index! + m[0].length);
    }
    throw new Error("unclosed pin layer");
  }

  it("draws one numbered pin per comment", () => {
    expect(markup).toContain('data-comment-pin="c1"');
    expect(markup).toContain('data-comment-pin="c2"');
    expect(layer()).toContain(">1</text>");
    expect(layer()).toContain(">2</text>");
  });

  it("sits outside every object group, as a direct child of the screen", () => {
    const open = markup.lastIndexOf("<g", markup.indexOf("data-comment-pins"));
    expect(depthAt(open)).toBe(0);
  });

  it("carries no data-object-id, and its layer takes no pointer events itself", () => {
    const pinLayer = layer();
    expect(pinLayer).not.toContain("data-object-id");
    expect(pinLayer.slice(0, pinLayer.indexOf(">"))).toContain('pointer-events="none"');
  });

  it("is drawn above the objects: after the last object group", () => {
    const lastObject = markup.lastIndexOf("data-object-id=");
    expect(markup.indexOf("data-comment-pins")).toBeGreaterThan(lastObject);
  });
});
