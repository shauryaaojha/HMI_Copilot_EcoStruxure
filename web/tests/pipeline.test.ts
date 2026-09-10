/**
 * Phase 4: the generation pipeline.
 *
 * These run without ANTHROPIC_API_KEY, which is the point - the deterministic
 * path has to stand on its own, because a demo that dies when the network drops
 * is not a demo. The model layer is tested by what it is allowed to return, not
 * by calling it.
 */

import { describe, expect, it } from "vitest";
import { runPipeline } from "@/lib/ai/pipeline";
import { inferEquipment, proposeAlarms } from "@/lib/ai/infer";
import { activeProvider, hasApiKey } from "@/lib/ai/plan";
import { DEMO_VARIABLES } from "@/lib/ote/demo-project";
import { PIPELINE_STEPS, type GenerationEvent } from "@/types/events";

async function collect(intent: string, variables = DEMO_VARIABLES) {
  const events: GenerationEvent[] = [];
  for await (const event of runPipeline({ intent, variables })) events.push(event);
  return {
    events,
    of: <T extends GenerationEvent["type"]>(type: T) =>
      events.filter((e): e is Extract<GenerationEvent, { type: T }> => e.type === type),
  };
}

describe("equipment inference", () => {
  it("clusters tags by the loop number they share", () => {
    const units = inferEquipment(DEMO_VARIABLES);
    expect(units).toHaveLength(2);
    expect(units.map((u) => u.kind)).toEqual(["pump", "pump"]);
    // FT_101_PV measures what PMP_101 does, so it belongs to that unit.
    expect(units[0].tags).toContain("FT_101_PV");
  });

  it("keeps a specific suffix over what the instrument measures", () => {
    // LT_101_HI is a high-level switch, not a level reading. Calling it "level"
    // loses the alarm it should raise.
    const units = inferEquipment(DEMO_VARIABLES);
    const hi = units.flatMap((u) => u.roles).find((r) => r.tag === "LT_101_HI");
    expect(hi?.role).toBe("high");
  });

  it("proposes the alarms an engineer would expect", () => {
    const proposals = proposeAlarms(inferEquipment(DEMO_VARIABLES));
    expect(proposals).toHaveLength(5);
    // Both faults, the high switch, and the warn/act pair on the level.
    expect(proposals.filter((p) => p.kind === "bit")).toHaveLength(3);
    expect(proposals.filter((p) => p.kind === "level")).toHaveLength(2);
    expect(proposals.filter((p) => p.kind === "level").map((p) => p.value)).toEqual(["85", "95"]);
  });

  it("does not drop a tag it cannot classify", () => {
    const units = inferEquipment([
      ...DEMO_VARIABLES,
      { Name: "WEIRD_THING", DataType: "REAL", Comments: "", DeviceAddress: "" },
    ]);
    expect(units.flatMap((u) => u.tags)).toContain("WEIRD_THING");
  });
});

describe("the pipeline, with no API key", () => {
  it("runs all eight steps to done, in order", async () => {
    const { of } = await collect("Two pump station with lamps and a level alarm");
    const done = of("step").filter((e) => e.state === "done");
    expect(done.map((e) => e.step)).toEqual([...PIPELINE_STEPS]);
  });

  it("emits no error and finishes with done", async () => {
    const { events, of } = await collect("Two pump station");
    expect(of("error")).toHaveLength(0);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("says plainly that no model was involved", async () => {
    const { of } = await collect("Two pump station");
    const said = of("log").some((l) => /No model key set/.test(l.message));
    expect(said).toBe(true);
  });

  it("never claims a provider read the request when none did", async () => {
    const { of } = await collect("Two pump station");
    for (const line of of("log")) {
      expect(line.message).not.toMatch(/(Gemini|Claude) read the request/);
    }
  });

  it("emits only objects the packager can emit", async () => {
    const { of } = await collect("Two pump station");
    const types = new Set(of("object").map((e) => e.part.Type));
    for (const type of types) {
      expect(["Rectangle", "TextBox", "Lamp", "NumericDisplay", "AlarmSummary", "Path"]).toContain(type);
    }
  });

  it("binds every object it says it bound", async () => {
    const { of } = await collect("Two pump station");
    const names = new Set(of("object").map((e) => e.part.Name));
    for (const binding of of("binding")) {
      expect(names).toContain(binding.target);
    }
  });

  it("only binds tags that were supplied", async () => {
    const { of } = await collect("Two pump station");
    const supplied = new Set(DEMO_VARIABLES.map((v) => v.Name));
    for (const binding of of("binding")) expect(supplied).toContain(binding.tag);
    for (const alarm of of("alarm")) expect(supplied).toContain(alarm.alarm.Trigger);
  });

  it("validates its own output and reports no errors", async () => {
    const { of } = await collect("Two pump station");
    expect(of("finding").filter((f) => f.severity === "error")).toHaveLength(0);
  });

  it("describes each step by what it produced", async () => {
    const { of } = await collect("Two pump station");
    for (const s of of("step").filter((e) => e.state === "done")) {
      expect(s.detail, s.step).toBeTruthy();
      expect(s.detail).not.toMatch(/thinking/i);
    }
  });

  it("fails cleanly when there are no tags", async () => {
    const { of } = await collect("Anything", []);
    expect(of("error")).toHaveLength(1);
    expect(of("error")[0].message).toMatch(/tag export/i);
  });
});

describe("provider selection", () => {
  const KEYS = ["GEMINI_API_KEY", "ANTHROPIC_API_KEY"] as const;

  function withKeys(set: Partial<Record<(typeof KEYS)[number], string>>, run: () => void) {
    const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const key of KEYS) delete process.env[key];
    Object.assign(process.env, set);
    try {
      run();
    } finally {
      for (const key of KEYS) delete process.env[key];
      for (const [key, value] of Object.entries(saved)) {
        if (value !== undefined) process.env[key] = value;
      }
    }
  }

  it("prefers Gemini, because that is the configured free tier", () => {
    withKeys({ GEMINI_API_KEY: "x", ANTHROPIC_API_KEY: "y" }, () => {
      expect(activeProvider()).toBe("gemini");
    });
  });

  it("uses Claude when only that key is set", () => {
    withKeys({ ANTHROPIC_API_KEY: "y" }, () => {
      expect(activeProvider()).toBe("claude");
    });
  });

  it("reports no provider when neither key is set", () => {
    withKeys({}, () => {
      expect(activeProvider()).toBeNull();
      expect(hasApiKey()).toBe(false);
    });
  });

  it("treats a blank key as unset", () => {
    withKeys({ GEMINI_API_KEY: "   " }, () => {
      expect(activeProvider()).toBeNull();
    });
  });
});
