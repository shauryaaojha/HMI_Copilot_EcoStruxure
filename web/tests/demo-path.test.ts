/**
 * Phase 10: the demo path, checked beat by beat.
 *
 * docs/DEMO.md is a script someone has to follow live. This is the rehearsal
 * that can be run before every attempt, so a broken beat is found at the desk
 * rather than on stage. Each test is one thing the presenter is about to do.
 *
 * The beats that need a running server skip when there is none, the way
 * tests/packager.test.ts skips without a skeleton - so `npm test` stays green
 * on a machine with nothing running, and `npm run dev && npm test` checks the
 * whole path.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTags } from "@/lib/tags/parse";
import { createEngine } from "@/lib/sim/engine";
import { activeAlarms, objectValues } from "@/lib/sim/alarms";
import { mockGeneration } from "@/components/generation/mockPipeline";
import { TEMPLATES } from "@/components/templates/templates";
import { variablesCsv } from "@/components/export/variablesCsv";
import { PIPELINE_STEPS, type GenerationEvent } from "@/types/events";
import { demoAlarms, demoBindings, demoScreen, demoVariables } from "@/fixtures";
import { Part } from "@/lib/ote/schema";
import type { Binding } from "@/store/project";

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3000";

/**
 * The live beats are generous with time on purpose.
 *
 * `next dev` compiles a route the first time it is asked for, and the whole
 * suite runs in parallel against one server, so the first hit on a page can sit
 * behind a compile and several other suites. The default 5 s timeout made this
 * file fail perhaps one run in three - and a rehearsal that cries wolf is worse
 * than no rehearsal, because the presenter learns to ignore it.
 */
const LIVE_TIMEOUT = 30_000;
const SAMPLE = join(process.cwd(), "public", "demo", "Plant_Tags.csv");

const bindings: Binding[] = demoBindings.Bindings.flatMap((b) => {
  const target = demoBindings.Targets.find((t) => t.ReferenceId === b.Target);
  const source = demoBindings.Sources.find(
    (s) => s.ReferenceId === Number(b.Sources.split(",")[0].trim()),
  );
  if (!target || !source) return [];
  return [
    {
      tag: source.ObjectFullName,
      targetId: "",
      targetName: target.ObjectFullName,
      property: b.TargetProperty,
    },
  ];
});

/** Is a dev or production server answering? Decided once. */
const serverUp = await fetch(`${BASE}/`, { method: "HEAD" })
  .then((r) => r.ok)
  .catch(() => false);

if (!serverUp) {
  console.warn(
    `\n  Skipping the live beats: nothing answering at ${BASE}.\n` +
      "  Run `npm run dev` in another terminal to check the whole demo path.\n",
  );
}

/* ------------------------------------------------------------------ */
/* Beats that need nothing running                                     */
/* ------------------------------------------------------------------ */

describe("beat 1 — the sample tag export", () => {
  const csv = readFileSync(SAMPLE);
  const parsed = parseTags(
    csv.buffer.slice(csv.byteOffset, csv.byteOffset + csv.byteLength) as ArrayBuffer,
    "Plant_Tags.csv",
  );

  it("is the 1,248 tags the deck and the reference renders quote", () => {
    expect(parsed.variables).toHaveLength(1248);
    expect(parsed.summary.total).toBe(1248);
  });

  it("covers enough data types for the summary panel to be worth showing", () => {
    for (const type of ["BOOL", "INT", "DINT", "REAL", "LREAL", "STRING"] as const) {
      expect(parsed.summary[type], type).toBeGreaterThan(0);
    }
  });

  it("still contains the five names the corrector has to report", () => {
    // This is the beat where the presenter says corrections are reported, not
    // applied silently. If the sample stops needing corrections, the beat dies.
    expect(parsed.corrections.length).toBe(5);
    const from = parsed.corrections.map((c) => c.from);
    expect(from).toContain("2ND PUMP RUN");
    expect(from).toContain("MOTOR-SPEED-REF");
    expect(from).toContain("PLANT.TOTAL.FLOW");
  });

  it("loses no row on the way in", () => {
    expect(parsed.skipped).toEqual([]);
  });

  it("contains the pump tags the intent sentence talks about", () => {
    const names = new Set(parsed.variables.map((v) => v.Name));
    expect(names.has("PMP_101_RUN")).toBe(true);
    expect(names.has("PMP_101_FLT")).toBe(true);
    expect(names.has("PMP_102_RUN")).toBe(true);
    expect(names.has("FT_101_PV")).toBe(true);
    expect(names.has("LT_101_PV")).toBe(true);
  });
});

describe("beat 2 — generation fills the canvas", () => {
  it("runs every step and lands real objects, with no error event", async () => {
    const events: GenerationEvent[] = [];
    // The tags are supplied, because by this beat of the script beat 1 has
    // imported them. The emitter no longer substitutes the fixture list when
    // none is given - that turned a blank project into the demo one.
    for await (const event of mockGeneration({
      intent: "Create a pump station screen with 2 pumps",
      variables: demoVariables,
      pace: 0,
    })) {
      events.push(event);
    }

    const finished = events.filter((e) => e.type === "step" && e.state === "done");
    expect(finished).toHaveLength(PIPELINE_STEPS.length);
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(events.at(-1)?.type).toBe("done");

    const objects = events.filter((e) => e.type === "object");
    expect(objects).toHaveLength(demoScreen.Children[0].Children.length);
  });

  it("refuses with no tags rather than emitting the demo project", async () => {
    // A new project is blank. If the route is unreachable there, the fallback
    // emitter must say there is nothing to build from - not fill the canvas
    // with somebody else's pump station.
    const events: GenerationEvent[] = [];
    for await (const event of mockGeneration({ intent: "anything", variables: [], pace: 0 })) {
      events.push(event);
    }

    expect(events.some((e) => e.type === "object")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "error" });
  });
});

