/**
 * Laying out an HMI *application*, not a screen.
 *
 * ISA-101 describes a display hierarchy - a plant overview above unit overviews
 * above detail displays - and it is specific about what makes the set usable:
 * navigation and the alarm banner sit in the same place on every screen, colour
 * is a signal rather than decoration, and consistency is what lets an operator
 * find something without reading. So the unit of work here is the whole set:
 * every screen gets the same header band, the same navigation strip listing
 * every screen in the project, and the same alarm banner position.
 *
 * Everything is built from the six parts the packager can emit. There is no
 * button part in Screen.dat, so a navigation chip is a Rectangle with a TextBox
 * on it - which is what a hand-built OTE screen uses too.
 *
 * Names are made unique across the whole application, not per screen, because
 * the binding graph resolves a target by name and a duplicate would wire the
 * wrong object.
 */

import {
  alarmLamp,
  alarmSummary,
  lamp,
  numericDisplay,
  pathPart,
  rectangle,
  screenOf,
  textBox,
  type Box,
} from "./parts";
import { DARK_GREY, GREY } from "./palette";
import { DEFAULT_PACK } from "../standard/pack";
import { expandComposite, type CompositeKind } from "../composites";
import { rangeFor, unitOf, type Range } from "../plant/units";
import type { CompositeInstance } from "@/store/types";

/** The Standard in force: a grey ground, lighter panels, colour only for alarms. */
const T = DEFAULT_PACK.tokens;
import type { Wire } from "./bindings";
import type { Part, Screen } from "./schema";

/** One equipment unit, in the shape lib/ai/infer.ts produces. */
export interface LayoutUnit {
  id: string;
  kind: string;
  label: string;
  roles: { tag: string; role: string; dataType: string; comment: string }[];
  /**
   * The shipped graphic object for this kind of equipment, when the machine
   * running the layout has the library indexed.
   *
   * Not `symbol`, which on an InferredEquipment is the *hint* - the string
   * "Pumps/Pump01" naming which object to look for. This is the geometry that
   * hint resolved to, and confusing the two is a mistake the compiler should
   * catch rather than a comment.
   *
   * Passed in as geometry rather than looked up here: lib/ote/symbols.ts reads
   * the index off disk and this module is imported by the browser too. Absent
   * everywhere the library is not installed, and a faceplate without one is the
   * same faceplate with no picture on it.
   */
  graphic?: { Commands: string; Points: string };
  /** The Plant Model's range per reading tag, when the model has one. */
  ranges?: Record<string, Range>;
}

export interface ScreenSpec {
  screenName: string;
  title: string;
  /** 1 plant overview, 2 unit overview, 3 unit detail. ISA-101's levels. */
  level: 1 | 2 | 3;
  /** Equipment ids, in the order they should appear. */
  include: string[];
  sections: ("status" | "process" | "alarms")[];
}

export interface LaidOutScreen {
  screen: Screen;
  parts: Part[];
  wires: Wire[];
  /** Composite instances among the parts, for the store to adopt. */
  composites: CompositeInstance[];
  /** What the compiler had to give up to fit, for the build log. */
  notes?: string[];
}

/* --- the fixed zones, in screen units -------------------------------- */

export const HEADER = 44;
export const NAV = 32;
export const FOOTER = 28;
export const MARGIN = 12;
export const GAP = 16;

/** Level 2 and 3: three cards across, two rows down. */
const CARD = { width: 320, height: 162, columns: 3 };
/** Level 1: four tiles across, three rows down. Status only, no readings. */
const TILE = { width: 238, height: 100, columns: 4 };

/**
 * The fixed zones, exported so lib/ote/regions.ts can name them for the
 * conversation: an op says "in the header" or "below o12" and the region
 * geometry here turns that into a box. One source of truth for both.
 */
