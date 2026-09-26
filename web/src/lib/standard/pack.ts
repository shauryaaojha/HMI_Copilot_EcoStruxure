/**
 * The Standard pack: what a good screen looks like, as data.
 *
 * docs/ARCHITECTURE_SCREEN_QUALITY.md §3.2. A pack is tokens (which palette
 * index plays which role) and rules (what the lint refuses). The generator
 * reads the tokens, the lint reads the rules, and the model's cached context
 * reads both - so there is one statement of the standard, and it is
 * enforced rather than requested.
 *
 * Every colour is an index into the project's own colour set, never a hex
 * value, because that is the only kind of colour the product's file can
 * hold (lib/ote/palette.ts). The default pack is ISA-101 as the Hollifield
 * handbook and the vendor style guides apply it: a grey ground, lighter
 * panels, equipment in outline, and saturated colour reserved for alarm
 * priority and abnormal state.
 */

import { z } from "zod";
import { COLOR_SETS, DEFAULT_COLOR_SET, resolveColor } from "@/lib/ote/palette";

const index = z.number().int().min(1).max(60);

export const Tokens = z.object({
  /** The screen's background. Medium grey: nothing on it competes with an alarm. */
  ground: index,
  /** Cards, bands and faceplates: a step lighter than the ground. */
  panel: index,
  /** Borders and separators. */
  line: index,
  /** Text. */
  ink: index,
  /** Secondary text: units, captions, footers. */
  muted: index,
  /** Value fields and the running-state face. */
  white: index,
  /** A symbol or a lamp at rest. */
  equipmentFill: index,
  equipmentLine: index,
  /** Running or open is an outline change, never a fill. */
  runningLine: index,
  /** Alarm priority 1 to 4, ISA-18.2 order: highest first. */
  alarmP1: index,
  alarmP2: index,
  alarmP3: index,
  alarmP4: index,
  /** Text on an alarm-coloured face. */
  onAlarm: index,
  /** A pressed or latched control: inverted, not coloured. */
  pressedFill: index,
  pressedInk: index,
});
export type Tokens = z.infer<typeof Tokens>;

export const Rules = z.object({
  /** Everything sits on this grid; the product's own template rule is 8. */
  grid: z.number().int().positive(),
  /** Smallest readable size by where the panel is. */
  fontMin: z.object({ touch: z.number().positive(), controlRoom: z.number().positive() }),
  /** Which floor applies to this project. */
  viewing: z.enum(["touch", "controlRoom"]),
  /** Every measured value shows its engineering unit. */
  unitsAlways: z.boolean(),
  density: z.object({
    /** Live values (displays, lamps, scales, trends) per screen before it is a wall. */
    valuesPerScreen: z.number().int().positive(),
  }),
  /**
   * Thresholds the geometric critic measures against. docs/PLAN_PHASE4.md §3.
   * They live here, with the rest of the standard, because a customer pack
   * changes what "readable" means as surely as it changes the colours.
   */
  geometry: z.object({
    /** Contrast ratio floor for a drawn shape against what is behind it. */
    contrastGraphic: z.number().positive(),
    /** Contrast ratio floor for text. Higher: a glyph is thinner than a fill. */
    contrastText: z.number().positive(),
    /** Intersection, in pixels on both axes, before two boxes count as overlapping. */
    overlapTolerance: z.number().nonnegative(),
    /** Two edges this close without being equal read as a mistake, not a choice. */
    alignmentSlop: z.number().nonnegative(),
    /** Densest quadrant over sparsest, before a screen is lopsided. */
    quadrantRatio: z.number().positive(),
    /** An outline thinner than this on screen is not an outline. */
    minStroke: z.number().positive(),
  }),
});
export type Rules = z.infer<typeof Rules>;

export const StandardPack = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  /** What it is based on, for the engineer and the report. */
  basis: z.string(),
  colorSet: z.number().int(),
  tokens: Tokens,
  rules: Rules,
});
export type StandardPack = z.infer<typeof StandardPack>;

/**
 * ISA-101 on the product's "Green-Simple" colour set. The indices are the
 * greys that set actually holds - there is no #c8c8c8 in it, so the ground
 * is its #d9d9d9 and the panels its #f1f1f1 - and the four alarm colours are
 * its darkest red, its dark amber, its yellow and its purple, which is the
 * handbook's order.
 */
export const ISA101: StandardPack = {
  id: "isa101-v1",
  name: "ISA-101 high-performance",
  version: "1",
  basis: "ANSI/ISA-101.01-2015 and the High Performance HMI Handbook (Hollifield et al.), on colour set 4",
  colorSet: DEFAULT_COLOR_SET,
  tokens: {
    ground: 11, // #d9d9d9
    panel: 2, // #f1f1f1
    line: 22, // #515151
    ink: 1, // #030303
    muted: 52, // #474747
    white: 21, // #ffffff
    equipmentFill: 2,
    equipmentLine: 22,
    runningLine: 12, // #303030
    alarmP1: 55, // #971a24
    alarmP2: 44, // #cf7c00
    alarmP3: 18, // #ffff58
    alarmP4: 50, // #826db7
    onAlarm: 21,
    pressedFill: 12,
    pressedInk: 21,
  },
  rules: {
    grid: 8,
    fontMin: { touch: 12, controlRoom: 11 },
    viewing: "touch",
    unitsAlways: true,
    density: { valuesPerScreen: 40 },
    geometry: {
      // 3:1 and 4.5:1 are the WCAG 2.1 floors for graphics and body text. ISA-101
      // states the principle - an operator must read the screen at a glance, in
      // a lit control room - without giving a number, so the accessibility
      // numbers stand in, and they are the ones a customer pack would override.
      contrastGraphic: 3,
      contrastText: 4.5,
      overlapTolerance: 2,
      alignmentSlop: 4,
      quadrantRatio: 4,
      minStroke: 1,
    },
  },
};

/** The pack in force. One for now; a customer pack is a second document. */
export const DEFAULT_PACK = ISA101;

/** Indices a normal, quiet screen may use anywhere. */
export function neutralSet(pack: StandardPack): Set<number> {
  const t = pack.tokens;
  return new Set([t.ground, t.panel, t.line, t.ink, t.muted, t.white, t.equipmentFill, t.equipmentLine, t.runningLine, t.pressedFill, t.pressedInk]);
}

/** Indices that mean something is wrong or abnormal, allowed only on such a face. */
export function signalSet(pack: StandardPack): Set<number> {
  const t = pack.tokens;
  return new Set([t.alarmP1, t.alarmP2, t.alarmP3, t.alarmP4]);
}

export const tokenHex = (pack: StandardPack, role: keyof Tokens) =>
  resolveColor(pack.tokens[role], "#000000", pack.colorSet as keyof typeof COLOR_SETS);

/** The font floor the pack applies to this project. */
export const fontFloor = (pack: StandardPack) => pack.rules.fontMin[pack.rules.viewing];
