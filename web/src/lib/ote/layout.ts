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
  screenSwitch,
  stringDisplay,
  switchPart,
  textBox,
  toggleSwitch,
  trendGraph,
  type Box,
} from "./parts";
import { DARK_GREY, GREY } from "./palette";
import { DEFAULT_PACK } from "../standard/pack";
import { expandComposite, type CompositeKind } from "../composites";
import { rangeFor, unitOf, type Range } from "../plant/units";
import { orderReadings } from "../plant/classes";
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
  /**
   * Tags the engineer asked to see, in the order they asked. Each unit's
   * readings lead with these, ahead of what its class leads with. Absent when
   * the request named none.
   */
  readings?: string[];
}

export interface LaidOutScreen {
  screen: Screen;
  parts: Part[];
  /**
   * Each part's stable key, by UniqueId: the name the compiler asked for,
   * before the Placer made it unique across the application. "Title" on the
   * third screen is named Title_3 but keyed Title, so a regeneration of that
   * screen alone finds it again. lib/program/regenerate.ts matches on this.
   */
  keys?: Record<string, string>;
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

/** Level 2: three cards across on a 1024-wide panel. */
const CARD = { width: 320, height: 162, columns: 3 };
/** Level 1: four tiles across on a 1024-wide panel. Status only, no readings. */
const TILE = { width: 238, height: 100, columns: 4 };
/** Level 3: one unit's detail, two across on a 1024-wide panel. */
const DETAIL = { width: 496, height: 0, columns: 2 };

/** The alarm banner's share of the body, when a screen has one. */
const ALARM_BAND = 148;

/**
 * The grid a level lays out on, measured against the panel it is for.
 *
 * The column counts above are what fits 1024 across. On an 800-wide panel three
 * 320 cards are 1016 wide and the third ran off the edge; on a 320-wide one a
 * card was wider than the screen. The box keeps its design size while it fits
 * and narrows to the panel when it does not; the column count is what fits.
 */
export function gridFor(
  level: 1 | 2 | 3,
  panel: { width: number; height: number },
  wantsAlarms: boolean,
  /** Where the body starts, when something (a KPI band) sits above the grid. */
  from = HEADER + NAV + 8,
): { width: number; height: number; columns: number; rows: number; capacity: number; top: number; bottom: number } {
  const top = from;
  const footerTop = panel.height - FOOTER;
  const bottom = (wantsAlarms ? footerTop - ALARM_BAND : footerTop) - 8;
  const usable = panel.width - MARGIN * 2;
  const design = level === 1 ? TILE : level === 3 ? DETAIL : CARD;
  const width = Math.min(design.width, usable);
  const columns = Math.max(1, Math.min(design.columns, Math.floor((usable + GAP) / (width + GAP))));
  // A detail panel takes the whole body height: one row of them.
  const height = level === 3 ? Math.max(CARD.height, bottom - top) : design.height;
  const rows = level === 3 ? 1 : Math.max(1, Math.floor((bottom - top + GAP) / (height + GAP)));
  return { width, height, columns, rows, capacity: rows * columns, top, bottom };
}

/**
 * How many units one screen of this level holds on this panel: the smaller of
 * what ISA-101 allows and what physically fits. The planner splits by this,
 * so a unit is never laid out past the bottom of the panel and dropped.
 */
export function capacityOf(
  level: 1 | 2 | 3,
  panel: { width: number; height: number },
  wantsAlarms = true,
): number {
  const rule = level === 1 ? 12 : level === 3 ? 2 : 6;
  return Math.max(1, Math.min(rule, gridFor(level, panel, wantsAlarms).capacity));
}

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
  /** UniqueId -> stable key for this screen's parts (see LaidOutScreen.keys). */
  keys: Record<string, string> = {};
  private keyCount = new Map<string, number>();

  /** Fresh part list per screen; the name set carries across all of them. */
  begin() {
    this.parts = [];
    this.wires = [];
    this.composites = [];
    this.keys = {};
    this.keyCount = new Map();
  }

  /** A key unique within the screen: a second "Lbl" on one screen is "Lbl#2". */
  private keyFor(id: string, wanted: string) {
    const n = (this.keyCount.get(wanted) ?? 0) + 1;
    this.keyCount.set(wanted, n);
    this.keys[id] = n === 1 ? wanted : `${wanted}#${n}`;
  }

