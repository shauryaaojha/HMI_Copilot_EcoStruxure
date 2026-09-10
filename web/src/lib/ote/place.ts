/**
 * Where a new object goes when nobody said.
 *
 * A conversational edit does not always carry coordinates - "add a high level
 * alarm lamp" is a complete request and says nothing about where. The old
 * answer was to default to 20,20, which meant every object added that way
 * landed on the same spot: ask for three things across three turns and you get
 * three objects stacked in the top-left corner, which is exactly what it looks
 * like.
 *
 * So placement is computed rather than defaulted. The scan is deliberately
 * dumb - first free slot, reading order - because a clever packer would move
 * things around in ways the engineer did not ask for. It only ever chooses a
 * position; it never moves anything that is already placed.
 *
 * Screen chrome needs no special case: on a generated screen the header, the
 * navigation strip and the footer are objects like any other, so they are in
 * `taken` and the scan walks around them.
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

/** Matches lib/ote/layout.ts, so a hand-added object lines up with a laid-out one. */
const MARGIN = 12;
const GRID = 8;

const overlaps = (a: Box, b: Box, gap = 0) =>
  a.left < b.left + b.width + gap &&
  a.left + a.width + gap > b.left &&
  a.top < b.top + b.height + gap &&
  a.top + a.height + gap > b.top;

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

export interface PlaceOptions {
  /** Clear space to leave around the new object. */
  gap?: number;
  /** Step the scan moves in. Also what the result is aligned to. */
  grid?: number;
  /** Keep clear of the panel edge. */
  margin?: number;
}

/** How much of `candidate` is covered by everything already placed. */
function overlapArea(candidate: Box, taken: Box[]): number {
  let area = 0;
  for (const box of taken) {
    const w = Math.min(candidate.left + candidate.width, box.left + box.width) -
      Math.max(candidate.left, box.left);
    const h = Math.min(candidate.top + candidate.height, box.top + box.height) -
      Math.max(candidate.top, box.top);
    if (w > 0 && h > 0) area += w * h;
  }
  return area;
}

/**
 * The first free position for a box of this size, in reading order.
 *
 * Three passes, and the third is the one that matters on a screen that is
 * already full. A generated screen is *mostly* full - chrome, faceplates and an
 * alarm banner - so "no gap large enough" is the common case, not the edge
 * case. The first pass wants clear space around the object; the second accepts
 * a tight fit; the third gives up on finding a gap and returns the position
 * that covers the least of what is already there.
 *
 * It never returns null. An object the engineer asked for has to appear
 * somewhere they can see it and drag it, and a cascade down the diagonal - the
 * obvious fallback - is exactly the pile-in-the-corner this function exists to
 * prevent.
 */
export function freeSpot(
  taken: Box[],
  size: { width: number; height: number },
  panel: Panel,
  options: PlaceOptions = {},
): { left: number; top: number } {
  const gap = options.gap ?? GRID;
  const grid = options.grid ?? GRID;
  const margin = options.margin ?? MARGIN;

  const width = Math.min(size.width, panel.width - margin * 2);
  const height = Math.min(size.height, panel.height - margin * 2);
  const lastLeft = panel.width - margin - width;
  const lastTop = panel.height - margin - height;

  let best: { left: number; top: number; area: number } | null = null;

  for (const clearance of [gap, 0]) {
    for (let top = margin; top <= lastTop; top += grid) {
      for (let left = margin; left <= lastLeft; left += grid) {
        const candidate = { left, top, width, height };
        if (!taken.some((box) => overlaps(candidate, box, clearance))) {
          return { left, top };
        }
        if (clearance === 0) {
          const area = overlapArea(candidate, taken);
          if (!best || area < best.area) best = { left, top, area };
        }
      }
    }
  }

  return best
    ? { left: best.left, top: best.top }
    : { left: Math.max(margin, 0), top: Math.max(margin, 0) };
}

/**
 * A one-line description of where there is room, for the model's prompt.
 *
 * Telling it "the top 76 units are the header band" is less useful than telling
 * it the largest empty rectangle, because that is the question it is actually
 * answering when it picks a position.
 */
export function freeSpaceHint(taken: Box[], panel: Panel): string {
  if (taken.length === 0) {
    return `The screen is empty: ${panel.width} x ${panel.height} is all free.`;
  }

  const bottom = Math.max(...taken.map((b) => b.top + b.height));
  const right = Math.max(...taken.map((b) => b.left + b.width));
  const below = panel.height - bottom;
  const beside = panel.width - right;

  const parts: string[] = [];
  if (below >= 40) {
    parts.push(`below everything, from y=${bottom + MARGIN} down to ${panel.height - MARGIN}`);
  }
  if (beside >= 120) {
    parts.push(`to the right, from x=${right + MARGIN} across to ${panel.width - MARGIN}`);
  }

  return parts.length > 0
    ? `Free space: ${parts.join("; ")}.`
    : "The screen is full - place a new object only if you also move something.";
}
