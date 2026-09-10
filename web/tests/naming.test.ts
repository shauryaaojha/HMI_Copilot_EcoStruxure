/**
 * Naming a project after what it turned out to be.
 *
 * The model's suggestion is preferred because it read the sentence, but every
 * fallback below it is deterministic - a project has to end up with a real name
 * on a machine with no key configured and no network, or the feature is a
 * demo-only one. These are the fallbacks.
 */

import { describe, expect, it } from "vitest";
import {
  fromEquipment,
  fromIntent,
  fromScreenName,
  isUnnamed,
  nameProject,
} from "@/lib/ai/name";

describe("isUnnamed", () => {
  it("recognises the names a new project is given", () => {
    expect(isUnnamed("Untitled")).toBe(true);
    expect(isUnnamed("Untitled_2")).toBe(true);
    expect(isUnnamed("  untitled  ")).toBe(true);
  });

  it("leaves anything else alone, so a real name is never overwritten", () => {
    expect(isUnnamed("Boiler_House")).toBe(false);
    expect(isUnnamed("Untitled_Works")).toBe(false);
    expect(isUnnamed("Pump_Station_Demo")).toBe(false);
  });
});

describe("fromScreenName", () => {
  it("splits the PascalCase the plan writes", () => {
    expect(fromScreenName("PumpStation1")).toBe("Pump_Station");
    expect(fromScreenName("BoilerHouse")).toBe("Boiler_House");
  });

  it("drops the index, so screen 1 and screen 2 give one project name", () => {
    expect(fromScreenName("FiltrationArea2")).toBe(fromScreenName("FiltrationArea"));
  });

  it("ignores words that say nothing about which plant it is", () => {
    // "PlantOverview" would otherwise name every project Plant_Overview.
    expect(fromScreenName("PlantOverview")).toBe("Plant");
    expect(fromScreenName("Boiler101_Detail")).toBe("Boiler101");
  });
});

describe("fromIntent", () => {
  it("keeps the words that name a thing and drops the rest", () => {
    expect(fromIntent("Create a pump station screen for the transfer pumps")).toBe(
      "Pump_Station_Transfer",
    );
  });

  it("drops bare loop numbers, which are tags rather than names", () => {
    expect(fromIntent("build a screen for boiler 101 and boiler 102")).toBe("Boiler");
  });

  it("keeps short words that are real, and returns nothing from filler alone", () => {
    expect(fromIntent("show me the CIP skid")).toBe("Cip_Skid");
    expect(fromIntent("please can you make me one")).toBe("");
  });

  it("produces a name a filesystem and OTE will both take", () => {
    expect(fromIntent("the plant's #1 de-aerator!")).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/);
  });
});

describe("fromEquipment", () => {
  it("uses the most common machine, not the first one seen", () => {
    expect(fromEquipment(["fan", "boiler", "boiler", "pump"])).toBe("Boiler_Station");
  });

  it("says nothing when everything is an instrument", () => {
    expect(fromEquipment(["instrument", "instrument"])).toBe("");
  });
});

describe("nameProject", () => {
  it("prefers what the model suggested, because it read the sentence", () => {
    expect(
      nameProject({
        suggested: "Boiler_House",
        intent: "make the screens",
        screens: ["PumpStation1"],
      }),
    ).toBe("Boiler_House");
  });

  it("falls back to the screen the plan named, then the request, then equipment", () => {
    expect(nameProject({ screens: ["FiltrationArea1"], intent: "do it" })).toBe(
      "Filtration_Area",
    );
    expect(nameProject({ intent: "a screen for the dosing skid" })).toBe("Dosing_Skid");
    expect(nameProject({ intent: "make it", kinds: ["pump", "pump"] })).toBe(
      "Pump_Station",
    );
  });

  it("returns null rather than a name that says nothing", () => {
    expect(nameProject({ intent: "please can you help" })).toBeNull();
    expect(nameProject({})).toBeNull();
  });

  it("never hands back a name that would still read as unnamed", () => {
    expect(nameProject({ suggested: "Untitled" })).toBeNull();
  });

  it("keeps two projects distinguishable", () => {
    const taken = new Set(["Boiler_House"]);
    expect(nameProject({ suggested: "Boiler_House", taken })).toBe("Boiler_House_2");
  });

  it("sanitises whatever the model sent, rather than trusting it", () => {
    const name = nameProject({ suggested: "Water Treatment / Phase 2!" });
    expect(name).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/);
  });
});