export const ZONES = { HEADER, NAV, FOOTER, MARGIN, GAP, CARD, TILE } as const;
/** A faceplate's symbol, big enough to recognise across a control room. */
const SYMBOL = 52;
/** A tile's, which has a third of the room. */
const TILE_SYMBOL = 26;

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Only what a person reads as a number belongs in a numeric display. */
const isReading = (dataType: string) => dataType !== "BOOL" && dataType !== "STRING";

/**
 * One placer per application, so names stay unique across every screen and
 * every wire remembers the screen its object is on.
 */
export class Placer {
  private taken = new Set<string>();
  parts: Part[] = [];
  wires: Wire[] = [];
  composites: CompositeInstance[] = [];

  /** Fresh part list per screen; the name set carries across all of them. */
  begin() {
    this.parts = [];
    this.wires = [];
    this.composites = [];
  }

  /** Expand a composite here: its parts are placed, its wires kept, its instance recorded. */
  composite(kind: CompositeKind, props: Record<string, unknown>, box: Box, name: string): CompositeInstance {
    const stem = this.unique(name);
    const { parts, wires } = expandComposite(kind, props, box, stem);
    for (const part of parts) this.add(part);
    for (const w of wires) {
      const part = parts[w.index];
      if (part) this.wires.push({ part, tag: w.tag, property: w.property });
    }
    const instance: CompositeInstance = {
      id: crypto.randomUUID(),
      kind,
      name: stem,
      props,
      screenId: "",
      partIds: parts.map((p) => p.UniqueId),
    };
    this.composites.push(instance);
    return instance;
  }

  private unique(wanted: string): string {
    const safe = wanted.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "N$1");
    if (!this.taken.has(safe)) {
      this.taken.add(safe);
      return safe;
    }
    for (let n = 2; ; n++) {
      const candidate = `${safe}_${n}`;
      if (!this.taken.has(candidate)) {
        this.taken.add(candidate);
        return candidate;
      }
    }
  }

  /** Renames the part before placing it, then records the wire if there is one. */
  add(part: Part, tag?: string): Part {
    part.Name = this.unique(part.Name);
    this.parts.push(part);
    if (tag) this.wires.push({ part, tag, property: "CurrentValue" });
    return part;
  }
}

/* --- the chrome every screen shares ---------------------------------- */

export function chrome(
  place: Placer,
  spec: ScreenSpec,
  all: ScreenSpec[],
  panel: { width: number; height: number },
) {
  const key = spec.screenName;

  // The ground. Medium grey, the whole panel, before anything else: on a
  // high-performance screen the background is the quietest thing there is,
  // and every alarm colour is read against it.
  place.add(rectangle(`Ground_${key}`, { left: 0, top: 0, width: panel.width, height: panel.height }, { fill: T.ground, border: T.ground }));

  // Header band. A lighter panel with the title in ink. It used to be brand
  // green, "the one place colour is decoration" - and that is exactly the
  // exception a high-performance screen does not make.
  place.add(rectangle(`Hdr_${key}`, { left: 0, top: 0, width: panel.width, height: HEADER }, { fill: T.panel, border: T.line }));
  place.add(
    textBox(`HdrTitle_${key}`, spec.title, { left: MARGIN + 4, top: 10, width: 620, height: 26 }, { size: 18, colour: T.ink, bold: true }),
  );
  place.add(
    textBox(
      `HdrLevel_${key}`,
      `LEVEL ${spec.level} · ${spec.level === 1 ? "PLANT OVERVIEW" : spec.level === 2 ? "UNIT OVERVIEW" : "UNIT DETAIL"}`,
      { left: panel.width - 320, top: 13, width: 300, height: 20 },
      { size: 12, colour: T.muted },
    ),
  );

  // Navigation strip: every screen in the application, in the same order and
  // the same place on all of them. The one you are on is filled.
  place.add(rectangle(`Nav_${key}`, { left: 0, top: HEADER, width: panel.width, height: NAV }, { fill: T.ground, border: T.line }));
  const chipWidth = Math.min(150, Math.floor((panel.width - MARGIN * 2) / Math.max(all.length, 1)) - 6);
  all.forEach((other, i) => {
    const here = other.screenName === spec.screenName;
    const left = MARGIN + i * (chipWidth + 6);
    if (left + chipWidth > panel.width - MARGIN) return; // more screens than fit
    place.add(
      rectangle(`NavChip_${key}_${i}`, { left, top: HEADER + 4, width: chipWidth, height: NAV - 8 },
        { fill: here ? T.white : T.panel, border: here ? T.ink : T.line }),
    );
    place.add(
      textBox(`NavLbl_${key}_${i}`, other.screenName, { left: left + 8, top: HEADER + 8, width: chipWidth - 16, height: 16 },
        { size: 12, colour: T.ink }),
    );
  });

  // Footer: what you are looking at, and where it came from.
  const footTop = panel.height - FOOTER;
  place.add(rectangle(`Foot_${key}`, { left: 0, top: footTop, width: panel.width, height: FOOTER }, { fill: T.panel, border: T.line }));
  place.add(
    textBox(`FootLbl_${key}`, `${spec.screenName} — ${spec.include.length} unit${spec.include.length === 1 ? "" : "s"}`,
      { left: MARGIN + 4, top: footTop + 6, width: 500, height: 16 }, { size: 12, colour: T.muted }),
  );
  place.add(
    textBox(`FootMark_${key}`, "Generated by HMI Copilot", { left: panel.width - 260, top: footTop + 6, width: 240, height: 16 },
      { size: 12, colour: T.muted }),
  );
}

