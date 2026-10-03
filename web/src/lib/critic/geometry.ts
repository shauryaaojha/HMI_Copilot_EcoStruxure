/**
 * The geometric critic: what the vision critic found, as arithmetic.
 * docs/PLAN_PHASE4.md §3.
 *
 * Every rule here traces to a defect this pipeline actually shipped and a
 * model actually caught. The model was the cheapest way to get a look at the
 * time; it was never the cheapest way to get these answers. A stroke that
 * vanishes is a number, two labels on top of each other is arithmetic, and a
 * pump labelled with a level reading is a table lookup. Done this way it runs
 * on every screen of every sample on every commit, for nothing, instead of on
 * one screen when we remember to ask.
 *
 * Deterministic, keyless, no network: Lane 1. Nothing in here may become a
 * model call.
 *
 * Findings use the same shape as the pack lint, so the Validation page puts
 * the engineer in front of the object either way.
 */

import type { Finding } from "@/lib/validation/rules";
import { rootBox } from "@/lib/ote/schema";
import type { Part, Screen } from "@/lib/ote/schema";
import { DEFAULT_PACK, tokenHex, type StandardPack } from "@/lib/standard/pack";
import { COLOR_SETS, packedHex, resolveColor } from "@/lib/ote/palette";

/* --- geometry ---------------------------------------------------------- */

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const boxOf = (p: Part): Box => ({
  left: p.Location.Left,
  top: p.Location.Top,
  right: p.Location.Left + (p.Width ?? 0),
  bottom: p.Location.Top + (p.Height ?? 0),
});

const areaOf = (b: Box) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);

/** The overlap of two boxes, as width and height; zero or less means none. */
function overlapOf(a: Box, b: Box): { width: number; height: number } {
  return {
    width: Math.min(a.right, b.right) - Math.max(a.left, b.left),
    height: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
  };
}

/** a holds b entirely: a card and its contents, or the ground and everything. */
const holds = (a: Box, b: Box) => a.left <= b.left && a.top <= b.top && a.right >= b.right && a.bottom >= b.bottom;

/** Distance from a point to the nearest point of a box; zero inside it. */
function distanceTo(box: Box, x: number, y: number): number {
  const dx = Math.max(box.left - x, 0, x - box.right);
  const dy = Math.max(box.top - y, 0, y - box.bottom);
  return Math.hypot(dx, dy);
}

const centreOf = (b: Box) => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });

/* --- colour ------------------------------------------------------------ */

/** WCAG relative luminance, so a contrast ratio means what it means elsewhere. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** Contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** A part's colour for one property, as hex, or undefined when it has none. */
function hexOf(part: Part, key: "Fill" | "Border" | "TextColor", pack: StandardPack): string | undefined {
  const paint = (part as unknown as Record<string, unknown>)[key] as { Color?: { Value?: number; ColorIndexEnabled?: boolean } } | undefined;
  const index = paint?.Color?.Value;
  if (typeof index !== "number") return undefined;
  // A project with no palette writes the colour itself, 0xRRGGBB; read as an
  // index it is no colour at all, and every contrast check on it is noise.
  if (paint?.Color?.ColorIndexEnabled === false) return packedHex(index);
  return resolveColor(index, "#000000", pack.colorSet as keyof typeof COLOR_SETS);
}

/* --- what a part is ---------------------------------------------------- */

/**
 * The suffixes a composite gives its members. Two parts of one composite are
 * meant to sit together; two parts of one composite on top of each other are
 * still a defect, which is why the base part - the card or the symbol - is the
 * only member allowed to contain the others.
 */
const MEMBER_SUFFIX = ["_Lbl", "_Val", "_Unit", "_Scale", "_Band", "_Trend", "_RUN", "_FLT"] as const;

function familyOf(name: string): { family: string; suffix: string } {
  for (const suffix of MEMBER_SUFFIX) {
    if (name.endsWith(suffix)) return { family: name.slice(0, -suffix.length), suffix };
  }
  return { family: name, suffix: "" };
}

/** The frame: drawn once, in the same place on every screen, and not the critic's business. */
const CHROME = /^(Ground|Hdr|HdrTitle|HdrLevel|Nav|NavChip|NavLbl|Foot|FootLbl|FootMark|AlarmBanner|AlarmsLbl)_/;
const isChrome = (p: Part) => CHROME.test(p.Name);

