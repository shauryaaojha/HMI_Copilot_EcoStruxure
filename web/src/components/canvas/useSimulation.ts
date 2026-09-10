"use client";

/**
 * Driving the canvas from the simulation engine.
 *
 * The engine works in tag values, because that is what alarms are keyed by and
 * what a PLC would actually send. Screen objects are keyed by object name, so
 * the projection between the two goes through the project's own bindings -
 * which means an object nobody bound stays static during a simulation, exactly
 * as it would on the panel.
 *
 * Phase 8 of docs/BUILD_PLAN.md.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createEngine, type TagValues } from "@/lib/sim/engine";
import { objectValues } from "@/lib/sim/alarms";
import { useProject } from "@/store/project";

/** 4 Hz - fast enough to look live, slow enough to read a numeric changing. */
const TICK_MS = 250;

export function useSimulation() {
  const variables = useProject((s) => s.variables);
  const alarms = useProject((s) => s.alarms);
  const bindings = useProject((s) => s.bindings);
  const simulating = useProject((s) => s.simulating);

  const [tags, setTags] = useState<TagValues>({});
  const engine = useRef<ReturnType<typeof createEngine>>(null);

  useEffect(() => {
    if (!simulating) {
      engine.current = null;
      setTags({});
      return;
    }

    const running = createEngine({ variables, alarms, bindings });
    engine.current = running;
    setTags(running.values);

    const timer = setInterval(() => setTags(running.tick(TICK_MS / 1000)), TICK_MS);
    return () => clearInterval(timer);
  }, [simulating, variables, alarms, bindings]);

  const objects = useMemo(() => objectValues(bindings, tags), [bindings, tags]);

  return { tags, objects, elapsed: engine.current?.elapsed ?? 0 };
}
