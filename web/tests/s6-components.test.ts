import { describe, expect, it } from "vitest";
import { BENCHED_PARTS, COMPONENTS, COMPONENT_KINDS, expandComponent, sizeFor } from "@/lib/components";
import type { Density, Token } from "@/lib/components/theme";
import { DEFAULT_THEME } from "@/lib/components/theme";
import { Part } from "@/lib/ote/schema";

const densities: Density[] = ["compact", "regular", "large"];
const sizes = ["S", "M", "L"] as const;

describe("the benched component catalogue", () => {
  it("expands every kind, variant, size and density inside its 4 px box with only proven parts", () => {
    for (const kind of COMPONENT_KINDS) for (const variant of COMPONENTS[kind].variants) for (const size of sizes) for (const density of densities) {
      const dimensions = sizeFor(kind, variant, size, density);
      const tags = Object.fromEntries(COMPONENTS[kind].roles.map((slot) => [slot.role, `${kind}_${slot.role}`]));
      const use = { kind, variant, size, density, tags, props: {}, name: `${kind}_${variant}_${size}_${density}` };
      const label = `${kind}.${variant}.${size}.${density}`;
      expect(dimensions.width % 8, label).toBe(0);
      expect(dimensions.height % 8, label).toBe(0);
      const expanded = expandComponent(use, { left: 8, top: 8, ...dimensions });
      expect(expanded.parts.length, label).toBeGreaterThan(0);
      for (const part of expanded.parts) {
        expect(BENCHED_PARTS, label).toContain(part.Type);
        expect(Part.safeParse(part).success, `${label}: ${part.Name}`).toBe(true);
        expect(part.Location.Left % 4, `${label}: ${part.Name} left`).toBe(0);
        expect(part.Location.Top % 4, `${label}: ${part.Name} top`).toBe(0);
        expect((part.Width ?? 0) % 4, `${label}: ${part.Name} width`).toBe(0);
        expect((part.Height ?? 0) % 4, `${label}: ${part.Name} height`).toBe(0);
        if ("Font" in part && part.Font && typeof part.Font === "object" && "Size" in part.Font && typeof part.Font.Size === "number")
          expect(part.Font.Size, `${label}: ${part.Name} font`).toBeGreaterThanOrEqual(DEFAULT_THEME.type[density].small);
      }
      for (const wire of expanded.wires) {
        expect(wire.index, label).toBeGreaterThanOrEqual(0);
        expect(wire.index, label).toBeLessThan(expanded.parts.length);
        expect(Object.values(tags), label).toContain(wire.tag);
      }
    }
  });

  it("binds Bar fill through a Scale converter and writes a nonzero design value", () => {
    const expanded = expandComponent({ kind: "Bar", variant: "horizontal", size: "M", tags: { value: "FLOW" },
      props: { min: 0, max: 200, normalLow: 60, normalHigh: 140 } }, { left: 0, top: 0, width: 240, height: 56 });
    const wire = expanded.wires.find((w) => w.property === "Animation.FillLevel.HorizontalFill");
    expect(wire?.converter).toEqual({ min: 0, max: 200 });
    const part = expanded.parts[wire!.index];
    expect(part.Type).toBe("Rectangle");
    if (part.Type === "Rectangle") expect(part.Animation?.FillLevel?.HorizontalFill).toBe(50);
  });

  it("uses only palette tokens declared by each component", () => {
    for (const kind of COMPONENT_KINDS) {
      const def = COMPONENTS[kind];
      const expanded = expandComponent({ kind, variant: def.variants[0], size: "M", tags: {}, props: {} },
        { left: 0, top: 0, ...sizeFor(kind, def.variants[0], "M") });
      const allowed = new Set(def.tokens.map((token: Token) => DEFAULT_THEME.tokens[token]));
      const colours = (node: unknown): number[] => {
        if (!node || typeof node !== "object") return [];
        if (Array.isArray(node)) return node.flatMap(colours);
        const object = node as Record<string, unknown>;
        return Object.entries(object).flatMap(([key, value]) => key === "Value" && typeof value === "number" ? [value] : colours(value));
      };
      for (const part of expanded.parts) for (const colour of colours(part)) {
        if (colour >= 1 && colour <= 60) expect(allowed, `${kind}: ${part.Name} uses ${colour}`).toContain(colour);
      }
    }
  });
});
