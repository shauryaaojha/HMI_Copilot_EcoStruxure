/**
 * Screen colours in an EcoStruxure project are indices into the project palette,
 * not RGB values. This is ColorSet 4, "Green-Simple", read from the product's own
 * Buildtime/CommonScripts/Colors/Colors.lua.
 *
 * Resolving indices here rather than baking hex into the generator is what lets a
 * generated screen match the project's house style by construction - change the
 * project's colour set and every screen follows.
 */

export const COLOR_SETS = {
  4: {
    name: "Green-Simple",
    colors: [
      0x030303, 0xf1f1f1, 0x00b050, 0xf9a605, 0xf77a84, 0x3b70de, 0x4cc5bf,
      0xb5c801, 0xc98c4a, 0xac97e1, 0xd9d9d9, 0x303030, 0x57ffa7, 0xfffd5c,
      0xffd1db, 0x92c7ff, 0xa3ffff, 0xffff58, 0xffe3a1, 0xffeeff, 0xffffff,
      0x515151, 0x2ada7a, 0xffd02f, 0xffa4ae, 0x659aff, 0x76efe9, 0xdff22b,
      0xf3b674, 0xd6c1ff, 0x000000, 0x262626, 0x009a3a, 0xe39000, 0xe1646e,
      0x255ac8, 0x36afa9, 0x9fb200, 0xb37634, 0x9681cb, 0xfefefe, 0x313131,
      0x008626, 0xcf7c00, 0xcd505a, 0x1146b4, 0x229b95, 0x8b9e00, 0x9f6220,
      0x826db7, 0x05952c, 0x474747, 0x005000, 0x994600, 0x971a24, 0x00107e,
      0x00655f, 0x556800, 0x692c00, 0x4c3781,
    ],
  },
} as const;

export type ColorSetId = keyof typeof COLOR_SETS;

export const DEFAULT_COLOR_SET: ColorSetId = 4;

/** Named indices the generator uses, so intent reads better than magic numbers. */
export const INK = 1;
export const PAPER = 2;
export const GREEN = 3;
export const AMBER = 4;
export const RED = 5;
export const GREY = 11;
export const WHITE = 21;
export const DARK_GREY = 22;
export const BLACK = 31;
export const DARK_GREEN = 43;

/** Palette index -> "#rrggbb". Indices are 1-based, as the product writes them. */
export function resolveColor(
  index: number | undefined,
  fallback = "#000000",
  set: ColorSetId = DEFAULT_COLOR_SET,
): string {
  if (index === undefined) return fallback;
  const value = COLOR_SETS[set].colors[index - 1];
  if (value === undefined) return fallback;
  return "#" + value.toString(16).padStart(6, "0");
}

/** Pulls the index out of the shape the product uses: { Color: { Value: n } }. */
export function colorIndexOf(
  node: unknown,
  key: string,
): number | undefined {
  const holder = (node as Record<string, unknown> | null)?.[key];
  const color = (holder as Record<string, unknown> | null)?.["Color"];
  const value = (color as Record<string, unknown> | null)?.["Value"];
  return typeof value === "number" ? value : undefined;
}