/**
 * Rebuilds the navigation strip on every screen that has one so it lists
 * every screen in the application, in order, with the current one filled.
 *
 * An extension lays out new screens whose strips list everything, but the
 * screens that already existed still list only the set they were born with.
 * Nothing else on any screen is touched: the chips are removed and re-added
 * at the same place in the tree, and any screen without a generated strip is
 * left exactly as it is.
 */
export function refreshNavigation(
  screens: Screen[],
  panel: { width: number; height: number },
): { screens: Screen[]; changed: boolean } {
  const isChip = (name: string) => /^NavChip_|^NavLbl_/.test(name);
  const chipWidth = Math.min(150, Math.floor((panel.width - MARGIN * 2) / Math.max(screens.length, 1)) - 6);
  let changed = false;

  const out = screens.map((screen) => {
    const view = screen.Children[0];
    const stripAt = view.Children.findIndex(
      (p) => p.Type === "Rectangle" && p.Name.startsWith("Nav_") && p.Location.Top === HEADER,
    );
    if (stripAt === -1) return screen;

    const key = screen.Name.replace(/[^A-Za-z0-9_]/g, "_");
    const chips: Part[] = [];
    screens.forEach((other, i) => {
      const here = other.UniqueId === screen.UniqueId;
      const left = MARGIN + i * (chipWidth + 6);
      if (left + chipWidth > panel.width - MARGIN) return;
      chips.push(
        rectangle(`NavChip_${key}_${i}`, { left, top: HEADER + 4, width: chipWidth, height: NAV - 8 },
          { fill: here ? T.white : T.panel, border: here ? T.ink : T.line }),
        textBox(`NavLbl_${key}_${i}`, other.Name, { left: left + 8, top: HEADER + 8, width: chipWidth - 16, height: 16 },
          { size: 12, colour: T.ink }),
      );
    });

    const kept = view.Children.filter((p) => !isChip(p.Name));
    const before = view.Children.filter((p) => isChip(p.Name)).map((p) => p.Type === "TextBox" ? p.Text : p.Name);
    const after = chips.map((p) => p.Type === "TextBox" ? p.Text : p.Name);
    if (JSON.stringify(before) === JSON.stringify(after)) return screen;

    changed = true;
    const at = kept.findIndex((p) => p.UniqueId === view.Children[stripAt].UniqueId) + 1;
    const children = [...kept.slice(0, at), ...chips, ...kept.slice(at)];
    const next: Screen = { ...screen, Children: [{ ...view, Children: children }] };
    return next;
  });

  return { screens: out, changed };
}

