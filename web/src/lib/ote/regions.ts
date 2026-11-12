/**
 * Regions and slots: how a conversational op says where something goes
 * without ever saying a coordinate.
 *
 * The model used to be handed every object's position and asked to pick
 * left/top for a new one. It cannot do that arithmetic reliably, and when the
 * screen was full it was told to move things out of the way - which is where
 * the unrequested moves came from. Now an op names a region ("header", "body",
 * "alarms"), or an anchor and a side ("rightOf o12"), and this module turns
 * that into a box or refuses with a sentence both the engineer and the model
 * can act on: "body on s2 has no free cell for a 320x162 card".
 *
 * Nothing here ever moves an existing object. docs/LLD.md F3.
 */

import { rootBox } from "@/lib/ote/schema";
import type { Part, Screen } from "./schema";
import { ZONES } from "./layout";

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

export const REGIONS = ["header", "nav", "body", "alarms", "footer"] as const;
export type Region = (typeof REGIONS)[number];

export const SIDES = ["rightOf", "leftOf", "below", "above", "inside"] as const;
export type Side = (typeof SIDES)[number];

/** Where an op wants a thing. Every field optional; nothing means "in the body". */
export interface Slot {
  region?: Region;
  /** Object handle or exact name. Resolved by the applier before it gets here. */
  anchor?: string;
  side?: Side;
}

const GRID = 8;
const { HEADER, NAV, FOOTER, MARGIN, GAP, CARD } = ZONES;

export const boxOf = (part: Part): Box => ({
  left: part.Location.Left,
  top: part.Location.Top,
  width: (part.Width ?? 0),
  height: (part.Height ?? 0),
});

const overlaps = (a: Box, b: Box, gap = 0) =>
  a.left < b.left + b.width + gap &&
  a.left + a.width + gap > b.left &&
  a.top < b.top + b.height + gap &&
  a.top + a.height + gap > b.top;

const contains = (outer: Box, inner: Box) =>
  inner.left >= outer.left &&
  inner.top >= outer.top &&
  inner.left + inner.width <= outer.left + outer.width &&
  inner.top + inner.height <= outer.top + outer.height;

const area = (b: Box) => Math.max(0, b.width) * Math.max(0, b.height);

const snap = (n: number) => Math.round(n / GRID) * GRID;

/**
 * The region boxes of a screen.
 *
 * Header, nav and footer are bands the layout engine always draws at the same
 * height, so their geometry is fixed. The alarm region exists only where a
 * screen has an AlarmSummary, and is the band from its caption down to the
 * footer. The body is whatever is left between the nav and the alarms.
 */
export function regionsOf(parts: Part[], panel: Panel): Record<Region, Box | null> {
  const footerTop = panel.height - FOOTER;
  const banner = parts.find((p) => p.Type === "AlarmSummary");
  // A generated banner is one line with no caption; an older one had a caption above it.
  const alarmTop = banner ? Math.max(HEADER + NAV, banner.Location.Top - ((banner.Height ?? 0) > 40 ? 24 : 0)) : null;
  const bodyTop = HEADER + NAV + 8;
  const bodyBottom = (alarmTop ?? footerTop) - 8;

  return {
    header: { left: 0, top: 0, width: panel.width, height: HEADER },
    nav: { left: 0, top: HEADER, width: panel.width, height: NAV },
    body: { left: 0, top: bodyTop, width: panel.width, height: Math.max(0, bodyBottom - bodyTop) },
    alarms:
      alarmTop !== null
        ? { left: 0, top: alarmTop, width: panel.width, height: footerTop - alarmTop }
        : null,
    footer: { left: 0, top: footerTop, width: panel.width, height: FOOTER },
  };
}

/** Which region a part sits in, by where its centre falls. */
export function regionOf(part: Part, regions: Record<Region, Box | null>): Region {
  const cx = part.Location.Left + (part.Width ?? 0) / 2;
  const cy = part.Location.Top + (part.Height ?? 0) / 2;
  for (const name of REGIONS) {
    const box = regions[name];
    if (!box) continue;
    if (cx >= box.left && cx < box.left + box.width && cy >= box.top && cy < box.top + box.height) {
      return name;
    }
  }
  return "body";
}

