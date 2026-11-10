/** What the review dialog says a proposal touches, counted from its changes. */
import { describe, expect, it } from "vitest";
import { briefOf } from "@/components/chat/ProposalReview";
import type { StoreChange } from "@/lib/collab/types";
import { demoScreen } from "@/fixtures";

describe("the brief of a proposal", () => {
  const doc = { screens: [structuredClone(demoScreen)] };
  const first = demoScreen.Children[0].Children[0];
  const fresh = { ...structuredClone(first), UniqueId: "11111111-1111-4111-8111-111111111111", Name: "New_One" };
  const newScreen = { ...structuredClone(demoScreen), UniqueId: "22222222-2222-4222-8222-222222222222", Name: "Settings" };

  it("tells added from changed by what is already on the screen, and counts what goes", () => {
    const changes = [
      { kind: "setPart", screenId: demoScreen.UniqueId, part: fresh },
      { kind: "setPart", screenId: demoScreen.UniqueId, part: first },
      { kind: "removePart", screenId: demoScreen.UniqueId, partId: first.UniqueId },
    ] as StoreChange[];
    expect(briefOf(doc, changes).screens).toEqual([{ id: demoScreen.UniqueId, name: demoScreen.Name, state: "changed", added: 1, changed: 1, removed: 1 }]);
  });

  it("names a new screen with what is on it, a deleted one, and the project's own changes", () => {
    const brief = briefOf(doc, [
      { kind: "addScreen", screen: newScreen },
      { kind: "removeScreen", screenId: demoScreen.UniqueId },
      { kind: "setVariable", variable: { Name: "A", DataType: "BOOL", Comments: "", DeviceAddress: "" } },
      { kind: "removeVariable", name: "B" },
      { kind: "setBinding", binding: { tag: "A", targetId: first.UniqueId, targetName: first.Name, property: "CurrentValue" } },
    ] as StoreChange[]);
    expect(brief.screens).toEqual([
      { id: newScreen.UniqueId, name: "Settings", state: "new", added: newScreen.Children[0].Children.length, changed: 0, removed: 0 },
      { id: demoScreen.UniqueId, name: demoScreen.Name, state: "removed", added: 0, changed: 0, removed: 0 },
    ]);
    expect(brief.tags).toEqual({ set: 1, removed: 1 });
    expect(brief.bindings).toEqual({ set: 1, removed: 0 });
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProposalReviewDialog } from "@/components/chat/ProposalReview";
import { useProject } from "@/store/project";
import { demoVariables } from "@/fixtures";

describe("the review dialog", () => {
  it("draws the request, what it touches, both pictures, every change and what could not be done", () => {
    const s = useProject.getState();
    s.reset();
    s.hydrate({ id: "p", name: "Test", target: { model: "HMIGTO6310", width: 1024, height: 600 }, screens: [structuredClone(demoScreen)], activeScreenId: demoScreen.UniqueId, variables: structuredClone(demoVariables) });
    const first = demoScreen.Children[0].Children[0];
    const html = renderToStaticMarkup(
      createElement(ProposalReviewDialog, {
        onClose: () => undefined,
        proposal: {
          _id: "x", projectId: "p", screenId: demoScreen.UniqueId, requestedBy: "alice", requestedByName: "Alice", request: "Make the drink buttons pill shaped", author: "agent",
          labels: ["Rounded the espresso button", "Moved the title"], rejected: ["setStyle Go: only a Rectangle has rounded corners"],
          changes: [{ kind: "setPart", screenId: demoScreen.UniqueId, part: { ...structuredClone(first), Name: "Renamed" } }],
          createdAt: Date.now(), updatedAt: Date.now(), status: "open",
        },
      }),
    );
    for (const text of ["A change is waiting for you", "Make the drink buttons pill shaped", "for Alice", "1 changed", "Now", "If you accept", "Rounded the espresso button", "could not be done", "only a Rectangle has rounded corners", "sign-off log"]) {
      expect(html).toContain(text);
    }
    // Both pictures are drawn, not placeholders.
    expect(html.match(/aria-label="HMI screen/g)).toHaveLength(2);
  });
});
