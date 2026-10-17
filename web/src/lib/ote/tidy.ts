/**
 * Overlaps, found and moved clear - by the layout engine, not by the model.
 *
 * Asked to "fix the overlapping", the model had nothing to go on: its digest
 * names objects by handle, type and region, never where they are. It guessed
 * handles for an alignObjects op and was told "None of those objects exist,
 * so there was nothing to align". Finding which objects share pixels is
 * geometry, and so is finding where one of them can go; neither needs a guess.
 *
 * A faceplate moves whole. Its parts carry one groupId (a composite), so a
 * card, its lamps and its readings are one unit here: moving a lamp out from
 * under the card it belongs to would turn one defect into two.
 *
 * Chrome (background, header, navigation, footer, alarm banner) and pipes are
 * left out, as the geometry critic leaves them out: the frame is drawn the
 * same on every screen, and a pipe's box overlaps what it connects by design.
 */

import type { Part } from "./schema";
import { boxOf, resolveSlot, type Box, type Side } from "./regions";

const CHROME = /^(Ground|Hdr|HdrTitle|HdrLevel|Nav|NavChip|NavLbl|Foot|FootLbl|FootMark|AlarmBanner|AlarmsLbl)_/;
/** Less than this many pixels of shared width or height is a touch, not an overlap. */
const TOLERANCE = 2;
/** Where a moved unit is tried, in order: beside what it overlapped, then anywhere in the body. */
const SIDES: Side[] = ["below", "rightOf", "leftOf", "above"];

interface Unit {
  ids: string[];
  name: string;
  box: Box;
}

export interface Overlap {
  /** The smaller of the two: the one in the wrong place. */
  mover: Unit;
  other: Unit;
  width: number;
  height: number;
}

export interface TidyPlan {
  moves: { ids: string[]; name: string; dx: number; dy: number }[];
  /** Units that overlap something and had nowhere to go. */
  stuck: string[];
  /** What overlapped before anything moved. */
  found: Overlap[];
}

const union = (boxes: Box[]): Box => {
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  const right = Math.max(...boxes.map((b) => b.left + b.width));
  const bottom = Math.max(...boxes.map((b) => b.top + b.height));
  return { left, top, width: right - left, height: bottom - top };
};
const holds = (a: Box, b: Box) => b.left >= a.left && b.top >= a.top && b.left + b.width <= a.left + a.width && b.top + b.height <= a.top + a.height;
const areaOf = (b: Box) => Math.max(0, b.width) * Math.max(0, b.height);

/**
 * What moves together with a part: a card takes everything drawn inside it,
 * a composite moves whole, anything else alone. The card is not part of the
 * composite of the lamps on it, so "move the grinder faceplate" moved the
 * empty card and left its lamps and readings where they were.
 */
function containerOf(parts: Part[], panel?: { width: number; height: number }) {
  const boxes = new Map(parts.map((p) => [p.UniqueId, boxOf(p)]));
  const big = panel ? (panel.width * panel.height) / 2 : Number.POSITIVE_INFINITY;
  const candidates = parts.filter(
    (p) => p.Type === "Rectangle" && !CHROME.test(p.Name) && areaOf(boxes.get(p.UniqueId)!) < big,
  );
  /** "GRD202" for Card_GRD202: what a generated faceplate's parts are named after. */
  const keyOf = (card: Part) => card.Name.split("_").slice(1).join("_");
  /**
   * The card holding a part: one named for it first (Lamp_GRD202_RUN is on
   * Card_GRD202), else the innermost. Two cards pushed on top of each other
   * both hold the lamps where they overlap; by size alone a tie went to the
   * wrong card and the lamp left with it.
   */
  return (part: Part): Part | undefined => {
    const b = boxes.get(part.UniqueId)!;
    const holders = candidates.filter((c) => {
      if (c === part) return false;
      const cb = boxes.get(c.UniqueId)!;
      return holds(cb, b) && areaOf(cb) > areaOf(b);
    });
    const named = holders.filter((c) => keyOf(c).length > 2 && part.Name.includes(keyOf(c)));
    const pool = named.length > 0 ? named : holders;
    return pool.sort((x, y) => areaOf(boxes.get(x.UniqueId)!) - areaOf(boxes.get(y.UniqueId)!))[0];
  };
}

function unitsOf(parts: Part[], groupOf: (id: string) => string | undefined, panel?: { width: number; height: number }): Unit[] {
  const movable = parts.filter((p) => !CHROME.test(p.Name) && p.Type !== "Pipe");
  const inner = containerOf(movable, panel);
  // Up the chain of innermost holders to the top: a value in a bar band on a
  // card belongs to the card. Two cards that overlap do not hold each other,
  // so a lamp on one is never taken for part of the other.
  const top = new Map<string, string>();
  const topOf = (p: Part): string => {
    const known = top.get(p.UniqueId);
    if (known) return known;
    const holder = inner(p);
    const t = holder ? topOf(holder) : p.UniqueId;
    top.set(p.UniqueId, t);
    return t;
  };
  const rootOf = new Map<string, string>();
  for (const p of movable) {
    const t = topOf(p);
    rootOf.set(p.UniqueId, t !== p.UniqueId ? t : groupOf(p.UniqueId) ? `g:${groupOf(p.UniqueId)}` : p.UniqueId);
  }
  // A composite moves whole: its members follow the card most of them sit on.
  const groups = new Map<string, Part[]>();
  for (const p of movable) {
    const g = groupOf(p.UniqueId);
    if (g) (groups.get(g) ?? groups.set(g, []).get(g)!).push(p);
  }
  for (const members of groups.values()) {
    const votes = new Map<string, number>();
    for (const m of members) {
      const r = rootOf.get(m.UniqueId)!;
      if (!r.startsWith("g:")) votes.set(r, (votes.get(r) ?? 0) + 1);
    }
    const winner = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (winner) for (const m of members) rootOf.set(m.UniqueId, winner);
  }
  const byRoot = new Map<string, Part[]>();
  for (const p of movable) {
    const r = rootOf.get(p.UniqueId)!;
    (byRoot.get(r) ?? byRoot.set(r, []).get(r)!).push(p);
  }
  return [...byRoot.entries()].map(([root, members]) => {
    const head = members.find((m) => m.UniqueId === root) ?? members[0];
    return { ids: members.map((m) => m.UniqueId), name: head.Name, box: union(members.map(boxOf)) };
  });
}