const TEXT_TYPES = new Set<Part["Type"]>(["TextBox", "NumericDisplay", "StringDisplay", "DateTimeDisplay"]);

/**
 * A pipe's box is a route between two symbols, not a shape that occupies it,
 * so it overlaps everything it connects by design. Excluded from the overlap
 * rule and from ink; its own correctness is the topology's business.
 */
const isRoute = (p: Part) => p.Type === "Pipe";

/* --- the critic -------------------------------------------------------- */

export interface GeometryReport {
  findings: Finding[];
  /** 1 (unusable) to 5 (nothing an engineer would change), from the findings. */
  score: number;
  /** What was measured, for the scoreboard. */
  metrics: {
    objects: number;
    inkFraction: number;
    quadrantRatio: number;
  };
}

/**
 * Review one screen's geometry against the pack.
 *
 * `behind` resolves what a part is drawn on: the innermost container that
 * holds it, else the ground. That is enough for our layouts, where a part is
 * either on a card or on the screen, and it is what makes a contrast number
 * mean anything.
 */
export function critiqueGeometry(screen: Screen, pack: StandardPack = DEFAULT_PACK): GeometryReport {
  const g = pack.rules.geometry;
  const view = screen.Children[0];
  const all = view.Children;
  const findings: Finding[] = [];
  const ground = tokenHex(pack, "ground");

  const boxes = new Map<string, Box>(all.map((p) => [p.UniqueId, boxOf(p)]));
  const box = (p: Part) => boxes.get(p.UniqueId)!;

  // A container is anything that holds another part entirely. The ground and
  // the cards qualify; so does a band a value sits in.
  const containers = all.filter((p) => all.some((q) => q !== p && holds(box(p), box(q))));
  const containerSet = new Set(containers.map((p) => p.UniqueId));

  /** The innermost container holding this part, by area. */
  function behind(part: Part): string {
    const holders = containers
      .filter((c) => c !== part && holds(box(c), box(part)))
      .sort((a, b) => areaOf(box(a)) - areaOf(box(b)));
    for (const h of holders) {
      const hex = hexOf(h, "Fill", pack);
      if (hex) return hex;
    }
    return ground;
  }

  const body = all.filter((p) => !isChrome(p));

  // --- geom.overlap ----------------------------------------------------
  // Two shapes that are not one inside the other, sharing pixels. The pair is
  // reported once, against the smaller of the two: that is the one in the
  // wrong place.
  const candidates = body.filter((p) => !isRoute(p));
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      const ba = box(a);
      const bb = box(b);
      if (holds(ba, bb) || holds(bb, ba)) continue;
      const fa = familyOf(a.Name);
      const fb = familyOf(b.Name);
      // Within one composite the base part is the card or the symbol; it may
      // sit under its own members. Any other pair inside a composite is as
      // much a defect as one across two.
      if (fa.family === fb.family && (fa.suffix === "" || fb.suffix === "")) continue;
      const o = overlapOf(ba, bb);
      if (o.width <= g.overlapTolerance || o.height <= g.overlapTolerance) continue;
      const smaller = areaOf(ba) <= areaOf(bb) ? a : b;
      const other = smaller === a ? b : a;
      findings.push({
        severity: "warning",
        rule: "geom.overlap",
        objectId: smaller.UniqueId,
        message: `${smaller.Name} overlaps ${other.Name} by ${Math.round(o.width)}x${Math.round(o.height)}px; one of them is unreadable.`,
        suggestion: `Move ${smaller.Name} clear of ${other.Name}, or make the row it sits in wider.`,
      });
    }
  }

  // --- geom.symbolInvisible --------------------------------------------
  // A symbol carries meaning by its shape, so it has to be seen. Our own
  // equipment fill is one step off the ground on purpose - that is the
  // standard - which means the outline is doing all the work, and an outline
  // under a pixel wide is not an outline. This is the defect the model found
  // as "the symbols are nearly invisible".
  for (const part of body) {
    if (part.Type !== "Path") continue;
    const on = behind(part);
    const fill = hexOf(part, "Fill", pack);
    const border = hexOf(part, "Border", pack);
    const fillSeen = fill ? contrastRatio(fill, on) >= g.contrastGraphic : false;
    const thickness = (part as { Thickness?: number }).Thickness ?? 0;
    const borderSeen = border ? contrastRatio(border, on) >= g.contrastGraphic && thickness >= g.minStroke : false;
    if (fillSeen || borderSeen) continue;
    findings.push({
      severity: "warning",
      rule: "geom.symbolInvisible",
      objectId: part.UniqueId,
      message:
        `${part.Name} cannot be made out: its fill is ${fill ?? "none"} on ${on} ` +
        `(${fill ? contrastRatio(fill, on).toFixed(2) : "0"}:1) and its outline is ${thickness}px of ${border ?? "none"}.`,
      suggestion: `Give it an outline at least ${g.minStroke}px wide in a colour ${g.contrastGraphic}:1 against its background.`,
    });
  }

  // --- geom.textContrast ------------------------------------------------
  // Text only. A card one step off the ground is the standard working as
  // intended, so shape contrast is left to the rule above, where an
  // invisible shape actually costs the operator something.
  for (const part of body) {
    if (!TEXT_TYPES.has(part.Type)) continue;
    const ink = hexOf(part, "TextColor", pack);
    if (!ink) continue;
    const on = hexOf(part, "Fill", pack) ?? behind(part);
    const ratio = contrastRatio(ink, on);
    if (ratio >= g.contrastText) continue;
    findings.push({
      severity: "warning",
      rule: "geom.textContrast",
      objectId: part.UniqueId,
      message: `${part.Name} is ${ink} on ${on}, a contrast of ${ratio.toFixed(2)}:1; the pack's floor for text is ${g.contrastText}:1.`,
      suggestion: "Use the ink token on a panel, or the onAlarm token on an alarm colour.",
    });
  }

  // --- geom.orphanLabel -------------------------------------------------
  // A label belongs to what it is nearest to. When a composite's label is
  // nearer to another composite than to its own, an operator reads it as
  // that one's - which is how a reading ends up attributed to the wrong pump.
  // A label is orphaned when something from another composite is strictly
  // nearer to it than its own. Measured against its own base part - which is
  // often the card it sits inside, and so at distance nothing can beat - and
  // never against a container that merely encloses it, or every label on a
  // screen would be read as belonging to the ground.
  const byName = new Map(body.map((p) => [p.Name, p]));
  for (const part of body) {
    if (part.Type !== "TextBox") continue;
    const { family, suffix } = familyOf(part.Name);
    if (suffix !== "_Lbl") continue;
    const own = byName.get(family);
    if (!own) continue;
    const here = box(part);
    const c = centreOf(here);
    const mine = distanceTo(box(own), c.x, c.y);
    let nearest: Part | undefined;
    let best = Infinity;
    for (const s of body) {
      if (TEXT_TYPES.has(s.Type) || isRoute(s)) continue;
      if (familyOf(s.Name).family === family) continue;
      if (holds(box(s), here)) continue;
      const d = distanceTo(box(s), c.x, c.y);
      if (d < best) {
        best = d;
        nearest = s;
      }
    }
    if (!nearest || best >= mine) continue;
    findings.push({
      severity: "warning",
      rule: "geom.orphanLabel",
      objectId: part.UniqueId,
      message: `${part.Name} is nearer to ${nearest.Name} (${Math.round(best)}px) than to ${family} (${Math.round(mine)}px): it reads as ${nearest.Name}'s label.`,
      suggestion: `Move ${part.Name} beside ${family}, or put more room between the two.`,
    });
  }

  // --- geom.alignment ---------------------------------------------------
  // Edges that nearly line up. A grid-snapped layout produces none of these,
  // which is the property worth having: the rule is silent until something
  // drifts off the grid by a few pixels, which is the difference between a
  // screen that looks made and one that looks typed.
  //
  // Shapes only. Text on a shared row is aligned by its baseline, not by its
  // box, so a 12pt caption beside a 13pt title sits a pixel lower on purpose -
  // that is typography, and a rule that reads box tops would call every
  // well-set row a defect. Cards count: a column of cards that nearly lines up
  // is exactly what this is for.
  for (const edge of ["left", "top"] as const) {
    const values = body
      .filter((p) => !isRoute(p) && !TEXT_TYPES.has(p.Type))
      .map((p) => ({ part: p, value: box(p)[edge] }))
      .sort((a, b) => a.value - b.value);
    let cluster: typeof values = [];
    const flush = () => {
      const distinct = new Set(cluster.map((c) => c.value));
      if (cluster.length >= 3 && distinct.size > 1) {
        const names = cluster.map((c) => c.part.Name).join(", ");
        findings.push({
          severity: "info",
          rule: "geom.alignment",
          objectId: cluster[0].part.UniqueId,
          message: `${cluster.length} objects nearly share a ${edge} edge (${[...distinct].join(", ")}): ${names}.`,
          suggestion: `Put them all on the same ${edge}, or move them far enough apart that they are not read as a column.`,
        });
      }
      cluster = [];
    };
    for (const v of values) {
      if (cluster.length && v.value - cluster[cluster.length - 1].value > g.alignmentSlop) flush();
      cluster.push(v);
    }
    flush();
  }

  // --- geom.balance and geom.crowding -----------------------------------
  // Ink is the area a part covers, counted once per part; a container is not
  // ink, because what is inside it is what the eye sees.
  const inked = body.filter((p) => !isRoute(p) && !containerSet.has(p.UniqueId));
  const screenBox = rootBox(view);
  const region: Box = { left: 0, top: 0, right: screenBox.width, bottom: screenBox.height };
  const mid = centreOf(region);
  const quadrants: Box[] = [
    { left: region.left, top: region.top, right: mid.x, bottom: mid.y },
    { left: mid.x, top: region.top, right: region.right, bottom: mid.y },
    { left: region.left, top: mid.y, right: mid.x, bottom: region.bottom },
    { left: mid.x, top: mid.y, right: region.right, bottom: region.bottom },
  ];
  const inkIn = (q: Box) =>
    inked.reduce((sum, p) => {
      const o = overlapOf(q, box(p));
      return sum + Math.max(0, o.width) * Math.max(0, o.height);
    }, 0);
  const fractions = quadrants.map((q) => inkIn(q) / Math.max(1, areaOf(q)));
  const highest = Math.max(...fractions);
  const lowest = Math.min(...fractions);
  const ratio = lowest > 0 ? highest / lowest : highest > 0 ? Infinity : 1;
  // A quiet screen is allowed to be empty; a busy one is not allowed to be
  // busy in one corner only. The floor on the densest quadrant is what keeps
  // this rule off a screen that simply has little on it.
  if (highest > 0.15 && ratio > g.quadrantRatio) {
    findings.push({
      severity: "info",
      rule: "geom.balance",
      objectId: undefined,
      message: `${screen.Name} is lopsided: the busiest quarter is ${(highest * 100).toFixed(0)}% covered and the emptiest ${(lowest * 100).toFixed(0)}%.`,
      suggestion: "Spread the content over the body, or move some of it to another screen.",
    });
  }
  const inkFraction = inkIn(region) / Math.max(1, areaOf(region));
  if (inkFraction > 0.75) {
    findings.push({
      severity: "warning",
      rule: "geom.crowding",
      message: `${screen.Name} is ${(inkFraction * 100).toFixed(0)}% covered; there is no room left to read it.`,
      suggestion: "Split it by unit, or move detail to a faceplate.",
    });
  }

  return {
    findings,
    score: scoreOf(findings),
    metrics: { objects: all.length, inkFraction, quadrantRatio: ratio },
  };
}

/**
 * Five when there is nothing to change, one when the screen is unusable. A
 * warning is a defect an operator would meet; information is a thing an
 * engineer would tidy. The weights are chosen so that one real defect costs a
 * point and a tidy-up costs a quarter of one - the same shape of judgement the
 * model was making, made repeatable.
 */
export function scoreOf(findings: Finding[]): number {
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const infos = findings.filter((f) => f.severity === "info").length;
  const penalty = warnings + infos * 0.25;
  return Math.max(1, Math.min(5, Math.round((5 - penalty) * 10) / 10));
}

/** Every screen of a project, with the worst score first. */
export function critiqueScreens(
  screens: Screen[],
  pack: StandardPack = DEFAULT_PACK,
): { screen: string; report: GeometryReport }[] {
  return screens
    .map((screen) => ({ screen: screen.Name, report: critiqueGeometry(screen, pack) }))
    .sort((a, b) => a.report.score - b.report.score);
}
