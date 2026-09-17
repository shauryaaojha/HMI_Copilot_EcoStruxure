/**
 * Keeping a box inside the panel.
 *
 * This module used to also compute where a new object goes when nobody said,
 * and nudge a given position off whatever it covered. Both are gone: a
 * conversational op now names a region or an anchor and lib/ote/regions.ts
 * resolves it, refusing when there is no room rather than guessing. What is
 * left is the one rule that applies to an explicit coordinate too - an object
 * outside the ViewBox is clipped by SVG and simply never appears.
 */

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Panel {
  width: number;
  height: number;
}

/**
 * Pulls a box fully inside the panel, shrinking it only if it cannot fit.
 *
 * A model that answers `top: 900` on a 600-high panel is not making a small
 * mistake - the object lands outside the ViewBox, SVG clips it, and it is
 * simply invisible. The engineer then asks again, and now there are two.
 */
export function clampToPanel(box: Box, panel: Panel): Box {
  const width = Math.min(Math.max(1, Math.round(box.width)), panel.width);
  const height = Math.min(Math.max(1, Math.round(box.height)), panel.height);
  return {
    width,
    height,
    left: Math.min(Math.max(0, Math.round(box.left)), panel.width - width),
    top: Math.min(Math.max(0, Math.round(box.top)), panel.height - height),
  };
}
