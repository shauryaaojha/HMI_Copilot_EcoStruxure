/**
 * S4-04: placing a template twice labelled both blocks "PUMP 1", because the next
 * number came from a name prefix no template uses. It now comes from the block's
 * own part names, so this proves the second block really is number 2.
 */
import { describe, expect, it } from "vitest";
import { TEMPLATES, nextBlockNumber } from "@/components/templates/templates";

describe("template numbering", () => {
  for (const template of TEMPLATES) {
    it(`${template.id}: a second block on the screen is numbered 2`, () => {
      const at = { left: 0, top: 0 };
      expect(nextBlockNumber(template, at, [])).toBe(1);
      const first = template.build(at, 1);
      expect(nextBlockNumber(template, at, first)).toBe(2);
      const second = template.build(at, 2);
      expect(nextBlockNumber(template, at, [...first, ...second])).toBe(3);
    });
  }
});
