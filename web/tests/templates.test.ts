/**
 * Phase 9: the templates, and the one thing that could go wrong with them.
 *
 * A template places objects on the canvas directly, bypassing the generator and
 * its zodOutputFormat guard. So the check that matters is that what a template
 * builds is a part the packager can emit - parsed through the real schema, not
 * eyeballed. A template that produced a plausible-looking invalid object would
 * put something on the canvas that no export could contain, which is the one
 * rule in docs/BUILD_PLAN.md.
 */

import { describe, expect, it } from "vitest";
import { Part, Screen } from "@/lib/ote/schema";
import { TEMPLATES, CATEGORIES } from "@/components/templates/templates";

describe("every template builds parts the packager can emit", () => {
  for (const template of TEMPLATES) {
    describe(template.name, () => {
      const parts = template.build({ left: 40, top: 80 }, 2);

      it("parses through the real Part schema", () => {
        expect(parts.length).toBeGreaterThan(0);
        for (const part of parts) {
          const result = Part.safeParse(part);
          expect(
            result.success,
            `${part.Name}: ${result.success ? "" : JSON.stringify(result.error.issues)}`,
          ).toBe(true);
        }
      });

      it("wraps into a Screen the packager would accept", () => {
        const screen = Screen.safeParse({
          Type: "Screen",
          UniqueId: crypto.randomUUID(),
          Name: "T",
          Children: [
            {
              Type: "ViewBox",
              UniqueId: crypto.randomUUID(),
              Name: "T",
              Width: 1024,
              Height: 768,
              Children: parts,
            },
          ],
        });
        expect(screen.success).toBe(true);
      });

      it("places every part inside the footprint it advertises", () => {
        // The placer leaves room based on `size`; a part outside it would land
        // on top of whatever is already on the screen.
        for (const part of parts) {
          expect(part.Location.Left).toBeGreaterThanOrEqual(40);
          expect(part.Location.Top).toBeGreaterThanOrEqual(80);
          expect(part.Location.Left + part.Width).toBeLessThanOrEqual(
            40 + template.size.width,
          );
          expect(part.Location.Top + part.Height).toBeLessThanOrEqual(
            80 + template.size.height,
          );
        }
      });

      it("honours the offset it is given", () => {
        const moved = template.build({ left: 140, top: 180 }, 2);
        expect(moved[0].Location.Left - parts[0].Location.Left).toBe(100);
        expect(moved[0].Location.Top - parts[0].Location.Top).toBe(100);
      });

      it("gives every part a fresh id, so placing it twice is two objects", () => {
        const again = template.build({ left: 40, top: 80 }, 2);
        const first = new Set(parts.map((p) => p.UniqueId));
        expect(first.size).toBe(parts.length);
        for (const part of again) expect(first.has(part.UniqueId)).toBe(false);
      });

      it("numbers its objects from the index it is given", () => {
        const one = template.build({ left: 0, top: 0 }, 1);
        const two = template.build({ left: 0, top: 0 }, 2);
        // At least one name has to differ, or a second placement collides.
        expect(one.map((p) => p.Name)).not.toEqual(two.map((p) => p.Name));
      });
    });
  }

  it("declares a category for every template, and lists them all", () => {
    for (const template of TEMPLATES) {
      expect(CATEGORIES).toContain(template.category);
    }
    expect(CATEGORIES[0]).toBe("All");
  });

  it("has a unique id per template", () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
