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
  rectangle,
  screenOf,
  textBox,
  type Box,
} from "./parts";
import { DARK_GREY, GREEN, GREY, INK, PAPER, WHITE } from "./palette";
import type { Wire } from "./bindings";
import type { Part, Screen } from "./schema";

/** One equipment unit, in the shape lib/ai/infer.ts produces. */
export interface LayoutUnit {
  id: string;
  kind: string;
  label: string;
  roles: { tag: string; role: string; dataType: string; comment: string }[];
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
}

/* --- the fixed zones, in screen units -------------------------------- */

const HEADER = 44;
const NAV = 32;
const FOOTER = 28;
const MARGIN = 12;
const GAP = 16;

/** Level 2 and 3: three cards across, two rows down. */
const CARD = { width: 320, height: 162, columns: 3 };
/** Level 1: four tiles across, three rows down. Status only, no readings. */
const TILE = { width: 238, height: 100, columns: 4 };

/** The engineering unit a reading is in, from what the tag comment says. */
function unitOf(comment: string, role: string): string {
  if (/percent|%/i.test(comment)) return "%";
  if (/lpm|l\/min/i.test(comment)) return "LPM";
  if (/m3\/h|m³\/h/i.test(comment)) return "m3/h";
  if (/\bbar\b/i.test(comment)) return "bar";
  if (/\bpsi\b/i.test(comment)) return "psi";
  if (/deg\s?c|°c|celsius/i.test(comment)) return "degC";
  if (/\bkw\b/i.test(comment)) return "kW";
  if (/\brpm\b/i.test(comment)) return "rpm";
  if (/\bhz\b|hertz/i.test(comment)) return "Hz";
  if (role === "level") return "%";
  if (role === "flow") return "LPM";
  return "";
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Only what a person reads as a number belongs in a numeric display. */
const isReading = (dataType: string) => dataType !== "BOOL" && dataType !== "STRING";

/**
 * One placer per application, so names stay unique across every screen and
 * every wire remembers the screen its object is on.
 */
class Placer {
  private taken = new Set<string>();
  parts: Part[] = [];
  wires: Wire[] = [];

  /** Fresh part list per screen; the name set carries across all of them. */
  begin() {
    this.parts = [];
    this.wires = [];
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

function chrome(
  place: Placer,
  spec: ScreenSpec,
  all: ScreenSpec[],
  panel: { width: number; height: number },
) {
  const key = spec.screenName;

  // Header band. Green is the brand colour and the one place it is decoration
  // rather than a signal, which is why nothing else on the screen is green
  // unless it means "running".
  place.add(rectangle(`Hdr_${key}`, { left: 0, top: 0, width: panel.width, height: HEADER }, { fill: GREEN, border: GREEN }));
  place.add(
    textBox(`HdrTitle_${key}`, spec.title, { left: MARGIN + 4, top: 10, width: 620, height: 26 }, { size: 18, colour: WHITE, bold: true }),
  );
  place.add(
    textBox(
      `HdrLevel_${key}`,
      `LEVEL ${spec.level} · ${spec.level === 1 ? "PLANT OVERVIEW" : spec.level === 2 ? "UNIT OVERVIEW" : "UNIT DETAIL"}`,
      { left: panel.width - 320, top: 13, width: 300, height: 20 },
      { size: 11, colour: WHITE },
    ),
  );

  // Navigation strip: every screen in the application, in the same order and
  // the same place on all of them. The one you are on is filled.
  place.add(rectangle(`Nav_${key}`, { left: 0, top: HEADER, width: panel.width, height: NAV }, { fill: PAPER, border: GREY }));
  const chipWidth = Math.min(150, Math.floor((panel.width - MARGIN * 2) / Math.max(all.length, 1)) - 6);
  all.forEach((other, i) => {
    const here = other.screenName === spec.screenName;
    const left = MARGIN + i * (chipWidth + 6);
    if (left + chipWidth > panel.width - MARGIN) return; // more screens than fit
    place.add(
      rectangle(`NavChip_${key}_${i}`, { left, top: HEADER + 4, width: chipWidth, height: NAV - 8 },
        { fill: here ? GREEN : WHITE, border: here ? GREEN : GREY }),
    );
    place.add(
      textBox(`NavLbl_${key}_${i}`, other.screenName, { left: left + 8, top: HEADER + 8, width: chipWidth - 16, height: 16 },
        { size: 10, colour: here ? WHITE : INK }),
    );
  });

  // Footer: what you are looking at, and where it came from.
  const footTop = panel.height - FOOTER;
  place.add(rectangle(`Foot_${key}`, { left: 0, top: footTop, width: panel.width, height: FOOTER }, { fill: PAPER, border: GREY }));
  place.add(
    textBox(`FootLbl_${key}`, `${spec.screenName} — ${spec.include.length} unit${spec.include.length === 1 ? "" : "s"}`,
      { left: MARGIN + 4, top: footTop + 6, width: 500, height: 16 }, { size: 10, colour: DARK_GREY }),
  );
  place.add(
    textBox(`FootMark_${key}`, "Generated by HMI Copilot", { left: panel.width - 260, top: footTop + 6, width: 240, height: 16 },
      { size: 10, colour: DARK_GREY }),
  );
}

/* --- the content ------------------------------------------------------ */

/** A unit faceplate: what it is, whether it is running, what it is reading. */
function card(place: Placer, unit: LayoutUnit, box: Box) {
  const key = unit.id.replace(/[^A-Za-z0-9]/g, "");
  const { left: x, top: y } = box;

  place.add(rectangle(`Card_${key}`, box, { fill: WHITE, border: GREY }));
  place.add(textBox(`CardName_${key}`, unit.label, { left: x + 12, top: y + 8, width: box.width - 110, height: 20 }, { size: 13, bold: true }));
  place.add(
    textBox(`CardKind_${key}`, unit.kind.toUpperCase(), { left: x + box.width - 96, top: y + 9, width: 84, height: 18 }, { size: 10, colour: DARK_GREY }),
  );

  const run = unit.roles.find((r) => r.role === "running");
  const fault = unit.roles.find((r) => r.role === "fault");
  const lampsTop = y + 34;
  const halfWidth = Math.floor((box.width - 24 - 8) / 2);

  if (run) {
    place.add(
      lamp(`Lamp_${key}_RUN`, "STOPPED", "RUNNING", { left: x + 12, top: lampsTop, width: fault ? halfWidth : box.width - 24, height: 44 }),
      run.tag,
    );
  }
  if (fault) {
    place.add(
      alarmLamp(`Lamp_${key}_FLT`, "NO FAULT", "FAULT", {
        left: run ? x + 12 + halfWidth + 8 : x + 12,
        top: lampsTop,
        width: run ? halfWidth : box.width - 24,
        height: 44,
      }),
      fault.tag,
    );
  }

  // Two readings fit. A unit with more of them earns a detail screen, which is
  // what the plan is for - cramming six numerics into a card is the habit
  // ISA-101 exists to break.
  const readings = unit.roles.filter((r) => isReading(r.dataType)).slice(0, 2);
  readings.forEach((role, i) => {
    const rowTop = y + (run || fault ? 86 : 40) + i * 34;
    const tag = role.tag.replace(/[^A-Za-z0-9]/g, "");
    place.add(
      textBox(`Lbl_${tag}`, titleCase(role.role), { left: x + 12, top: rowTop + 6, width: 104, height: 20 }, { size: 11 }),
    );
    place.add(
      numericDisplay(`Num_${tag}`, { left: x + 120, top: rowTop, width: 124, height: 30 }),
      role.tag,
    );
    const unitLabel = unitOf(role.comment, role.role);
    if (unitLabel) {
      place.add(
        textBox(`Unit_${tag}`, unitLabel, { left: x + 250, top: rowTop + 6, width: box.width - 262, height: 20 }, { size: 11, colour: DARK_GREY }),
      );
    }
  });
}

/** A plant-overview tile: the unit's name and one state. Deviation only. */
function tile(place: Placer, unit: LayoutUnit, box: Box) {
  const key = unit.id.replace(/[^A-Za-z0-9]/g, "");
  const { left: x, top: y } = box;

  place.add(rectangle(`Tile_${key}`, box, { fill: WHITE, border: GREY }));
  place.add(textBox(`TileName_${key}`, unit.label, { left: x + 10, top: y + 8, width: box.width - 20, height: 18 }, { size: 12, bold: true }));

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
      textBox(`TileLbl_${tag}`, titleCase(reading.role), { left: x + 10, top: y + 66, width: 96, height: 18 }, { size: 10, colour: DARK_GREY }),
    );
    place.add(numericDisplay(`TileNum_${tag}`, { left: x + 108, top: y + 64, width: box.width - 118, height: 24 }), reading.tag);
  }
}

/* --- the application -------------------------------------------------- */

export function layoutApplication(
  specs: ScreenSpec[],
  equipment: LayoutUnit[],
  panel: { width: number; height: number },
): LaidOutScreen[] {
  const place = new Placer();
  const byId = new Map(equipment.map((e) => [e.id, e]));

  return specs.map((spec) => {
    place.begin();
    chrome(place, spec, specs, panel);

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
          { left: MARGIN, top: contentTop + 8, width: 400, height: 24 }, { size: 13, colour: DARK_GREY }),
      );
    }

    if (wantsAlarms) {
      place.add(
        textBox(`AlarmsLbl_${spec.screenName}`, "ACTIVE ALARMS",
          { left: MARGIN, top: alarmTop, width: 300, height: 20 }, { size: 11, colour: DARK_GREY }),
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
    return { screen, parts: place.parts, wires };
  });
}