describe("beat 3 — a template lands on the canvas", () => {
  it("has the pump block the presenter reaches for, and it is valid", () => {
    const pump = TEMPLATES.find((t) => t.id === "pump-status");
    expect(pump).toBeDefined();
    for (const part of pump!.build({ left: 40, top: 40 }, 3)) {
      expect(Part.safeParse(part).success, part.Name).toBe(true);
    }
  });
});

describe("beat 4 — Simulate reaches the live screen", () => {
  it("gets to assets/screen_live.png inside the time the script allows", () => {
    // The script gives simulation about fifteen seconds of stage time, so the
    // presenter can talk over it and still land on the picture in the deck.
    const engine = createEngine({
      variables: demoVariables,
      alarms: demoAlarms,
      bindings,
    });
    for (let t = 0; t < 15 * 4; t += 1) engine.tick(0.25);

    const objects = objectValues(bindings, engine.values);
    expect(objects.Lamp_PUMP1_RUN).toBe(true);
    expect(objects.Lamp_PUMP2_RUN).toBe(false);
    expect(objects.Lamp_PUMP2_FLT).toBe(true);
    expect(Number(objects.Num_Flow)).toBeGreaterThan(0);

    const raised = activeAlarms(demoAlarms, bindings, engine.values).map(
      (r) => r.variable,
    );
    expect(raised).toContain("PMP_102_FLT");
    expect(raised).toContain("LT_101_PV");
  });
});

describe("beat 6 — the export writes something", () => {
  it("produces a Variables.csv whatever the .eote does", () => {
    // The .eote needs a skeleton and may not be available on the demo machine;
    // the CSV always is, so the export beat never comes up empty.
    const csv = variablesCsv([
      { Name: "PMP_101_RUN", DataType: "BOOL", Comments: "Pump 1 running", DeviceAddress: "%MX0.0" },
    ]);
    expect(csv.split("\r\n")[0]).toBe("Name,DataType,Comments,DeviceAddress");
    expect(csv).toContain("PMP_101_RUN");
  });
});

/* ------------------------------------------------------------------ */
/* Beats that need the app running                                     */
/* ------------------------------------------------------------------ */

describe.skipIf(!serverUp)("the routes the script visits", () => {
  const ROUTES = [
    "/",
    "/project/demo",
    "/project/demo/tags",
    "/project/demo/templates",
    "/project/demo/library",
    "/project/demo/standards",
    "/project/demo/validation",
    "/project/demo/export",
    "/project/demo/history",
    "/project/demo/settings",
    "/project/demo/project",
  ];

  for (const route of ROUTES) {
    it(`serves ${route}`, async () => {
      const response = await fetch(`${BASE}${route}`);
      expect(response.status, route).toBe(200);
    }, LIVE_TIMEOUT);
  }

  it("serves the sample export the Tags screen fetches", async () => {
    const response = await fetch(`${BASE}/demo/Plant_Tags.csv`);
    expect(response.status).toBe(200);
    expect((await response.text()).split("\r\n")[0]).toBe("Name,DataType,Comment,Address");
  }, LIVE_TIMEOUT);
});

describe.skipIf(!serverUp)("the routes the script depends on", () => {
  it("parses the sample export end to end", async () => {
    const body = new FormData();
    const csv = readFileSync(SAMPLE);
    body.append("file", new Blob([new Uint8Array(csv)]), "Plant_Tags.csv");

    const response = await fetch(`${BASE}/api/tags/parse`, { method: "POST", body });
    expect(response.status).toBe(200);

    const data = (await response.json()) as {
      variables: unknown[];
      corrections: unknown[];
    };
    expect(data.variables).toHaveLength(1248);
    expect(data.corrections).toHaveLength(5);
  }, LIVE_TIMEOUT);

  it("validates the demo project and finds something to talk about", async () => {
    const parts = demoScreen.Children[0].Children;
    const byName = new Map(parts.map((p) => [p.Name, p]));
    const wires = bindings.flatMap((b) => {
      const part = byName.get(b.targetName);
      return part ? [{ part, tag: b.tag, property: b.property }] : [];
    });

    const response = await fetch(`${BASE}/api/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Pump_Station_Demo",
        target: { model: "HMIGTO6310", width: 1024, height: 768 },
        screens: [demoScreen],
        variables: [],
        alarms: demoAlarms,
        wires,
      }),
    });

    expect(response.status).toBe(200);
    const { findings } = (await response.json()) as { findings: unknown[] };
    expect(Array.isArray(findings)).toBe(true);
  }, LIVE_TIMEOUT);

  it("answers the export beat, with a file or with a reason", async () => {
    const response = await fetch(`${BASE}/api/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Pump_Station_Demo",
        target: { model: "HMIGTO6310", width: 1024, height: 768 },
        screens: [demoScreen],
        variables: [],
        alarms: [],
        wires: [],
      }),
    });

    if (response.ok) {
      const blob = await response.blob();
      expect(blob.size).toBeGreaterThan(1000);
    } else {
      // 503 means no skeleton on this machine. That is the documented fallback
      // in docs/DEMO.md, not a broken demo - but it must say so clearly.
      expect(response.status).toBe(503);
      const { error } = (await response.json()) as { error: string };
      expect(error).toMatch(/setup:skeleton/);
    }
  }, LIVE_TIMEOUT);
});
