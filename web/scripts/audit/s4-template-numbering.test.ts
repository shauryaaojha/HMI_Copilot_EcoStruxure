/**
 * S4: placing a template twice labels both blocks "PUMP 1" (or "MOTOR 1", "TANK 1"...).
 *
 * TemplatesScreen.use (src/components/templates/TemplatesScreen.tsx:115-117) numbers the
 * next block by counting parts whose Name starts with the template id's first word,
 * upper-cased ("PUMP", "MOTOR", "TANK"...). No template names a part that way
 * (templates.ts: "Panel_Pump1", "Lbl_Pump1", "Lamp_PUMP1_RUN"...), so the count is always
 * 0 and n is always 1. The store renames the second block's parts with _2, but its
 * visible text still reads "PUMP 1", which contradicts the comment at lines 113-114.
 */
import { describe, expect, it } from "vitest";
import { TEMPLATES } from "@/components/templates/templates";

describe("template numbering", () => {
  for (const template of TEMPLATES) {
    it(`${template.id}: a placed block is counted by the prefix use() looks for`, () => {
      const prefix = template.id.split("-")[0].toUpperCase();
      const placed = template.build({ left: 0, top: 0 }, 1);
      const counted = placed.filter((p) => p.Name.startsWith(prefix)).length;
      expect(
        counted,
        `${template.id}: none of ${placed.map((p) => p.Name).join(", ")} starts with "${prefix}", so the second block is numbered 1 again`,
      ).toBeGreaterThan(0);
    });
  }
});
