"use client";

/**
 * Running a generation and applying what it streams back.
 *
 * The event contract in src/types/events.ts is frozen, so this consumer does
 * not care where the events came from. It asks /api/generate, which is live;
 * the local emitter remains as the fallback for a route that is unreachable or
 * refuses, so a network failure degrades the demo instead of ending it. Which
 * one ran is always stated - a demo that cannot tell you whether the model was
 * involved is not worth much.
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

export interface GenerateOptions {
  /**
   * Clear the project first. True for "generate a screen from scratch"; false
   * when a conversational turn asks for another screen, because an HMI
   * application is several screens and the second must not erase the first.
   */
  fresh?: boolean;
}

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
        s.ensureScreen(
          event.parentId,
          event.screenName || store.getState().name || "Screen1",
        );
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
        // A finished generation is a version worth being able to return to.
        s.snapshot("Screen generated");
        break;

      case "error":
        s.log(`Pipeline error: ${event.message}`);
        break;
    }
  }, [store]);

  const generate = useCallback(
    async (intent: string, options: GenerateOptions = {}) => {
      if (running.current) return;
      running.current = true;

      const s = store.getState();
      if (options.fresh ?? true) s.resetRun();
      s.setGenerating(true);
      setError(undefined);
      setSource(undefined);

      try {
        let used: Source = "local";

        /**
         * Only a failure to *reach* the route falls back. A failure while
         * applying what it sent is our bug, not the route's, and running the
         * local emitter on top of a successful run would build the screen a
         * second time - which is exactly what a structuredClone throw in
         * snapshot() used to do, silently, leaving two screens in the store.
         */
        let applyFailure: unknown;

        try {
          const response = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ intent, variables: store.getState().variables }),
          });

          if (response.ok && response.body) {
            const events: GenerationEvent[] = [];
            let refused = false;

            for await (const event of readEvents(response.body)) {
              // A route that cannot run at all answers with an error event
              // before producing anything. Fall back rather than leave the
              // engineer looking at a dead timeline.
              if (event.type === "error" && events.length === 0) {
                refused = true;
                break;
              }
              events.push(event);
              try {
                apply(event);
              } catch (caught) {
                applyFailure = caught;
                break;
              }
              if (event.type === "done") break;
            }

            if (!refused && events.length > 0) used = "api";
            else if (refused && (options.fresh ?? true)) store.getState().resetRun();
          }
        } catch {
          // Network or route failure falls through to the local emitter.
        }

        // Surface it as itself rather than as a route that did not answer.
        if (applyFailure) throw applyFailure;

        setSource(used);

        if (used === "local") {
          store
            .getState()
            .log("/api/generate did not answer — running the local pipeline.");
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
