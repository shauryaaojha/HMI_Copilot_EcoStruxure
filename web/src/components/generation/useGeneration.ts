"use client";

/**
 * Running a generation and applying what it streams back.
 *
 * The event contract in src/types/events.ts is frozen, so this consumer does
 * not care where the events came from. It asks /api/generate first; if the
 * route is still the Phase 4 stub - which answers with an `error` event saying
 * so - it falls back to the local emitter and says which one ran. When FORMAT
 * lands the real pipeline the fallback simply stops being reached.
 *
 * Events are applied one at a time and in order, so the canvas fills in object
 * by object rather than appearing at the end. That is the demo.
 *
 * Phase 4 of docs/BUILD_PLAN.md.
 */

import { useCallback, useRef, useState } from "react";
import type { GenerationEvent } from "@/types/events";
import { useProject } from "@/store/project";
import { mockGeneration } from "./mockPipeline";
import { readEvents } from "./sse";

export type Source = "api" | "local";

export function useGeneration() {
  const [source, setSource] = useState<Source>();
  const [error, setError] = useState<string>();
  const running = useRef(false);

  const store = useProject;

  const apply = useCallback((event: GenerationEvent) => {
    const s = store.getState();

    switch (event.type) {
      case "step":
        s.setStep(event.step, event.state, event.detail);
        break;

      case "log":
        s.log(event.message);
        break;

      case "tags":
        // A pipeline that re-reads the tags should not lose what the import
        // recorded about them, so only the variables are replaced.
        s.hydrate({ variables: event.variables });
        break;

      case "equipment":
        s.setEquipment(event.equipment);
        break;

      case "object": {
        s.ensureScreen(event.parentId, store.getState().name || "Screen1");
        s.appendToView(event.parentId, event.part);
        s.attribute("layout", event.part.UniqueId);
        break;
      }

      case "binding":
        s.addBinding({
          tag: event.tag,
          targetId:
            store
              .getState()
              .screens.flatMap((screen) => screen.Children[0].Children)
              .find((part) => part.Name === event.target)?.UniqueId ?? "",
          targetName: event.target,
          property: event.property,
        });
        break;

      case "alarm":
        s.addAlarm(event.alarm);
        break;

      case "finding":
        s.addFinding({
          severity: event.severity,
          message: event.message,
          objectId: event.objectId,
          suggestion: event.suggestion,
        });
        if (event.objectId) s.attribute("validate", event.objectId);
        break;

      case "done":
        s.log("Generation complete.");
        break;

      case "error":
        s.log(`Pipeline error: ${event.message}`);
        break;
    }
  }, [store]);

  const generate = useCallback(
    async (intent: string) => {
      if (running.current) return;
      running.current = true;

      const s = store.getState();
      s.resetRun();
      s.setGenerating(true);
      setError(undefined);
      setSource(undefined);

      try {
        let used: Source = "local";

        try {
          const response = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ intent, variables: store.getState().variables }),
          });

          if (response.ok && response.body) {
            const events: GenerationEvent[] = [];
            let stubbed = false;

            for await (const event of readEvents(response.body)) {
              // The Phase 4 stub answers with exactly this, which is the signal
              // to run locally instead of showing the engineer a dead timeline.
              if (event.type === "error" && /not implemented/i.test(event.message)) {
                stubbed = true;
                break;
              }
              events.push(event);
              apply(event);
              if (event.type === "done") break;
            }

            if (!stubbed && events.length > 0) used = "api";
            else if (stubbed) store.getState().resetRun();
          }
        } catch {
          // Network or route failure falls through to the local emitter.
        }

        setSource(used);

        if (used === "local") {
          store
            .getState()
            .log("Running the local pipeline — /api/generate is not live yet.");
          for await (const event of mockGeneration({
            intent,
            variables: store.getState().variables,
          })) {
            apply(event);
          }
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "generation failed";
        setError(message);
        store.getState().log(`Generation failed: ${message}`);
      } finally {
        store.getState().setGenerating(false);
        running.current = false;
      }
    },
    [apply, store],
  );

  return { generate, source, error };
}
