/**
 * A second request builds on the first, never beside it.
 *
 * "Now give me the dosing screen" used to run the whole pipeline again with
 * fresh: false, which appended a second copy of every screen under a
 * PumpStation1_2 name. Extending plans only the equipment not yet placed,
 * never reuses a screen name, and lists every screen in the navigation strip.
 * docs/LLD.md F5. Runs offline - the deterministic plan is the one under test.
 */

import { describe, expect, it } from "vitest";
import { runPipeline, type ExistingScreen } from "@/lib/ai/pipeline";
import type { GenerationEvent } from "@/types/events";
import type { Variable } from "@/lib/ote/schema";

const tags = (units: string[]): Variable[] =>
  units.flatMap((id) => [
    { Name: `${id}_RUN`, DataType: "BOOL", Comments: "running", DeviceAddress: "" },
    { Name: `${id}_FLT`, DataType: "BOOL", Comments: "fault", DeviceAddress: "" },
  ]);

async function collect(intent: string, variables: Variable[], existing?: ExistingScreen[]) {
  const events: GenerationEvent[] = [];
  for await (const e of runPipeline({ intent, variables, existing })) events.push(e);
  const screens = new Set(
    events.flatMap((e) => (e.type === "object" && e.screenName ? [e.screenName] : [])),
  );
  return { events, screens: [...screens] };
}

describe("extending an application", () => {
  const variables = tags(["PMP_101", "PMP_102", "PMP_103", "PMP_104"]);

  it("plans only the equipment that is not yet on a screen", async () => {
    const existing: ExistingScreen[] = [{ name: "PumpStation1", level: 2, include: ["PMP_101", "PMP_102"] }];
    const { events } = await collect("the rest of the pumps", variables, existing);
    const cards = events.flatMap((e) =>
      e.type === "object" && e.part.Name.startsWith("Card_") ? [e.part.Name] : [],
    );
    expect(cards).toEqual(expect.arrayContaining(["Card_PMP103", "Card_PMP104"]));
    expect(cards).not.toContain("Card_PMP101");
    expect(cards).not.toContain("Card_PMP102");
  });

  it("never reuses a screen name the application already has", async () => {
    const existing: ExistingScreen[] = [{ name: "PumpStation1", level: 2, include: ["PMP_101"] }];
    const { screens } = await collect("more pumps", variables, existing);
    expect(screens).not.toContain("PumpStation1");
    expect(screens.length).toBeGreaterThan(0);
  });

  it("lists the existing screens in the new screen's navigation strip", async () => {
    const existing: ExistingScreen[] = [{ name: "PumpStation1", level: 2, include: ["PMP_101"] }];
    const { events } = await collect("more pumps", variables, existing);
    const labels = events.flatMap((e) =>
      e.type === "object" && e.part.Type === "TextBox" && e.part.Name.startsWith("NavLbl_")
        ? [e.part.Text]
        : [],
    );
    expect(labels).toContain("PumpStation1");
  });

  it("refuses, in words, when everything is already placed", async () => {
    const existing: ExistingScreen[] = [
      { name: "PumpStation1", level: 2, include: ["PMP_101", "PMP_102", "PMP_103", "PMP_104"] },
    ];
    const { events, screens } = await collect("again", variables, existing);
    expect(screens).toHaveLength(0);
    const error = events.find((e) => e.type === "error");
    expect(error && error.type === "error" && error.message).toMatch(/already on a screen/);
  });

  it("is a plain build when nothing exists", async () => {
    const { screens } = await collect("pump station", variables, []);
    expect(screens.length).toBeGreaterThan(0);
  });
});