/* --- the content ------------------------------------------------------ */

/** One faceplate's worth of parts, and what drives each of them. */
export interface BuiltCard {
  parts: Part[];
  wires: { part: Part; tag: string; property: string }[];
}

/** The size a faceplate wants. Exported so a caller can find room for one. */
export const CARD_SIZE = { width: CARD.width, height: CARD.height };

/**
 * A unit faceplate, standalone: what it is, whether it is running, what it is
 * reading.
 *
 * Exported because the conversation needs it. Asked to "show both boilers", a
 * model with only rectangles and lamps to work with builds a faceplate out of
 * five primitives and gets the arithmetic wrong - the container lands in one
 * place, the label in another, the lamps somewhere else again. The product
 * already knows how to lay a unit out; the chat reaches the same code rather
 * than reinventing it one rectangle at a time.
 */
export function equipmentCard(unit: LayoutUnit, box: Box): BuiltCard {
  const built: BuiltCard = { parts: [], wires: [] };
  const place = {
    add(part: Part, tag?: string) {
      built.parts.push(part);
      if (tag) built.wires.push({ part, tag, property: "CurrentValue" });
      return part;
    },
  };
  drawCard(place, unit, box);
  return built;
}

/** What `add` has to provide, so the Placer and the standalone builder share it. */
interface Adds {
  add(part: Part, tag?: string): Part;
}

function card(place: Placer, unit: LayoutUnit, box: Box) {
  drawCard(place, unit, box);
}

