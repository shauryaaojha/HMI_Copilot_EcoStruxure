/**
 * The MCP tab's history of decided proposals (components/chat/McpHistory.tsx):
 * each one's state, and the log it opens into.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { McpHistory, ProposalLog } from "@/components/chat/McpHistory";
import type { SharedProposal } from "@/store/proposals";

const base = (over: Partial<SharedProposal>): SharedProposal => ({
  _id: "p1",
  projectId: "x",
  requestedBy: "u1",
  requestedByName: "Asha",
  request: "Add a header to the overview",
  author: "agent:gemini:test",
  labels: ["Add Text Title on Overview", "Move Lamp_1 right"],
  changes: [],
  rejected: [],
  createdAt: Date.UTC(2026, 10, 10, 9, 0),
  updatedAt: Date.UTC(2026, 10, 10, 9, 5),
  status: "accepted",
  via: "mcp",
  ...over,
});

describe("MCP history", () => {
  it("lists decided proposals with their state, and leaves open ones out", () => {
    const html = renderToStaticMarkup(
      createElement(McpHistory, {
        proposals: [
          base({ _id: "a", status: "accepted", decidedAt: Date.UTC(2026, 10, 10, 9, 5) }),
          base({ _id: "b", status: "discarded", request: "Delete every alarm", decidedAt: Date.UTC(2026, 10, 10, 10, 0) }),
          base({ _id: "c", status: "open", request: "Still waiting" }),
        ],
      }),
    );
    expect(html).toContain("Past proposals");
    expect(html).toContain("Accepted");
    expect(html).toContain("Discarded");
    expect(html).toContain("Delete every alarm");
    expect(html).not.toContain("Still waiting");
    expect(html).toContain("1 accepted · 1 discarded");
  });

  it("renders nothing when nothing has been decided", () => {
    expect(renderToStaticMarkup(createElement(McpHistory, { proposals: [base({ status: "open" })] }))).toBe("");
  });

  it("logs who asked, which changes landed, what could not be done, and who decided", () => {
    const html = renderToStaticMarkup(
      createElement(ProposalLog, {
        p: base({
          status: "partially-accepted",
          acceptedOpIndexes: [0],
          rejected: ["setText Hdr_Overview - Hdr_Overview is a Rectangle and carries no text."],
          decidedByName: "Ravi",
          decidedAt: Date.UTC(2026, 10, 10, 9, 5),
          rev: 42,
        }),
      }),
    );
    expect(html).toContain("Claude proposed 2 changes for <span");
    expect(html).toContain("Asha");
    expect(html).toContain("Add a header to the overview");
    // The first change landed, the second did not.
    expect(html).toMatch(/aria-label="applied"[\s\S]*Add Text Title on Overview/);
    expect(html).toMatch(/aria-label="not applied"[\s\S]*Move Lamp_1 right/);
    expect(html).toContain("1 part could not be done");
    expect(html).toContain("carries no text");
    expect(html).toContain("Partly accepted");
    expect(html).toContain("Ravi");
    expect(html).toContain("1 of 2 changes");
    expect(html).toContain("landed as revision 42");
  });
});
