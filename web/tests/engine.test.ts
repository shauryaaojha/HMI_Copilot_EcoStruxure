/**
 * Phase 8: the simulation engine.
 *
 * What is worth testing here is not "does a number change" but the two claims
 * the engine makes: that it exercises the alarms the project actually declares,
 * and that a run is reproducible. A demo you cannot rehearse is not a demo, and
 * an alarm the simulator can never fire has not been tested by simulating.
 */

import { describe, expect, it } from "vitest";
import { createEngine } from "@/lib/sim/engine";
import { activeAlarms, objectValues } from "@/lib/sim/alarms";
import { demoAlarms, demoBindings, demoVariables } from "@/fixtures";
import type { Binding } from "@/store/project";

/** The same flattening useProjectHydration does. */
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

const options = { variables: demoVariables, alarms: demoAlarms, bindings };

/** Runs the engine for `seconds` at 4 Hz, as the canvas does. */
function run(seconds: number, seed = 1) {
  const engine = createEngine({ ...options, seed });
  const frames = [engine.values];
  for (let t = 0; t < seconds * 4; t += 1) frames.push({ ...engine.tick(0.25) });
  return { engine, frames };
}

describe("the engine drives the project's own tags", () => {
  it("starts every tag at rest, so Live begins where Design left off", () => {
    const engine = createEngine(options);
    for (const [name, value] of Object.entries(engine.values)) {
      expect(typeof value === "boolean" ? value : value, name).toBeFalsy();
    }
  });

  it("moves the numeric tags and holds them inside their range", () => {
    const { frames } = run(20);
    const last = frames.at(-1)!;
    expect(last.FT_101_PV).toBeGreaterThan(0);
    expect(last.LT_101_PV).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(Number(frame.LT_101_PV)).toBeGreaterThanOrEqual(0);
      expect(Number(frame.LT_101_PV)).toBeLessThanOrEqual(120);
    }
  });

  it("drives a level tag through the setpoints its alarms are set at", () => {
    // LT_101_PV carries a Hi at 85 and a HiHi at 95. A simulator that never
    // reaches them has not tested them.
    const { frames } = run(30);
    const peak = Math.max(...frames.map((f) => Number(f.LT_101_PV)));
    expect(peak).toBeGreaterThan(85);
  });

  it("runs one unit of a group and leaves the standby stopped", () => {
    // Lead/lag: a two-pump station runs one duty pump at a time.
    const last = run(10).frames.at(-1)!;
    expect(last.PMP_101_RUN).toBe(true);
    expect(last.PMP_102_RUN).toBe(false);
  });

  it("injects a fault so the alarm path is exercised, not assumed", () => {
    const last = run(10).frames.at(-1)!;
    expect(last.PMP_101_FLT).toBe(false);
    expect(last.PMP_102_FLT).toBe(true);
  });

  it("reaches the state assets/screen_live.png shows", () => {
    // Pump 1 running, pump 2 stopped and faulted, both numerics up, and the two
    // alarm rows the Python renderer drew: PMP_102_FLT and LT_101_PV.
    const last = run(30).frames.at(-1)!;
    const objects = objectValues(bindings, last);

    expect(objects.Lamp_PUMP1_RUN).toBe(true);
    expect(objects.Lamp_PUMP2_RUN).toBe(false);
    expect(objects.Lamp_PUMP1_FLT).toBe(false);
    expect(objects.Lamp_PUMP2_FLT).toBe(true);
    expect(Number(objects.Num_Flow)).toBeGreaterThan(0);

    const raised = activeAlarms(demoAlarms, bindings, last).map((r) => r.variable);
    expect(raised).toContain("PMP_102_FLT");
    expect(raised).toContain("LT_101_PV");
  });

  it("is reproducible, so a demo can be rehearsed", () => {
    expect(run(15, 7).frames.at(-1)).toEqual(run(15, 7).frames.at(-1));
  });

  it("gives a different run for a different seed", () => {
    expect(run(15, 1).frames.at(-1)).not.toEqual(run(15, 2).frames.at(-1));
  });

  it("returns to rest on reset", () => {
    const engine = createEngine(options);
    for (let t = 0; t < 80; t += 1) engine.tick(0.25);
    expect(Number(engine.values.LT_101_PV)).toBeGreaterThan(0);

    engine.reset();
    expect(engine.elapsed).toBe(0);
    expect(Number(engine.values.LT_101_PV)).toBe(0);
    expect(engine.values.PMP_101_RUN).toBe(false);
  });

  it("copes with a project that declares no alarms at all", () => {
    const engine = createEngine({ ...options, alarms: [] });
    for (let t = 0; t < 40; t += 1) engine.tick(0.25);
    expect(Number(engine.values.LT_101_PV)).toBeGreaterThan(0);
    expect(activeAlarms([], bindings, engine.values)).toEqual([]);
  });
});