/**
 * A background is a rectangle that covers most of its region - the header
 * band, the nav strip, the footer, a card's panel. New content is allowed to
 * sit on one; that is what they are for. Everything else is content and may
 * not be covered.
 */
function isBackground(part: Part, region: Box): boolean {
  if (part.Type !== "Rectangle") return false;
  const b = boxOf(part);
  const inter = {
    left: Math.max(b.left, region.left),
    top: Math.max(b.top, region.top),
    width: Math.min(b.left + b.width, region.left + region.width) - Math.max(b.left, region.left),
    height: Math.min(b.top + b.height, region.top + region.height) - Math.max(b.top, region.top),
  };
  return area(inter) >= 0.85 * area(region);
}

/** How far a part placed on a card keeps from the card's edge. */
const SURFACE_PAD = 8;

/**
 * A surface is a rectangle other parts are meant to sit on: a card, a panel,
 * a band inside the body. Only a band that fills its region used to count, so
 * a body laid out as two white cards side by side - each about half of it -
 * read as full, and every placement on it was refused while most of each
 * card stood empty. A rectangle is a surface once it holds a smaller part: a
 * card with its title on it. An empty rectangle may as well be a drawn shape,
 * so it still blocks (tests/audit-fixes S5-09), and a button's backing pill
 * under a Switch of the same size holds nothing smaller and stays content.
 */
function isSurface(part: Part, parts: Part[]): boolean {
  if (part.Type !== "Rectangle") return false;
  const b = boxOf(part);
  return parts.some((q) => {
    if (q.UniqueId === part.UniqueId) return false;
    const qb = boxOf(q);
    return area(qb) < area(b) && contains(b, qb);
  });
}

/**
 * What a new object meets inside one region: `taken`, the content it must
 * keep clear of, and `surfaces`, the cards it may sit on but must not
 * straddle. A background band that fills the region is neither: it is the
 * region.
 */
function roomIn(parts: Part[], region: Box, exceptId?: string): { taken: Box[]; surfaces: Box[] } {
  const taken: Box[] = [];
  const surfaces: Box[] = [];
  for (const p of parts) {
    if (p.UniqueId === exceptId || isBackground(p, region)) continue;
    const b = boxOf(p);
    if (!overlaps(b, region)) continue;
    (isSurface(p, parts) ? surfaces : taken).push(b);
  }
  return { taken, surfaces };
}

const inset = (b: Box, pad: number): Box => ({ left: b.left + pad, top: b.top + pad, width: b.width - 2 * pad, height: b.height - 2 * pad });

/** Off every card, or wholly on one, clear of its edge: never half on and half off. */
const sitsWell = (candidate: Box, surfaces: Box[]) =>
  surfaces.every((s) => !overlaps(candidate, s) || contains(inset(s, SURFACE_PAD), candidate));

/**
 * The first clear position for a box of this size in a region, reading order.
 * Clearance first, then a tight fit; never on top of content, never across the
 * edge of a card, never a "least overlap" guess. Null means the region has no
 * room.
 */
export function firstFree(
  region: Box,
  taken: Box[],
  size: { width: number; height: number },
  margin: number = MARGIN,
  surfaces: Box[] = [],
): { left: number; top: number } | null {
  const width = size.width;
  const height = size.height;
  const firstLeft = snap(region.left + margin);
  const firstTop = snap(region.top + (region.top === 0 ? margin : 0));
  const lastLeft = region.left + region.width - margin - width;
  const lastTop = region.top + region.height - height - (region.top + region.height >= 600 ? 0 : 0);

  for (const clearance of [GAP / 2, 0]) {
    for (let top = firstTop; top <= lastTop; top += GRID) {
      for (let left = firstLeft; left <= lastLeft; left += GRID) {
        const candidate = { left, top, width, height };
        if (!taken.some((b) => overlaps(candidate, b, clearance)) && sitsWell(candidate, surfaces)) return { left, top };
      }
    }
  }
  return null;
}