function drawCard(place: Adds, unit: LayoutUnit, box: Box) {
  const key = unit.id.replace(/[^A-Za-z0-9]/g, "");
  const { left: x, top: y } = box;

  place.add(rectangle(`Card_${key}`, box, { fill: T.panel, border: T.line }));

  /**
   * The product's own drawing of this machine, at the top right of its card.
   *
   * It is a real Path part with the geometry out of the installation's .path
   * file - the same object an engineer would drag off the library palette, not
   * a picture of one - so it exports into the .eote like anything else. When
   * the library is not indexed there is no symbol, the kind is spelled out in
   * words instead, and the lamps take the width back.
   */
  const symbolSize = unit.graphic ? SYMBOL : 0;
  if (unit.graphic) {
    place.add(
      pathPart(
        `Sym_${key}`,
        unit.graphic,
        { left: x + box.width - symbolSize - 12, top: y + 8, width: symbolSize, height: symbolSize },
        { fill: GREY, border: DARK_GREY },
      ),
    );
  } else {
    place.add(
      textBox(`CardKind_${key}`, unit.kind.toUpperCase(), { left: x + box.width - 96, top: y + 9, width: 84, height: 18 }, { size: 12, colour: T.muted }),
    );
  }

  place.add(
    textBox(
      `CardName_${key}`,
      unit.label,
      { left: x + 12, top: y + 8, width: box.width - (symbolSize || 96) - 26, height: 20 },
      { size: 13, bold: true },
    ),
  );

  const run = unit.roles.find((r) => r.role === "running");
  const fault = unit.roles.find((r) => r.role === "fault");
  const lampsTop = y + 34;
  // The symbol occupies the top right down to y+8+SYMBOL, which the lamps row
  // runs through - so they give up its width rather than run under it.
  const lampsWidth = box.width - 24 - symbolSize - (symbolSize ? 12 : 0);
  const halfWidth = Math.floor((lampsWidth - 8) / 2);

  if (run) {
    place.add(
      lamp(`Lamp_${key}_RUN`, "STOPPED", "RUNNING", { left: x + 12, top: lampsTop, width: fault ? halfWidth : lampsWidth, height: 44 }),
      run.tag,
    );
  }
  if (fault) {
    place.add(
      alarmLamp(`Lamp_${key}_FLT`, "NO FAULT", "FAULT", {
        left: run ? x + 12 + halfWidth + 8 : x + 12,
        top: lampsTop,
        width: run ? halfWidth : lampsWidth,
        height: 44,
      }),
      fault.tag,
    );
  }

  // A reading is an analogue indicator - scale, normal band, value, unit -
  // not a number in a box. One fits under the lamps, two on a card without
  // them; a unit with more earns a detail screen, which is what the plan is
  // for. The range and the normal band are the class defaults until the tag
  // export or the engineer says otherwise, and the inspector shows them.
  const readings = unit.roles.filter((r) => isReading(r.dataType)).slice(0, run || fault ? 1 : 2);
  if ("composite" in place) {
    readings.forEach((role, i) => {
      const rowTop = y + (run || fault ? 86 : 40) + i * 60;
      const tag = role.tag.replace(/[^A-Za-z0-9]/g, "");
      const range = unit.ranges?.[role.tag] ?? rangeFor(role.comment, role.role);
      (place as Placer).composite(
        "AnalogIndicator",
        { label: titleCase(role.role), tag: role.tag, units: range.units, min: range.min, max: range.max, normalLow: range.normalLow, normalHigh: range.normalHigh, decimals: 1 },
        { left: x + 12, top: rowTop, width: box.width - 24, height: 56 },
        `Ind_${tag}`,
      );
    });
    return;
  }
  readings.forEach((role, i) => {
    const rowTop = y + (run || fault ? 86 : 40) + i * 34;
    const tag = role.tag.replace(/[^A-Za-z0-9]/g, "");
    place.add(
      textBox(`Lbl_${tag}`, titleCase(role.role), { left: x + 12, top: rowTop + 6, width: 104, height: 20 }, { size: 12 }),
    );
    place.add(
      numericDisplay(`Num_${tag}`, { left: x + 120, top: rowTop, width: 124, height: 30 }),
      role.tag,
    );
    const unitLabel = unitOf(role.comment, role.role);
    if (unitLabel) {
      place.add(
        textBox(`Unit_${tag}`, unitLabel, { left: x + 250, top: rowTop + 6, width: box.width - 262, height: 20 }, { size: 12, colour: T.muted }),
      );
    }
  });
}

/** A plant-overview tile: the unit's name and one state. Deviation only. */
function tile(place: Placer, unit: LayoutUnit, box: Box) {
  const key = unit.id.replace(/[^A-Za-z0-9]/g, "");
  const { left: x, top: y } = box;

  place.add(rectangle(`Tile_${key}`, box, { fill: T.panel, border: T.line }));

  const symbolSize = unit.graphic ? TILE_SYMBOL : 0;
  if (unit.graphic) {
    place.add(
      pathPart(
        `TileSym_${key}`,
        unit.graphic,
        { left: x + box.width - symbolSize - 10, top: y + 6, width: symbolSize, height: symbolSize },
        { fill: GREY, border: DARK_GREY },
      ),
    );
  }

  place.add(
    textBox(
      `TileName_${key}`,
      unit.label,
      { left: x + 10, top: y + 8, width: box.width - 20 - (symbolSize ? symbolSize + 8 : 0), height: 18 },
      { size: 12, bold: true },
    ),
  );

  const fault = unit.roles.find((r) => r.role === "fault");
  const run = unit.roles.find((r) => r.role === "running");
  const reading = unit.roles.find((r) => isReading(r.dataType));

  // A Level 1 tile shows the one thing that would make an operator look
  // closer: a fault if there is one, otherwise running state, otherwise the
  // headline reading.
  if (fault) {
    place.add(alarmLamp(`Tile_${key}_FLT`, "OK", "FAULT", { left: x + 10, top: y + 30, width: box.width - 20, height: 30 }), fault.tag);
  } else if (run) {
    place.add(lamp(`Tile_${key}_RUN`, "STOPPED", "RUNNING", { left: x + 10, top: y + 30, width: box.width - 20, height: 30 }), run.tag);
  } else if (reading) {
    place.add(numericDisplay(`Tile_${key}_VAL`, { left: x + 10, top: y + 30, width: box.width - 20, height: 30 }), reading.tag);
  }

  if (reading && (fault || run)) {
    const tag = reading.tag.replace(/[^A-Za-z0-9]/g, "");
    place.add(
      textBox(`TileLbl_${tag}`, titleCase(reading.role), { left: x + 10, top: y + 66, width: 96, height: 18 }, { size: 12, colour: T.muted }),
    );
    place.add(numericDisplay(`TileNum_${tag}`, { left: x + 108, top: y + 64, width: box.width - 118, height: 24 }), reading.tag);
  }
}