  /** Expand a composite here: its parts are placed, its wires kept, its instance recorded. */
  composite(kind: CompositeKind, props: Record<string, unknown>, box: Box, name: string): CompositeInstance {
    const stem = this.unique(name);
    const { parts, wires } = expandComposite(kind, props, box, stem);
    // A composite's parts are named stem, stem_Lbl, stem_Val...; their keys use
    // the stem that was asked for, so Card_PMP101_2_Val is keyed Card_PMP101_Val.
    const wantedStem = name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "N$1");
    for (const part of parts) {
      const key = part.Name.startsWith(stem) ? wantedStem + part.Name.slice(stem.length) : part.Name;
      this.add(part, undefined, key);
    }
    for (const w of wires) {
      const part = parts[w.index];
      if (part) this.wires.push({ part, tag: w.tag, property: w.property, ...(w.converter ? { converter: w.converter } : {}) });
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
  add(part: Part, tag?: string, key?: string): Part {
    this.keyFor(part.UniqueId, key ?? part.Name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "N$1"));
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
    // The chip is drawn; the touch over it is what changes screen on the panel.
    if (!here) place.add(screenSwitch(`NavGo_${key}_${i}`, other.screenName, { left, top: HEADER + 4, width: chipWidth, height: NAV - 8 }));
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
  const isChip = (name: string) => /^NavChip_|^NavLbl_|^NavGo_/.test(name);
  // A content screen is embedded, not navigated to: it is never a chip.
  const listed = screens.filter((s) => s.Type !== "Content");
  const chipWidth = Math.min(150, Math.floor((panel.width - MARGIN * 2) / Math.max(listed.length, 1)) - 6);
  let changed = false;

  const out = screens.map((screen) => {
    const view = screen.Children[0];
    const stripAt = view.Children.findIndex(
      (p) => p.Type === "Rectangle" && p.Name.startsWith("Nav_") && p.Location.Top === HEADER,
    );
    if (stripAt === -1) return screen;

    const key = screen.Name.replace(/[^A-Za-z0-9_]/g, "_");
    const chips: Part[] = [];
    listed.forEach((other, i) => {
      const here = other.UniqueId === screen.UniqueId;
      const left = MARGIN + i * (chipWidth + 6);
      if (left + chipWidth > panel.width - MARGIN) return;
      chips.push(
        rectangle(`NavChip_${key}_${i}`, { left, top: HEADER + 4, width: chipWidth, height: NAV - 8 },
          { fill: here ? T.white : T.panel, border: here ? T.ink : T.line }),
        textBox(`NavLbl_${key}_${i}`, other.Name, { left: left + 8, top: HEADER + 8, width: chipWidth - 16, height: 16 },
          { size: 12, colour: T.ink }),
      );
      if (!here) chips.push(screenSwitch(`NavGo_${key}_${i}`, other.Name, { left, top: HEADER + 4, width: chipWidth, height: NAV - 8 }));
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

/** Which of a card's two halves a screen asked for: the state lamps, the readings. */
type Show = { status: boolean; process: boolean };
const ALL: Show = { status: true, process: true };

function card(place: Placer, unit: LayoutUnit, box: Box, show: Show = ALL, preferred: string[] = []) {
  drawCard(place, unit, box, show, preferred);
}

function drawCard(place: Adds, unit: LayoutUnit, box: Box, show: Show = ALL, preferred: string[] = []) {
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

  const run = show.status ? unit.roles.find((r) => r.role === "running") : undefined;
  const fault = show.status ? unit.roles.find((r) => r.role === "fault") : undefined;
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
  // Which readings: the ones the engineer named first, then the ones the
  // class leads with - the same order the process view and the overview use.
  const readings = show.process
    ? orderReadings(unit.roles.filter((r) => isReading(r.dataType)), unit.kind, preferred).slice(0, run || fault ? 1 : 2)
    : [];
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

/** BOOL roles that are a state an operator reads, abnormal ones first. */
const ABNORMAL = new Set(["fault", "estop", "high", "low"]);
const STATE_ROLES = ["fault", "estop", "running", "off", "high", "low", "open", "closed", "ready", "available", "healthy", "active", "flame", "occupied"];
/**
 * Number roles read as a plain number, never on a bar: what a sequence or
 * selector is on, and a drive's status word, command word and elapsed times,
 * none of which has a range a bar could mean anything against.
 */
const POSITION_ROLES = new Set(["mode", "step", "selection", "word", "state", "time"]);
const SELECTOR_ROLES = new Set(["mode", "step", "selection"]);

/** A tag as a person says it: Status_Reg is "Status reg", PMP_101_MODE is "Mode". */
const spoken = (r: { tag: string; role: string }) =>
  SELECTOR_ROLES.has(r.role) ? titleCase(r.role) : titleCase(r.tag.replace(/[_.]+/g, " ").trim().toLowerCase());

/** Which push button a command bit is, by its name: Run_CMD and PMP_START are START. */
const pushbutton = (r: { tag: string; role: string }) =>
  r.role === "reset" ? "RESET"
  : /(^|_)(START|RUN)(_?CMD)?$/i.test(r.tag) ? "START"
  : /(^|_)STOP(_?CMD)?$/i.test(r.tag) ? "STOP"
  : undefined;
const BUTTON_ORDER = ["START", "STOP", "RESET"];

/**
 * A level 3 unit detail: everything one piece of equipment has, in the order
 * an operator works through it - what it is, what state it is in, what it can
 * be told to do, every reading on its own analogue indicator, and a trend of
 * what it leads with.
 *
 * Commands are the controls the packager writes with a known behaviour: a
 * momentary Switch for a start, stop or reset bit (bound through its click
 * action), a ToggleSwitch for a single maintained run command or an
 * auto/manual bit. A setpoint is an entry box, the one numeric display on the
 * panel an operator can type into.
 */
function detail(place: Placer, unit: LayoutUnit, box: Box, preferred: string[] = []): string[] {
  const notes: string[] = [];
  const key = unit.id.replace(/[^A-Za-z0-9]/g, "");
  const { left: x, top: y, width: w, height: h } = box;
  // A unit with the screen to itself gets two columns: what it is told on
  // the left, what it reads on the right, as the rig's own screens put their
  // buttons beside their gauges.
  const wide = w >= 900;
  const inner = wide ? 456 : w - 24;
  place.add(rectangle(`Detail_${key}`, box, { fill: T.panel, border: T.line }));

  const symbolSize = unit.graphic ? SYMBOL : 0;
  if (unit.graphic) {
    place.add(pathPart(`DetailSym_${key}`, unit.graphic, { left: x + w - symbolSize - 12, top: y + 8, width: symbolSize, height: symbolSize }, { fill: GREY, border: DARK_GREY }));
  }
  place.add(textBox(`DetailName_${key}`, unit.label, { left: x + 12, top: y + 8, width: w - (symbolSize || 0) - 36, height: 22 }, { size: 14, bold: true }));
  place.add(textBox(`DetailKind_${key}`, unit.kind.toUpperCase(), { left: x + 12, top: y + 32, width: 160, height: 18 }, { size: 12, colour: T.muted }));
  const head = y + Math.max(56, symbolSize + 16);
  let top = head;
  const bottom = y + h - 8;

  // --- state ---------------------------------------------------------------
  const states = STATE_ROLES.flatMap((role) => unit.roles.filter((r) => r.role === role && r.dataType === "BOOL")).slice(0, 4);
  if (states.length > 0) {
    const width = Math.floor((inner - (states.length - 1) * 8) / states.length);
    states.forEach((r, i) => {
      const at = { left: x + 12 + i * (width + 8), top, width, height: 36 };
      // A lamp says its role (RUNNING, FAULT) unless the role cannot say which
      // thing is off, or two lamps share it: then the tag's own words, on both
      // faces as the rig's lamps do - AUTO_SEQ_OFF, Ready_To_SwitchOn beside Ready.
      const own = r.role !== "off" && states.filter((o) => o.role === r.role).length === 1;
      const word = own ? r.role.toUpperCase() : spoken(r).toUpperCase();
      const [off, on] = own ? [ABNORMAL.has(r.role) ? `NO ${word}` : `NOT ${word}`, word] : [word, word];
      place.add(ABNORMAL.has(r.role) ? alarmLamp(`DetailLamp_${key}_${i}`, off, on, at) : lamp(`DetailLamp_${key}_${i}`, off, on, at), r.tag);
    });
    top += 36 + 8;
  }

  // --- what the PLC says the machine is doing, in its own words --------------
  const said = unit.roles.find((r) => r.role === "state" && r.dataType === "STRING");
  if (said && top + 28 <= bottom) {
    const tag = said.tag.replace(/[^A-Za-z0-9]/g, "");
    place.add(textBox(`DetailLbl_${tag}`, spoken(said), { left: x + 12, top: top + 4, width: 120, height: 20 }, { size: 12 }));
    place.add(stringDisplay(`DetailStr_${tag}`, { left: x + 136, top, width: inner - 124, height: 28 }), said.tag);
    top += 28 + 8;
  }

  // --- commands --------------------------------------------------------------
  // Separate start, stop and reset bits are push buttons - the momentary
  // Switch, START first, as on the rig. A single _CMD bit with no start or
  // stop in its name is a maintained run command - a toggle.
  const commands = unit.roles
    .filter((r) => (r.role === "command" || r.role === "reset") && r.dataType === "BOOL")
    .map((r) => ({ r, word: pushbutton(r) }))
    .sort((a, b) => (a.word ? BUTTON_ORDER.indexOf(a.word) : 9) - (b.word ? BUTTON_ORDER.indexOf(b.word) : 9))
    .slice(0, 3);
  if (commands.length > 0 && top + 40 <= bottom) {
    const width = Math.floor((inner - (commands.length - 1) * 8) / commands.length);
    commands.forEach(({ r, word }, i) => {
      const at = { left: x + 12 + i * (width + 8), top, width, height: 40 };
      place.add(word ? switchPart(`DetailCmd_${key}_${i}`, word, at) : toggleSwitch(`DetailCmd_${key}_${i}`, "STOP", "START", at), r.tag);
    });
    top += 40 + 8;
  }

  // An auto/manual bit is a selector the operator works: off is MANUAL, as the
  // rig's AUTOMAN toggle has it.
  const selector = unit.roles.find((r) => r.role === "mode" && r.dataType === "BOOL");
  if (selector && top + 36 <= bottom) {
    const tag = selector.tag.replace(/[^A-Za-z0-9]/g, "");
    place.add(textBox(`DetailLbl_${tag}`, "Mode", { left: x + 12, top: top + 8, width: 72, height: 20 }, { size: 12 }));
    place.add(toggleSwitch(`DetailMode_${tag}`, "MANUAL", "AUTO", { left: x + 88, top, width: Math.min(200, inner - 76), height: 36 }), selector.tag);
    top += 36 + 8;
  }

  // --- what the machine is asked for: the one place an operator types ---------
  const asked = unit.roles.filter((r) => r.role === "setpoint" && isReading(r.dataType)).slice(0, 2);
  if (asked.length > 0 && top + 32 <= bottom) {
    const width = Math.floor((inner - (asked.length - 1) * 8) / asked.length);
    asked.forEach((r, i) => {
      const left = x + 12 + i * (width + 8);
      const tag = r.tag.replace(/[^A-Za-z0-9]/g, "");
      const range = unit.ranges?.[r.tag] ?? rangeFor(r.comment, r.role);
      const label = range.units ? `${spoken(r)} (${range.units})` : spoken(r);
      const entry = Math.min(104, width - 76);
      place.add(textBox(`DetailLbl_${tag}`, label, { left, top: top + 6, width: width - entry - 4, height: 20 }, { size: 12 }));
      place.add(numericDisplay(`DetailSet_${tag}`, { left: left + width - entry, top, width: entry, height: 32 }, 0, true), r.tag);
    });
    top += 32 + 8;
  }

  // --- numbers read as they are, two to a row ---------------------------------
  const positions = unit.roles.filter((r) => POSITION_ROLES.has(r.role) && isReading(r.dataType)).slice(0, 4);
  for (let row = 0; row < positions.length && top + 24 <= bottom; row += 2) {
    const width = Math.floor((inner - 8) / 2);
    positions.slice(row, row + 2).forEach((r, i) => {
      const left = x + 12 + i * (width + 8);
      const tag = r.tag.replace(/[^A-Za-z0-9]/g, "");
      const label = Math.max(72, width - 96);
      place.add(textBox(`DetailLbl_${tag}`, spoken(r), { left, top: top + 2, width: label, height: 20 }, { size: 12 }));
      place.add(numericDisplay(`DetailNum_${tag}`, { left: left + label + 4, top, width: Math.max(48, width - label - 4), height: 24 }, 0), r.tag);
    });
    top += 24 + 8;
  }

  // --- readings ----------------------------------------------------------------
  const rx = wide ? x + 12 + inner + 16 : x + 12;
  const rw = wide ? w - inner - 40 : inner;
  if (wide) top = head;
  const readings = orderReadings(
    unit.roles.filter((r) => isReading(r.dataType) && !POSITION_ROLES.has(r.role) && r.role !== "setpoint"),
    unit.kind,
    preferred,
  );
  const TREND = 96;
  const ROW = 56;
  // A unit with the screen to itself is wide enough for two columns of
  // indicators: a drive has a dozen readings, and one per full-width row
  // showed two of them.
  const cols = rw >= 600 ? 2 : 1;
  const colWidth = Math.floor((rw - (cols - 1) * 12) / cols);
  const rowsFor = (n: number) => Math.ceil(n / cols);
  // Room for the trend is kept only when every reading still fits beside it.
  const withTrend = readings.length > 0 && top + rowsFor(readings.length) * (ROW + 8) + TREND <= bottom;
  const fits = cols * Math.max(0, Math.floor((bottom - top - (withTrend ? TREND : 0) + 8) / (ROW + 8)));
  // Two readings of one role are told apart by their names: Motor voltage and
  // Mains voltage, not Voltage twice.
  const shared = (role: string) => readings.filter((r) => r.role === role).length > 1;
  readings.slice(0, fits).forEach((role, i) => {
    const range = unit.ranges?.[role.tag] ?? rangeFor(role.comment, role.role);
    const label = shared(role.role) ? spoken(role) : titleCase(role.role);
    place.composite(
      "AnalogIndicator",
      { label, tag: role.tag, units: range.units, min: range.min, max: range.max, normalLow: range.normalLow, normalHigh: range.normalHigh, decimals: 1 },
      { left: rx + (i % cols) * (colWidth + 12), top: top + Math.floor(i / cols) * (ROW + 8), width: colWidth, height: ROW },
      `DetailInd_${role.tag.replace(/[^A-Za-z0-9]/g, "")}`,
    );
  });
  if (readings.length > fits) {
    notes.push(`${unit.label}: ${readings.length - fits} of ${readings.length} readings do not fit its detail panel`);
  }
  top += rowsFor(Math.min(fits, readings.length)) * (ROW + 8);

  if (withTrend) {
    const tags = readings.slice(0, 2).map((r) => r.tag);
    place.add(trendGraph(`DetailTrend_${key}`, tags, { left: rx, top, width: rw, height: Math.min(wide ? Math.max(TREND, bottom - top) : TREND, bottom - top) }));
  }
  return notes;
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

/**
 * The faceplates of one screen, on the grid its level and panel allow, and the
 * alarm banner when the screen asks for it. Shared by the application layout
 * and the program compiler, so a planned screen and a compiled one are the
 * same screen. Returns what it had to leave off.
 */
export function faceplateBand(
  place: Placer,
  spec: ScreenSpec,
  equipment: LayoutUnit[],
  panel: { width: number; height: number },
  from = HEADER + NAV + 8,
): string[] {
  const byId = new Map(equipment.map((e) => [e.id, e]));
  const wantsAlarms = spec.sections.includes("alarms");
  const footerTop = panel.height - FOOTER;
  // The alarm banner sits in the same place on every screen that has one, so
  // an operator's eye does not have to search for it after a screen change.
  const alarmTop = footerTop - ALARM_BAND;
  const grid = gridFor(spec.level, panel, wantsAlarms, from);

  const units = spec.include
    .map((id) => byId.get(id))
    .filter((u): u is LayoutUnit => Boolean(u));

  // The planner splits screens by capacityOf, so this only drops units when
  // a caller laid out a spec by hand - and then it says so.
  const notes: string[] = [];
  if (units.length > grid.capacity) {
    notes.push(`${spec.screenName}: ${units.length - grid.capacity} of ${units.length} units do not fit a ${panel.width}x${panel.height} panel at level ${spec.level} and were left off`);
  }
  const show = { status: spec.sections.length === 0 || spec.sections.includes("status"), process: spec.sections.length === 0 || spec.sections.includes("process") };

  units.slice(0, grid.capacity).forEach((unit, i) => {
    const column = i % grid.columns;
    const row = Math.floor(i / grid.columns);
    // One unit at level 3 has the whole width; its detail lays itself out wide.
    const alone = spec.level === 3 && units.length === 1;
    const at: Box = {
      left: MARGIN + column * (grid.width + GAP),
      top: grid.top + row * (grid.height + GAP),
      width: alone ? panel.width - MARGIN * 2 : grid.width,
      height: grid.height,
    };
    if (spec.level === 1) tile(place, unit, at);
    else if (spec.level === 3) notes.push(...detail(place, unit, at, spec.readings));
    else card(place, unit, at, show, spec.readings);
  });

  if (units.length === 0) {
    place.add(
      textBox(`Empty_${spec.screenName}`, "No equipment on this screen yet.",
        { left: MARGIN, top: grid.top + 8, width: 400, height: 24 }, { size: 13, colour: T.muted }),
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

  return notes;
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

  return specs.map((spec) => {
    place.begin();
    chrome(place, spec, navigation, panel);
    const notes = faceplateBand(place, spec, equipment, panel);
    const screen = screenOf(spec.screenName, place.parts, panel);
    // Every wire now knows its screen, which is what keeps a Target's ScreenId
    // right in an application with more than one.
    const wires = place.wires.map((w) => ({ ...w, screenId: screen.UniqueId }));
    return {
      screen,
      parts: place.parts,
      keys: { ...place.keys },
      wires,
      composites: place.composites.map((c) => ({ ...c, screenId: screen.UniqueId })),
      notes,
    };
  });
}
