/**
 * Two things the chat got wrong: a clarifying question was a button that sent
 * the question back as the engineer's answer, and proposals were shown newest
 * first. Questions are text with answers to pick; proposals are a queue.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { coerceTurn } from "@/core/ops";
import { geminiSchema } from "@/lib/ai/converse";
import { queueOf, type SharedProposal } from "@/store/proposals";
import { ClarifyChoices } from "@/components/chat/ChatPanel";

describe("clarifying questions", () => {
  it("keeps each question with the answers to pick from", () => {
    const turn = coerceTurn({
      mode: "clarify",
      reply: "Two things first.",
      choices: [{ question: "Which screens?", options: ["All screens", "Only the overview"] }],
    });
    expect(turn?.choices).toEqual([{ question: "Which screens?", options: ["All screens", "Only the overview"] }]);
    // The model is offered the field in the schema it answers in.
    expect(JSON.stringify(geminiSchema())).toContain('"choices"');
  });

  it("shows the question as text and only the answers as buttons", () => {
    const html = renderToStaticMarkup(
      createElement(ClarifyChoices, {
        choices: [{ question: "Which elements should change colour?", options: ["Header", "Buttons"] }],
        live: true,
        onAnswer: () => {},
      }),
    );
    expect(html).toMatch(/<p[^>]*>.*Which elements should change colour\?<\/p>/);
    expect(html).not.toMatch(/<button[^>]*>[^<]*Which elements/);
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain(">Header</button>");
    expect(html).toContain("Or type your own answer");
  });

  it("asks for both answers before sending when there are two questions", () => {
    const html = renderToStaticMarkup(
      createElement(ClarifyChoices, {
        choices: [
          { question: "Which screens?", options: ["All", "Overview"] },
          { question: "Which palette?", options: ["Grey", "Blue"] },
        ],
        live: true,
        onAnswer: () => {},
      }),
    );
    expect(html).toContain('aria-pressed="false"');
    // Nothing picked yet, so there is nothing to send.
    expect(html).not.toContain("Send answers");
  });

  it("leaves an old reply's answers on screen but not clickable", () => {
    const html = renderToStaticMarkup(createElement(ClarifyChoices, { choices: [{ question: "Q?", options: ["A"] }], live: false, onAnswer: () => {} }));
    expect(html).toContain("disabled");
    expect(html).not.toContain("Or type your own answer");
  });
});

describe("the proposal queue", () => {
  const p = (id: string, createdAt: number, status: SharedProposal["status"] = "open", via?: "mcp"): SharedProposal =>
    ({ _id: id, projectId: "x", requestedBy: "u", requestedByName: "U", request: id, author: "a", labels: [], changes: [], rejected: [], createdAt, updatedAt: createdAt, status, ...(via ? { via } : {}) }) as SharedProposal;

  it("puts the first asked first, and leaves decided ones out", () => {
    // The store keeps the list newest first.
    const list = [p("third", 3), p("decided", 2.5, "accepted"), p("second", 2), p("first", 1)];
    expect(queueOf(list).map((x) => x._id)).toEqual(["first", "second", "third"]);
  });

  it("can be narrowed to one pane's proposals", () => {
    const list = [p("chat", 2), p("mcp-late", 3, "open", "mcp"), p("mcp-early", 1, "open", "mcp")];
    expect(queueOf(list, (x) => x.via === "mcp").map((x) => x._id)).toEqual(["mcp-early", "mcp-late"]);
  });
});