/* --- the application -------------------------------------------------- */

export function layoutApplication(
  specs: ScreenSpec[],
  equipment: LayoutUnit[],
  panel: { width: number; height: number },
  /**
   * Every screen the navigation strip should list, when the application
   * already has some. Defaults to the screens being laid out.
   */
  navigation: ScreenSpec[] = specs,
): LaidOutScreen[] {
  const place = new Placer();
  const byId = new Map(equipment.map((e) => [e.id, e]));

  return specs.map((spec) => {
    place.begin();
    chrome(place, spec, navigation, panel);

    const wantsAlarms = spec.sections.includes("alarms");
    const contentTop = HEADER + NAV + 8;
    const footerTop = panel.height - FOOTER;
    // The alarm banner sits in the same place on every screen that has one, so
    // an operator's eye does not have to search for it after a screen change.
    const alarmTop = footerTop - 148;
    const contentBottom = (wantsAlarms ? alarmTop : footerTop) - 8;

    const units = spec.include
      .map((id) => byId.get(id))
      .filter((u): u is LayoutUnit => Boolean(u));

    const box = spec.level === 1 ? TILE : CARD;
    const rows = Math.max(1, Math.floor((contentBottom - contentTop + GAP) / (box.height + GAP)));
    const capacity = rows * box.columns;

    units.slice(0, capacity).forEach((unit, i) => {
      const column = i % box.columns;
      const row = Math.floor(i / box.columns);
      const at: Box = {
        left: MARGIN + column * (box.width + GAP),
        top: contentTop + row * (box.height + GAP),
        width: box.width,
        height: box.height,
      };
      if (spec.level === 1) tile(place, unit, at);
      else card(place, unit, at);
    });

    if (units.length === 0) {
      place.add(
        textBox(`Empty_${spec.screenName}`, "No equipment on this screen yet.",
          { left: MARGIN, top: contentTop + 8, width: 400, height: 24 }, { size: 13, colour: T.muted }),
      );
    }

    if (wantsAlarms) {
      place.add(
        textBox(`AlarmsLbl_${spec.screenName}`, "ACTIVE ALARMS",
          { left: MARGIN, top: alarmTop, width: 300, height: 20 }, { size: 12, colour: T.muted }),
      );
      place.add(
        alarmSummary(`AlarmBanner_${spec.screenName}`, {
          left: MARGIN,
          top: alarmTop + 24,
          width: panel.width - MARGIN * 2,
          height: footerTop - alarmTop - 32,
        }),
      );
    }

    const screen = screenOf(spec.screenName, place.parts, panel);
    // Every wire now knows its screen, which is what keeps a Target's ScreenId
    // right in an application with more than one.
    const wires = place.wires.map((w) => ({ ...w, screenId: screen.UniqueId }));
    return {
      screen,
      parts: place.parts,
      wires,
      composites: place.composites.map((c) => ({ ...c, screenId: screen.UniqueId })),
    };
  });
}