export type SlotResult = { ok: true; box: Box; region: Region } | { ok: false; reason: string };

/**
 * A slot, resolved.
 *
 * `anchorBox` is the already-resolved anchor, because handles and names are the
 * applier's business. `screenLabel` is only for the refusal message.
 */
/**
 * A part's default size is the body's idea of it - a 180x64 lamp. Asked for
 * in the header, which is 44 high, the same lamp has to be a header lamp.
 * The height shrinks to the region with a little air, the width follows in
 * proportion down to a floor a label still fits in. The first recorded
 * session (docs/PLAN_PHASE2.md item 3) refused every header add without this.
 */
const INSET = 4;
const MIN_WIDTH = 60;
const down = (n: number) => Math.max(GRID, Math.floor(n / GRID) * GRID);
export function fitTo(size: { width: number; height: number }, region: Box) {
  // The same top margin firstFree() applies to a region on the panel's top
  // edge, or the fitted object can never start where the search starts.
  const topInset = region.top === 0 ? MARGIN : 0;
  const maxHeight = Math.max(GRID, region.height - topInset - INSET);
  const maxWidth = Math.max(GRID, region.width - MARGIN * 2);
  let { width, height } = size;
  if (height > maxHeight) {
    width = Math.max(MIN_WIDTH, Math.round((width * maxHeight) / height));
    height = maxHeight;
  }
  if (width > maxWidth) width = maxWidth;
  return { width: down(width), height: down(height) };
}

export function resolveSlot(
  slot: Slot,
  parts: Part[],
  panel: Panel,
  size: { width: number; height: number },
  options: { anchorBox?: Box; anchorId?: string; screenLabel?: string; exceptId?: string } = {},
): SlotResult {
  const regions = regionsOf(parts, panel);
  const label = options.screenLabel ?? "this screen";
  const fitsPanel = { width: Math.min(size.width, panel.width - MARGIN * 2), height: Math.min(size.height, panel.height) };

  if (slot.anchor !== undefined && !options.anchorBox) {
    return { ok: false, reason: `No object called ${slot.anchor} to place beside` };
  }

  if (options.anchorBox && slot.side) {
    const a = options.anchorBox;
    const anchorPart = parts.find((p) => p.UniqueId === options.anchorId);
    const regionName = anchorPart ? regionOf(anchorPart, regions) : (slot.region ?? "body");
    const region: Box = regions[regionName] ?? regions.body!;
    const fits = slot.side === "inside" ? fitTo(fitsPanel, a) : fitTo(fitsPanel, region);

    if (slot.side === "inside") {
      // Inside the anchor: the anchor is the region and its own box is not an
      // obstacle. What is already inside it is. What the anchor itself sits
      // on - the page, a band - covers it entirely and is not in the way:
      // counted as an obstacle, it made every "inside" on a framed screen fail.
      const within = parts.filter((p) => p.UniqueId !== options.anchorId && !contains(boxOf(p), a));
      const room = roomIn(within, a, options.exceptId);
      const at = firstFree(a, room.taken, fits, GAP / 2, room.surfaces);
      if (!at) {
        return { ok: false, reason: `${slot.anchor} on ${label} has no room inside it for a ${fits.width}x${fits.height} object` };
      }
      return { ok: true, box: { ...at, ...fits }, region: regionName };
    }

    const room = roomIn(parts, region, options.exceptId);
    const same = (b: Box) => b.left === a.left && b.top === a.top && b.width === a.width && b.height === a.height;
    const taken = room.taken.filter((b) => !same(b));
    const surfaces = room.surfaces.filter((b) => !same(b));
    const start: Box = {
      width: fits.width,
      height: fits.height,
      left:
        slot.side === "rightOf" ? a.left + a.width + GAP
        : slot.side === "leftOf" ? a.left - GAP - fits.width
        : a.left,
      top:
        slot.side === "below" ? a.top + a.height + GAP
        : slot.side === "above" ? a.top - GAP - fits.height
        : a.top,
    };
    // Slide along the side's axis, in grid steps, until something clear and
    // inside the region turns up. Never off the axis: "right of the pump" that
    // lands below it is a different answer.
    const horizontal = slot.side === "rightOf" || slot.side === "leftOf";
    const step = (slot.side === "leftOf" || slot.side === "above" ? -1 : 1) * GRID;
    for (let i = 0; i < 64; i++) {
      const candidate: Box = horizontal
        ? { ...start, left: snap(start.left + i * step) }
        : { ...start, top: snap(start.top + i * step) };
      if (!contains(region, candidate)) break;
      // The anchor itself is not an obstacle, but it must not be covered either.
      if (overlaps(candidate, a)) continue;
      if (!taken.some((b) => overlaps(candidate, b)) && sitsWell(candidate, surfaces)) return { ok: true, box: candidate, region: regionName };
    }
    return {
      ok: false,
      reason: `No room ${slot.side} ${slot.anchor} in the ${regionName} of ${label} for a ${fits.width}x${fits.height} object`,
    };
  }

  const regionName = slot.region ?? "body";
  const region = regions[regionName];
  if (!region) {
    return { ok: false, reason: `${label} has no ${regionName} region; add an alarm banner first` };
  }
  const fits = fitTo(fitsPanel, region);
  const room = roomIn(parts, region, options.exceptId);
  const at = firstFree(region, room.taken, fits, MARGIN, room.surfaces);
  if (!at) {
    return {
      ok: false,
      reason:
        regionName === "body"
          ? `The body of ${label} has no free space for a ${fits.width}x${fits.height} object; ask for a new screen or say what to replace`
          : `The ${regionName} of ${label} has no room for a ${fits.width}x${fits.height} object`,
    };
  }
  return { ok: true, box: { ...at, ...fits }, region: regionName };
}

