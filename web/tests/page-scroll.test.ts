import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The account, connections, consent, reset and share pages were all cut off at
// the bottom of the window, with no way to reach what was below, because the
// document itself refused to scroll on the workspace's behalf.
describe("who scrolls", () => {
  it("lets the document scroll, so a tall page is never cut off", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    // The rule that sets the page ground, not the height one shared with html.
    const body = [...css.matchAll(/^body \{[^}]*\}/gm)].map((m) => m[0]).find((rule) => rule.includes("font-family")) ?? "";
    expect(body).toContain("overflow-y: auto");
    expect(body).not.toMatch(/overflow(-y)?: hidden/);
  });

  it("keeps the workspace in the window, where its own regions scroll", () => {
    expect(readFileSync("src/app/(workspace)/layout.tsx", "utf8")).toContain("h-screen overflow-hidden");
  });
});
