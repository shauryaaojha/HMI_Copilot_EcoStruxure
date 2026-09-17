/**
 * Slots instead of coordinates.
 *
 * A conversational op says "in the header" or "right of o12"; this is the
 * code that turns that into a box, or refuses with a reason. It never moves
 * anything that is already placed, and it never returns a position that
 * covers content. docs/LLD.md F3.
 */

import { describe, expect, it } from "vitest";
import { lamp, numericDisplay, rectangle, textBox } from "@/lib/ote/parts";
import { ZONES } from "@/lib/ote/layout";
import {
  firstFree,
  regionOf,
  regionsOf,
  resolveSlot,
  roomReport,
  type Box,
} from "@/lib/ote/regions";
import { demoScreen } from "@/fixtures";

const PANEL = { width: 1024, height: 600 };
const { HEADER, NAV, FOOTER } = ZONES;

const overlap = (a: Box, b: Box) =>
  a.left < b.left + b.width &&
  a.left + a.width > b.left &&
  a.top < b.top + b.height &&
  a.top + a.height > b.top;

/** A generated-looking screen: header band, nav strip, footer, one card. */
function chrome() {
  return [
    rectangle("Hdr", { left: 0, top: 0, width: 1024, height: HEADER }, {}),
    textBox("HdrTitle", "PLANT", { left: 16, top: 10, width: 300, height: 26 }, {}),
    rectangle("Nav", { left: 0, top: HEADER, width: 1024, height: NAV }, {}),
    rectangle("Foot", { left: 0, top: 600 - FOOTER, width: 1024, height: FOOTER }, {}),
    rectangle("Card_PMP101", { left: 12, top: HEADER + NAV + 8, width: 320, height: 162 }, {}),
    lamp("Lamp_PMP101_RUN", "STOPPED", "RUNNING", { left: 24, top: HEADER + NAV + 60, width: 140, height: 40 }),
  ];
}

describe("regionsOf", () => {
  it("names the fixed bands and the body between them", () => {
    const r = regionsOf(chrome(), PANEL);
    expect(r.header).toEqual({ left: 0, top: 0, width: 1024, height: HEADER });
    expect(r.nav!.top).toBe(HEADER);
    expect(r.footer!.top).toBe(600 - FOOTER);
    expect(r.alarms).toBeNull();
    expect(r.body!.top).toBe(HEADER + NAV + 8);
    expect(r.body!.top + r.body!.height).toBeLessThanOrEqual(600 - FOOTER);
  });

  it("carves an alarm region out of the body when a banner is present", () => {
    const r = regionsOf(demoScreen.Children[0].Children, PANEL);
    expect(r.alarms).not.toBeNull();
    expect(r.body!.top + r.body!.height).toBeLessThanOrEqual(r.alarms!.top);
  });

  it("puts each object in the region its centre falls in", () => {
    const parts = chrome();
    const r = regionsOf(parts, PANEL);
    expect(regionOf(parts[1], r)).toBe("header");
    expect(regionOf(parts[5], r)).toBe("body");
  });
});

describe("firstFree", () => {
  it("finds the first clear spot in reading order, on the grid", () => {
    const region = { left: 0, top: 0, width: 1024, height: 44 };
    const at = firstFree(region, [{ left: 16, top: 8, width: 300, height: 26 }], { width: 160, height: 24 })!;
    expect(at.left % 8).toBe(0);
    expect(at.top % 8).toBe(0);
    expect(overlap({ ...at, width: 160, height: 24 }, { left: 16, top: 8, width: 300, height: 26 })).toBe(false);
  });

  it("returns null rather than a least-bad overlap when nothing fits", () => {
    const region = { left: 0, top: 0, width: 200, height: 100 };
    expect(firstFree(region, [{ left: 0, top: 0, width: 200, height: 100 }], { width: 50, height: 50 })).toBeNull();
  });
});

describe("resolveSlot", () => {
  it("places in a region, clear of the content there and on top of its background", () => {
    const parts = chrome();
    const r = resolveSlot({ region: "header" }, parts, PANEL, { width: 160, height: 24 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.region).toBe("header");
    expect(r.box.top + r.box.height).toBeLessThanOrEqual(HEADER);
    expect(overlap(r.box, { left: 16, top: 10, width: 300, height: 26 })).toBe(false);
  });

  it("defaults to the body", () => {
    const r = resolveSlot({}, chrome(), PANEL, { width: 180, height: 52 });
    expect(r.ok && r.region).toBe("body");
  });

  it("puts a thing right of its anchor at the same top", () => {
    const parts = chrome();
    const anchor = parts[5];
    const r = resolveSlot(
      { anchor: "o6", side: "rightOf" },
      parts,
      PANEL,
      { width: 100, height: 40 },
      { anchorBox: { left: 24, top: HEADER + NAV + 60, width: 140, height: 40 }, anchorId: anchor.UniqueId },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.box.top).toBe(HEADER + NAV + 60);
    expect(r.box.left).toBeGreaterThanOrEqual(24 + 140);
  });

  it("slides along the axis past an obstacle rather than dropping to another row", () => {
    const parts = chrome();
    const anchor = parts[5];
    const blocker = numericDisplay("Num", { left: 180, top: HEADER + NAV + 60, width: 100, height: 40 });
    const r = resolveSlot(
      { anchor: "o6", side: "rightOf" },
      [...parts, blocker],
      PANEL,
      { width: 100, height: 40 },
      { anchorBox: { left: 24, top: HEADER + NAV + 60, width: 140, height: 40 }, anchorId: anchor.UniqueId },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.box.top).toBe(HEADER + NAV + 60);
    expect(r.box.left).toBeGreaterThanOrEqual(280);
  });

  it("places inside a card, clear of what the card already holds", () => {
    const parts = chrome();
    const card = parts[4];
    const r = resolveSlot(
      { anchor: "o5", side: "inside" },
      parts,
      PANEL,
      { width: 120, height: 30 },
      { anchorBox: { left: 12, top: HEADER + NAV + 8, width: 320, height: 162 }, anchorId: card.UniqueId },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.box.left).toBeGreaterThanOrEqual(12);
    expect(r.box.left + r.box.width).toBeLessThanOrEqual(12 + 320);
    expect(overlap(r.box, { left: 24, top: HEADER + NAV + 60, width: 140, height: 40 })).toBe(false);
  });

  it("refuses with the region and screen named when there is no room", () => {
    const parts = demoScreen.Children[0].Children;
    const r = resolveSlot({ region: "body" }, parts, PANEL, { width: 320, height: 162 }, { screenLabel: "s1 PumpStation1" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/body of s1 PumpStation1 has no free space/);
  });

  it("refuses an alarm slot on a screen with no banner", () => {
    const r = resolveSlot({ region: "alarms" }, chrome(), PANEL, { width: 100, height: 30 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/no alarms region/);
  });
});

describe("roomReport", () => {
  it("counts free card cells rather than declaring the screen full", () => {
    const report = roomReport(chrome(), PANEL);
    expect(report).toMatch(/body: \d+ of \d+ card cells free/);
    expect(report).toMatch(/header: room for \d+ small object/);
    expect(report).toMatch(/alarms: no banner/);
    expect(report).not.toMatch(/move something/);
  });

  it("says a full body needs a new screen or a replacement", () => {
    const report = roomReport(demoScreen.Children[0].Children, PANEL);
    expect(report).toMatch(/body: 0 of \d+ card cells free/);
  });
});