/**
 * One line per region on what still fits, for the model's context. Counts,
 * not coordinates: "body: 2 of 6 card cells free; header: room for 2 small
 * objects; alarms: present".
 */
export function roomReport(parts: Part[], panel: Panel): string {
  const regions = regionsOf(parts, panel);
  const lines: string[] = [];

  const body = regions.body!;
  const columns = Math.max(1, Math.floor((panel.width - MARGIN * 2 + GAP) / (CARD.width + GAP)));
  const rows = Math.max(0, Math.floor((body.height + GAP) / (CARD.height + GAP)));
  const { taken: bodyTaken, surfaces: bodySurfaces } = roomIn(parts, body);
  let freeCells = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const cell = {
        left: MARGIN + c * (CARD.width + GAP),
        top: body.top + r * (CARD.height + GAP),
        width: CARD.width,
        height: CARD.height,
      };
      if (!bodyTaken.some((b) => overlaps(cell, b)) && sitsWell(cell, bodySurfaces)) freeCells++;
    }
  }
  const small = { width: 160, height: 28 };
  const smallFree = firstFree(body, bodyTaken, small, MARGIN, bodySurfaces) !== null;
  lines.push(
    `body: ${freeCells} of ${rows * columns} card cells free` +
      (freeCells === 0 && smallFree ? " (room only for small objects)" : "") +
      (freeCells === 0 && !smallFree ? " (full: a new object needs a new screen or a replacement)" : ""),
  );

  for (const name of ["header", "nav", "footer"] as const) {
    const region = regions[name]!;
    const room = roomIn(parts, region);
    let n = 0;
    const filled: Box[] = [...room.taken];
    for (;;) {
      const at = firstFree(region, filled, small, MARGIN, room.surfaces);
      if (!at || n >= 6) break;
      filled.push({ ...at, ...small });
      n++;
    }
    lines.push(`${name}: room for ${n} small object${n === 1 ? "" : "s"}`);
  }
  lines.push(regions.alarms ? "alarms: banner present" : "alarms: no banner on this screen");
  return lines.join("; ");
}

export function panelOf(screen: Screen, fallback?: Panel): Panel {
  return rootBox(screen.Children[0], fallback);
}
