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
 * The effect depends on `simulating` and nothing else, which is deliberate and
 * fixes two faults that the seven-tag fixture was too small to expose.
 *
 * The first was a crash. The effect used to list variables, alarms and bindings
 * as dependencies and call `setTags({})` on the not-simulating path. Every one
 * of those arrays gets a new identity on every store write, and a fresh `{}` is
 * never Object.is-equal to the last one, so each store write ran the effect and
 * each effect run scheduled another render from inside the commit phase. A
 * generation that streams a couple of hundred alarm events - which the
 * 1,248-tag sample does - walks straight past React's nested-update limit and
 * throws "Maximum update depth exceeded" after the objects have landed.
 *
 * The second was quieter: re-creating the engine whenever a binding or an alarm
 * changed reset a running simulation back to zero, so editing anything while
 * Live was on silently restarted it.
 *
 * The project is read imperatively at start instead. A simulation runs against
 * the project as it was when it started, which is also the honest behaviour -
 * a panel does not re-plan itself mid-run.
 *
 * Phase 8 of docs/BUILD_PLAN.md.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createEngine, type TagValues } from "@/lib/sim/engine";
import { objectValues } from "@/lib/sim/alarms";
import { useProject } from "@/store/project";

/** 4 Hz - fast enough to look live, slow enough to read a numeric changing. */
const TICK_MS = 250;

/** Shared, so the not-simulating state is always the same object. */
export const NO_TAGS: TagValues = {};

/**
 * The state reducer for "not simulating", as a function so the property that
 * matters can be tested without a DOM.
 *
 * It has to be referentially idempotent: called twice it must return the very
 * same object, or React commits a render for a state that did not change, and
 * an effect that runs on every store write turns that into a loop.
 */
export function idleTags(current: TagValues): TagValues {
  return current === NO_TAGS ? current : NO_TAGS;
}

export function useSimulation() {
  const bindings = useProject((s) => s.bindings);
  const simulating = useProject((s) => s.simulating);

  const [tags, setTags] = useState<TagValues>(NO_TAGS);
  const engine = useRef<ReturnType<typeof createEngine>>(null);

  useEffect(() => {
    if (!simulating) {
      engine.current = null;
      // Returning the identical object lets React bail out rather than commit
      // a render, which is what stops this effect feeding itself.
      setTags(idleTags);
      return;
    }

    const { variables, alarms, bindings: wires } = useProject.getState();
    const running = createEngine({ variables, alarms, bindings: wires });
    engine.current = running;
    setTags(running.values);

    const timer = setInterval(() => setTags(running.tick(TICK_MS / 1000)), TICK_MS);
    return () => clearInterval(timer);
  }, [simulating]);

  const objects = useMemo(() => objectValues(bindings, tags), [bindings, tags]);

  return { tags, objects, elapsed: engine.current?.elapsed ?? 0 };
}
