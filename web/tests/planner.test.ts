/**
 * Every inferred unit ends up on a screen.
 *
 * Reported from a real run of the 718-tag chemical plant: the build timeline
 * read "48 of 94 units". The model planned the eight areas it was told about
 * and stopped, and the other 46 units - inferred, named in the prompt - were
 * simply absent from the project. No faceplate, no binding, no alarm, and
 * nothing saying so beyond a count nobody reads as a failure.
 */

import { describe, expect, it } from "vitest";
import { fallbackPlan, placeEveryUnit, type ScreenSpec } from "@/lib/ai/plan";
import { inferEquipment } from "@/lib/ai/infer";
import type { Variable } from "@/lib/ote/schema";

const tag = (Name: string, DataType: Variable["DataType"] = "BOOL"): Variable => ({
  Name,
  DataType,
  Comments: "",
  DeviceAddress: "",
});

/** `count` pumps, each with a running bit and a fault bit. */
const pumps = (count: number, from = 100) =>
  inferEquipment(
    Array.from({ length: count }, (_, i) => [
      tag(`PMP_${from + i}_RUN`),
      tag(`PMP_${from + i}_FLT`),
    ]).flat(),
  );

const mixed = () =>
  inferEquipment([
    ...Array.from({ length: 4 }, (_, i) => [
      tag(`PMP_${100 + i}_RUN`),
      tag(`PMP_${100 + i}_FLT`),
    ]).flat(),
    ...Array.from({ length: 4 }, (_, i) => [
      tag(`BLR_${200 + i}_RUN`),
      tag(`BLR_${200 + i}_FLT`),
    ]).flat(),
    ...Array.from({ length: 3 }, (_, i) => [
      tag(`CHL_${300 + i}_RUN`),
      tag(`CHL_${300 + i}_FLT`),
    ]).flat(),
  ]);

const screen = (name: string, include: string[], level: 1 | 2 | 3 = 2): ScreenSpec => ({
  screenName: name,
  title: name,
  level,
  include,
  sections: ["status"],
});

const placedOn = (screens: ScreenSpec[]) => new Set(screens.flatMap((s) => s.include));

describe("placeEveryUnit", () => {
  it("leaves a complete plan alone", () => {
    const equipment = pumps(3);
    const plan = [screen("Station", equipment.map((e) => e.id))];
    expect(placeEveryUnit(plan, equipment, new Set())).toEqual(plan);
  });

  it("places the units the model forgot", () => {
    const equipment = pumps(10);
    // The model planned one screen and stopped, as it does on a large plant.
    const partial = [screen("Station1", equipment.slice(0, 3).map((e) => e.id))];

    const completed = placeEveryUnit(partial, equipment, new Set(["station1"]));
    const placed = placedOn(completed);
    for (const unit of equipment) {
      expect(placed.has(unit.id), `${unit.id} left off every screen`).toBe(true);
    }
  });

  it("fills the model's own screens before making new ones", () => {
    const equipment = pumps(6);
    const partial = [screen("Station1", equipment.slice(0, 2).map((e) => e.id))];

    const completed = placeEveryUnit(partial, equipment, new Set(["station1"]));
    // Six units fit on one screen, so no second screen was needed.
    expect(completed).toHaveLength(1);
    expect(completed[0].include).toHaveLength(6);
  });

  it("never crowds a screen past the units-per-screen rule", () => {
    const equipment = pumps(20);
    const partial = [screen("Station1", equipment.slice(0, 2).map((e) => e.id))];

    for (const s of placeEveryUnit(partial, equipment, new Set())) {
      expect(s.include.length).toBeLessThanOrEqual(s.level === 1 ? 12 : 6);
    }
  });

  it("leaves a level 1 overview a summary, not an inventory", () => {
    const equipment = pumps(20);
    const partial = [
      screen("PlantOverview", equipment.slice(0, 4).map((e) => e.id), 1),
      screen("Station1", equipment.slice(4, 6).map((e) => e.id)),
    ];

    const completed = placeEveryUnit(partial, equipment, new Set());
    expect(completed.find((s) => s.level === 1)!.include).toHaveLength(4);
  });

  it("prefers a screen already holding the same kind of equipment", () => {
    const equipment = mixed();
    const boilers = equipment.filter((e) => e.kind === "boiler");
    const partial = [
      screen("PumpArea", equipment.filter((e) => e.kind === "pump").map((e) => e.id)),
      screen("BoilerArea", [boilers[0].id]),
    ];

    const completed = placeEveryUnit(partial, equipment, new Set());
    const boilerScreen = completed.find((s) => s.screenName === "BoilerArea")!;
    // The remaining boilers joined the boiler screen, not the pump one.
    for (const boiler of boilers) expect(boilerScreen.include).toContain(boiler.id);
  });

  it("groups whatever is still homeless by kind, and names the screen for it", () => {
    const equipment = mixed();
    // Every existing screen is full, so the chillers need somewhere new.
    const partial = [
      screen("Full", equipment.slice(0, 6).map((e) => e.id)),
    ];

    const completed = placeEveryUnit(partial, equipment, new Set(["full"]));
    expect(placedOn(completed).size).toBe(equipment.length);
    const made = completed.slice(1);
    expect(made.length).toBeGreaterThan(0);
    for (const s of made) expect(s.screenName).toMatch(/^[A-Z][A-Za-z]*Area\d+$/);
  });

  it("keeps every screen name unique, because the name is the hierarchy entry", () => {
    const equipment = mixed();
    const partial = [screen("PumpArea1", equipment.slice(0, 6).map((e) => e.id))];
    const names = placeEveryUnit(partial, equipment, new Set(["pumparea1"])).map(
      (s) => s.screenName.toLowerCase(),
    );
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("the offline plan already placed everything", () => {
  it("covers every unit, which is the behaviour the model path now matches", () => {
    const equipment = pumps(17);
    const plan = fallbackPlan("the whole plant", equipment);
    const placed = new Set(plan.screens.flatMap((s) => s.include));
    for (const unit of equipment) expect(placed.has(unit.id)).toBe(true);
  });
});
