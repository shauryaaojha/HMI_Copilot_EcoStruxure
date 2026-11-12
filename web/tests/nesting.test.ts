/**
 * The nested layout (lib/ote/nesting.ts) on a screen like the water plant's
 * Intake and Dosing: a grey page, two white cards, buttons on each card.
 *
 * What is held: a card is a container, not an obstacle, so a body of two big
 * cards still shows the room on them; each object is listed under its card;
 * the free areas are really free; a title wider than its card and a RESET
 * drawn over a START are reported.
 */
import { describe, expect, it } from "vitest";
import type { Part } from "@/lib/ote/schema";
import { freeAreas, layoutTree, nest, nestingProblems } from "@/lib/ote/nesting";

const part = (Type: string, Name: string, Left: number, Top: number, Width: number, Height: number) =>
  ({ Type, Name, UniqueId: Name, Location: { Left, Top }, Width, Height }) as unknown as Part;

const screen = [
  part("Rectangle", "Page", 0, 0, 1024, 600),
  part("Rectangle", "P1_Card", 36, 100, 300, 400),
  part("TextBox", "P1_Title", 60, 116, 420, 36), // wider than its card
  part("Lamp", "P1_Run", 60, 170, 40, 40),
  part("Switch", "P1_Start", 60, 380, 120, 44),
  part("Rectangle", "P2_Card", 360, 100, 628, 400),
  part("TextBox", "P2_Title", 384, 116, 400, 36),
  part("Switch", "P2_Start", 384, 300, 120, 44),
  part("Switch", "P2_Reset", 470, 300, 120, 44), // drawn over P2_Start
];

describe("the nested layout", () => {
  it("puts each object under the smallest card that holds it whole", () => {
    const [page] = nest(screen);
    expect(page.part.Name).toBe("Page");
    const cards = page.children.filter((n) => n.children.length).map((n) => [n.part.Name, n.children.map((c) => c.part.Name)]);
    expect(cards).toEqual([
      ["P1_Card", ["P1_Run", "P1_Start"]],
      ["P2_Card", ["P2_Title", "P2_Start", "P2_Reset"]],
    ]);
  });

  it("shows room on a card even when the cards fill the body", () => {
    const tree = layoutTree(screen);
    const p2 = tree.split("\n").find((l) => l.includes("P2_Card"))!;
    expect(p2).toMatch(/free inside: \d+,\d+ \d+x\d+/);
    expect(p2).not.toContain("free inside: none");
  });

  it("finds free areas clear of what is there", () => {
    const inner = { left: 0, top: 0, width: 400, height: 200 };
    const free = freeAreas(inner, [{ left: 0, top: 0, width: 200, height: 200 }], { gap: 0 });
    expect(free[0]).toEqual({ left: 200, top: 0, width: 200, height: 200 });
  });

  it("reports a title across its card's edge and two buttons over each other", () => {
    const problems = nestingProblems(screen);
    expect(problems.some((l) => l.startsWith("P1_Title crosses the edge of P1_Card"))).toBe(true);
    expect(problems.some((l) => l.startsWith("P2_Start overlaps P2_Reset"))).toBe(true);
    expect(problems.some((l) => l.startsWith("P1_Title crosses the edge of P2_Card"))).toBe(true);
  });
});