/** The ids that move with this part: its card's whole content, or its composite, or itself. */
export function moveSetOf(
  parts: Part[],
  id: string,
  groupOf: (id: string) => string | undefined = () => undefined,
  panel?: { width: number; height: number },
): string[] {
  const part = parts.find((p) => p.UniqueId === id);
  if (!part || CHROME.test(part.Name)) return [id];
  const unit = unitsOf(parts, groupOf, panel).find((u) => u.ids.includes(id));
  if (!unit) return [id];
  // Moving a lamp on a card moves the lamp (and its composite); moving the
  // card moves the faceplate.
  const head = unit.name === part.Name;
  if (head) return unit.ids;
  const g = groupOf(id);
  return g ? parts.filter((p) => groupOf(p.UniqueId) === g).map((p) => p.UniqueId) : [id];
}

/** Every pair of units that share pixels and are not one inside the other. */
export function overlapsOn(
  parts: Part[],
  groupOf: (id: string) => string | undefined = () => undefined,
  panel?: { width: number; height: number },
): Overlap[] {
  const units = unitsOf(parts, groupOf, panel);
  const out: Overlap[] = [];
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i].box;
      const b = units[j].box;
      // A label sitting on a card is on it, not over it.
      if (holds(a, b) || holds(b, a)) continue;
      const width = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
      const height = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
      if (width <= TOLERANCE || height <= TOLERANCE) continue;
      const [mover, other] = areaOf(a) <= areaOf(b) ? [units[i], units[j]] : [units[j], units[i]];
      out.push({ mover, other, width, height });
    }
  }
  return out;
}

/**
 * Where each overlapping unit can go: beside what it overlapped, else the
 * first clear spot in the body. A few passes, because moving one unit can
 * clear another's overlap or land it next to a third.
 */
export function planTidy(
  parts: Part[],
  panel: { width: number; height: number },
  groupOf: (id: string) => string | undefined = () => undefined,
): TidyPlan {
  const work = parts.map((p) => structuredClone(p));
  const found = overlapsOn(work, groupOf, panel);
  const moves = new Map<string, { ids: string[]; name: string; dx: number; dy: number }>();
  const stuck = new Set<string>();

  for (let pass = 0; pass < 3; pass++) {
    const overlaps = overlapsOn(work, groupOf, panel);
    if (overlaps.length === 0) break;
    let moved = false;
    const done = new Set<string>();
    for (const { mover, other } of overlaps) {
      const key = mover.ids.join(",");
      if (done.has(key)) continue;
      done.add(key);
      const mine = new Set(mover.ids);
      const rest = work.filter((p) => !mine.has(p.UniqueId));
      const size = { width: mover.box.width, height: mover.box.height };
      // A slot is a position: the slot finder rounds sizes to its grid, but a
      // moved object keeps its own. Each position is tried at full size and
      // taken only if it lands on the panel and clear of everything else.
      const clearAt = (box: Box) => {
        if (box.left < 0 || box.top < 0 || box.left + size.width > panel.width || box.top + size.height > panel.height) return false;
        const dx = box.left - mover.box.left;
        const dy = box.top - mover.box.top;
        const trial = work.map((p) => (mine.has(p.UniqueId) ? { ...p, Location: { ...p.Location, Left: p.Location.Left + dx, Top: p.Location.Top + dy } } : p));
        return !overlapsOn(trial, groupOf, panel).some((o) => o.mover.ids.some((id) => mine.has(id)) || o.other.ids.some((id) => mine.has(id)));
      };
      let to: Box | undefined;
      for (const side of SIDES) {
        const slot = resolveSlot({ side, anchor: other.name }, rest, panel, size, { anchorBox: other.box, anchorId: other.ids[0] });
        if (slot.ok && clearAt(slot.box)) {
          to = slot.box;
          break;
        }
      }
      if (!to) {
        const slot = resolveSlot({ region: "body" }, rest, panel, size);
        if (slot.ok && clearAt(slot.box)) to = slot.box;
      }
      if (!to) {
        stuck.add(mover.name);
        continue;
      }
      const dx = to.left - mover.box.left;
      const dy = to.top - mover.box.top;
      for (const p of work) {
        if (!mine.has(p.UniqueId)) continue;
        p.Location.Left += dx;
        p.Location.Top += dy;
      }
      const prior = moves.get(key);
      moves.set(key, { ids: mover.ids, name: mover.name, dx: (prior?.dx ?? 0) + dx, dy: (prior?.dy ?? 0) + dy });
      stuck.delete(mover.name);
      moved = true;
    }
    if (!moved) break;
  }
  return { moves: [...moves.values()].filter((m) => m.dx !== 0 || m.dy !== 0), stuck: [...stuck], found };
}
